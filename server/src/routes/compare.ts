import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { calculateCost, getAvailableModelsByProvider, type CostInfo } from '../pricing.js';
import { saveRequest } from '../db.js';
import { forward, getProvider, providers, type ProviderConfig } from '../providers.js';
import { getTokenSplit } from '../tokens.js';
import type { CompareResult, CompareTarget, GeminiThinkingLevel, Provider, ResponseFormat } from '../types.js';

const router = Router();

type CompareMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type CompareRequestBody = {
  systemPrompt?: string
  messages: CompareMessage[]
  targets: CompareTarget[]
  maxTokens?: number
}

// Check if model requires max_completion_tokens instead of max_tokens
function usesMaxCompletionTokens(model: string): boolean {
  // Newer OpenAI models use max_completion_tokens instead of max_tokens
  // This includes gpt-4o, gpt-4.1, gpt-4.5, gpt-4-turbo, o1, o3, etc.
  return /^(gpt-4o|gpt-4\.[0-9]|gpt-4-turbo|gpt-5|o1|o3)/i.test(model);
}

// Fix JSON schema for OpenAI strict mode (ensure all properties are in required array)
function fixSchemaForOpenAI(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...schema };

  // If this object has properties, ensure required includes all property keys
  if (result.properties && typeof result.properties === 'object') {
    const properties = result.properties as Record<string, unknown>;
    const propertyKeys = Object.keys(properties);

    // Set required to include all properties for strict mode
    result.required = propertyKeys;

    // Recursively fix nested objects
    const fixedProperties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      if (value && typeof value === 'object') {
        fixedProperties[key] = fixSchemaForOpenAI(value as Record<string, unknown>);
      } else {
        fixedProperties[key] = value;
      }
    }
    result.properties = fixedProperties;
  }

  // Handle items in arrays
  if (result.items && typeof result.items === 'object') {
    result.items = fixSchemaForOpenAI(result.items as Record<string, unknown>);
  }

  return result;
}

// Convert messages to OpenAI format
function toOpenAIFormat(systemPrompt: string | undefined, messages: CompareMessage[], model: string, maxTokens?: number, temperature?: number, responseFormat?: ResponseFormat) {
  const formattedMessages: { role: string; content: string }[] = [];

  if (systemPrompt) {
    formattedMessages.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    formattedMessages.push({ role: msg.role, content: msg.content });
  }

  const result: {
    messages: typeof formattedMessages
    max_tokens?: number
    max_completion_tokens?: number
    temperature?: number
    response_format?: ResponseFormat
  } = {
    messages: formattedMessages,
  };

  // Use appropriate token limit parameter based on model
  if (usesMaxCompletionTokens(model)) {
    result.max_completion_tokens = maxTokens || 4096;
  } else {
    result.max_tokens = maxTokens || 4096;
  }

  // Add temperature if specified
  if (temperature !== undefined) {
    result.temperature = temperature;
  }

  // Add response format for structured output (fix schema for strict mode)
  if (responseFormat) {
    result.response_format = {
      type: responseFormat.type,
      json_schema: {
        name: responseFormat.json_schema.name,
        schema: fixSchemaForOpenAI(responseFormat.json_schema.schema),
        strict: responseFormat.json_schema.strict,
      },
    };
  }

  return result;
}

// Convert messages to Anthropic format
function toAnthropicFormat(systemPrompt: string | undefined, messages: CompareMessage[], maxTokens?: number, temperature?: number, responseFormat?: ResponseFormat, thinkingBudget?: number) {
  const formattedMessages: { role: string; content: string }[] = [];

  for (const msg of messages) {
    if (msg.role !== 'system') {
      formattedMessages.push({ role: msg.role, content: msg.content });
    }
  }

  const thinkingEnabled = thinkingBudget !== undefined && thinkingBudget > 0;

  const result: {
    system?: string
    messages: typeof formattedMessages
    max_tokens: number
    temperature?: number
    thinking?: { type: 'enabled'; budget_tokens: number }
    tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>
    tool_choice?: { type: 'tool'; name: string }
  } = {
    system: systemPrompt || undefined,
    messages: formattedMessages,
    max_tokens: maxTokens || 4096,
  };

  if (thinkingEnabled) {
    result.thinking = { type: 'enabled', budget_tokens: thinkingBudget! };
    // Anthropic requires temperature=1 when extended thinking is enabled
    result.temperature = 1;
  } else if (temperature !== undefined) {
    result.temperature = temperature;
  }

  // For structured output with Anthropic, use tool use pattern
  if (responseFormat) {
    result.tools = [{
      name: responseFormat.json_schema.name,
      description: 'Output the response in the specified JSON format',
      input_schema: responseFormat.json_schema.schema,
    }];
    result.tool_choice = { type: 'tool', name: responseFormat.json_schema.name };
  }

  return result;
}

// Clean JSON schema for Gemini (remove unsupported fields)
function cleanSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    // Skip fields not supported by Gemini
    if (key === '$schema' || key === 'additionalProperties') {
      continue;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Recursively clean nested objects
      result[key] = cleanSchemaForGemini(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      // Clean arrays of objects
      result[key] = value.map(item =>
        item && typeof item === 'object' ? cleanSchemaForGemini(item as Record<string, unknown>) : item
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

// Convert thinking level to budget tokens
function getThinkingBudget(level: GeminiThinkingLevel | undefined): number | undefined {
  switch (level) {
    case 'none': return 0;
    case 'low': return 1024;
    case 'medium': return 8192;
    case 'high': return 24576;
    default: return undefined;
  }
}

// Convert messages to Gemini format
function toGeminiFormat(systemPrompt: string | undefined, messages: CompareMessage[], temperature?: number, responseFormat?: ResponseFormat, thinkingLevel?: GeminiThinkingLevel) {
  const contents: { role: string; parts: { text: string }[] }[] = [];

  // Gemini uses "user" and "model" roles
  for (const msg of messages) {
    if (msg.role !== 'system') {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }
  }

  const request: {
    contents: typeof contents
    systemInstruction?: { parts: { text: string }[] }
    generationConfig?: {
      temperature?: number
      responseMimeType?: string
      responseSchema?: Record<string, unknown>
      thinkingConfig?: {
        thinkingBudget: number
      }
    }
  } = { contents };

  if (systemPrompt) {
    request.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  // Initialize generationConfig if we have temperature, response format, or thinking level
  const thinkingBudget = getThinkingBudget(thinkingLevel);
  if (temperature !== undefined || responseFormat || thinkingBudget !== undefined) {
    request.generationConfig = {};

    if (temperature !== undefined) {
      request.generationConfig.temperature = temperature;
    }

    // For structured output with Gemini, use responseSchema (cleaned of unsupported fields)
    if (responseFormat) {
      request.generationConfig.responseMimeType = 'application/json';
      request.generationConfig.responseSchema = cleanSchemaForGemini(responseFormat.json_schema.schema);
    }

    // Add thinking config for Gemini thinking models
    if (thinkingBudget !== undefined) {
      request.generationConfig.thinkingConfig = {
        thinkingBudget,
      };
    }
  }

  return request;
}

// Get the API path for a provider
function getApiPath(provider: string): string {
  switch (provider) {
    case 'openai':
      return '/v1/chat/completions';
    case 'anthropic':
      return '/v1/messages';
    case 'gemini':
      return '/v1beta/models/{model}:generateContent';
    default:
      return '/v1/chat/completions';
  }
}

// Format request body for a specific provider
function formatRequestBody(
  provider: string,
  model: string,
  systemPrompt: string | undefined,
  messages: CompareMessage[],
  maxTokens?: number,
  temperature?: number,
  responseFormat?: ResponseFormat,
  thinkingLevel?: GeminiThinkingLevel,
  anthropicThinkingBudget?: number
): unknown {
  switch (provider) {
    case 'openai':
      return { model, ...toOpenAIFormat(systemPrompt, messages, model, maxTokens, temperature, responseFormat) };
    case 'anthropic':
      return { model, ...toAnthropicFormat(systemPrompt, messages, maxTokens, temperature, responseFormat, anthropicThinkingBudget) };
    case 'gemini':
      return toGeminiFormat(systemPrompt, messages, temperature, responseFormat, thinkingLevel);
    default:
      return { model, ...toOpenAIFormat(systemPrompt, messages, model, maxTokens, temperature, responseFormat) };
  }
}

// Execute a single comparison request
async function executeComparison(
  target: CompareTarget,
  globalSystemPrompt: string | undefined,
  messages: CompareMessage[],
  apiKeys: Record<string, string>,
  maxTokens?: number
): Promise<CompareResult> {
  const { provider: providerName, model, settings } = target;

  // Determine effective system prompt (per-target override or global)
  const effectiveSystemPrompt = settings?.systemPromptOverride ?? globalSystemPrompt;

  // Get temperature from per-target settings
  const temperature = settings?.temperature;

  // Get response format for structured output
  const responseFormat = settings?.responseFormat;

  // Get thinking level for Gemini thinking models
  const thinkingLevel = settings?.thinkingLevel;

  // Get Anthropic extended thinking budget
  const anthropicThinkingBudget = settings?.anthropicThinkingBudget;

  let providerConfig: ProviderConfig;
  try {
    providerConfig = getProvider(providerName);
  } catch {
    return {
      target,
      success: false,
      error: `Unknown provider: ${providerName}`,
    };
  }

  const apiKey = apiKeys[providerName];
  if (!apiKey) {
    return {
      target,
      success: false,
      error: `API key required for ${providerName}`,
    };
  }

  const requestBody = formatRequestBody(providerName, model, effectiveSystemPrompt, messages, maxTokens, temperature, responseFormat, thinkingLevel, anthropicThinkingBudget);
  let path = getApiPath(providerName);

  // For Gemini, replace {model} placeholder
  if (providerName === 'gemini') {
    path = path.replace('{model}', model);
  }

  const startTime = Date.now();
  const compareId = uuidv4();

  try {
    const response = await forward(providerConfig, 'POST', path, requestBody, apiKey) as Record<string, unknown>;
    const durationMs = Date.now() - startTime;

    // Extract the actual model from response (may differ from requested)
    const actualModel = (response.model as string) || model;

    // Extract token usage based on provider
    let usage: Record<string, unknown> | undefined;
    if (providerName === 'gemini') {
      usage = response.usageMetadata as Record<string, unknown> | undefined;
    } else {
      usage = response.usage as Record<string, unknown> | undefined;
    }

    const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = providerConfig.extractTokenUsage(usage);
    const { totalInputTokens, nonCachedInputTokens, cachedInputTokens } = getTokenSplit(inputTokens, cacheReadTokens);

    let costInfo: CostInfo = { inputCost: 0, cachedCost: 0, cacheWriteCost: 0, outputCost: 0, totalCost: 0 };
    costInfo = calculateCost(actualModel, nonCachedInputTokens, outputTokens, cachedInputTokens, cacheWriteTokens);

    // Save the comparison request for logging
    saveRequest({
      id: compareId,
      timestamp: new Date().toISOString(),
      method: 'POST',
      path,
      provider: providerName as Provider,
      model: actualModel,
      requestBody,
      responseBody: response,
      statusCode: 200,
      durationMs,
      inputTokens: totalInputTokens,
      totalInputTokens,
      nonCachedInputTokens,
      cachedInputTokens,
      outputTokens,
      cachedTokens: cachedInputTokens,
      cacheWriteTokens,
      inputCost: costInfo.inputCost,
      cachedCost: costInfo.cachedCost,
      cacheWriteCost: costInfo.cacheWriteCost,
      outputCost: costInfo.outputCost,
      totalCost: costInfo.totalCost,
    });

    console.log(`[${compareId}] Compare request to ${providerName}/${actualModel} completed in ${durationMs}ms`);

    return {
      target,
      success: true,
      model: actualModel,
      inputTokens: totalInputTokens,
      outputTokens,
      cacheReadTokens: cachedInputTokens,
      cacheWriteTokens,
      inputCost: costInfo.inputCost,
      cachedCost: costInfo.cachedCost,
      cacheWriteCost: costInfo.cacheWriteCost,
      outputCost: costInfo.outputCost,
      totalCost: costInfo.totalCost,
      durationMs,
      response,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Request failed';

    // Save failed request for logging
    saveRequest({
      id: compareId,
      timestamp: new Date().toISOString(),
      method: 'POST',
      path,
      provider: providerName as Provider,
      model,
      requestBody,
      responseBody: null,
      statusCode: (error as { status?: number }).status || 500,
      durationMs,
      inputTokens: null,
      outputTokens: null,
      cachedTokens: null,
      cacheWriteTokens: null,
      inputCost: null,
      cachedCost: null,
      cacheWriteCost: null,
      outputCost: null,
      totalCost: null,
      error: message,
    });

    console.log(`[${compareId}] Compare request to ${providerName}/${model} failed: ${message}`);

    return {
      target,
      success: false,
      error: message,
      durationMs,
    };
  }
}

// Compare endpoint - send same request to multiple models/providers
router.post('/api/compare', async (req: Request, res: Response) => {
  const body = req.body as CompareRequestBody;

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return res.status(400).json({ error: 'At least one message is required' });
  }

  if (!body.targets || !Array.isArray(body.targets) || body.targets.length === 0) {
    return res.status(400).json({ error: 'At least one target (provider/model) is required' });
  }

  // Extract API keys from headers
  const apiKeys: Record<string, string> = {};
  for (const [name, config] of Object.entries(providers)) {
    const key = req.headers[config.replayApiKeyHeader.toLowerCase()] as string | undefined;
    if (key) {
      apiKeys[name] = key;
    }
  }

  // Execute all comparisons in parallel
  const results = await Promise.all(
    body.targets.map(target =>
      executeComparison(target, body.systemPrompt, body.messages, apiKeys, body.maxTokens)
    )
  );

  res.json({ results });
});

// Get available models for comparison (derived from pricing data)
router.get('/api/compare/models', async (_req: Request, res: Response) => {
  const availableModels = getAvailableModelsByProvider();
  res.json(availableModels);
});

// Generate JSON schema from system prompt using LLM
router.post('/api/compare/generate-schema', async (req: Request, res: Response) => {
  const { systemPrompt, provider = 'openai', model = 'gpt-4o-mini' } = req.body as {
    systemPrompt: string;
    provider?: string;
    model?: string;
  };

  if (!systemPrompt || typeof systemPrompt !== 'string') {
    return res.status(400).json({ error: 'systemPrompt is required' });
  }

  // Get API key from headers
  let providerConfig: ProviderConfig;
  try {
    providerConfig = getProvider(provider);
  } catch {
    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }

  const apiKey = req.headers[providerConfig.replayApiKeyHeader.toLowerCase()] as string | undefined;
  if (!apiKey) {
    return res.status(400).json({ error: `API key required for ${provider}` });
  }

  const schemaGenerationPrompt = `You are a JSON Schema generator. Based on the system prompt below, generate a JSON Schema that describes the expected structure of the assistant's response.

The schema should:
1. Use JSON Schema draft-07 format
2. Have "type": "object" at the root
3. Include "additionalProperties": false for strict mode compatibility
4. Define all expected properties with appropriate types
5. Include a "required" array listing mandatory fields
6. Use descriptive property names that match what the assistant would naturally output

System prompt to analyze:
"""
${systemPrompt}
"""

Output ONLY the JSON Schema object, no explanation or markdown. The response must be valid JSON.`;

  try {
    const requestBody = {
      model,
      messages: [
        { role: 'system', content: 'You are a helpful assistant that generates JSON schemas. Output only valid JSON, no markdown or explanation.' },
        { role: 'user', content: schemaGenerationPrompt }
      ],
      max_tokens: 2000,
      temperature: 0,
    };

    const path = '/v1/chat/completions';
    const response = await forward(providerConfig, 'POST', path, requestBody, apiKey) as Record<string, unknown>;

    // Extract the schema from the response
    const choices = response.choices as { message?: { content?: string } }[];
    const content = choices[0]?.message?.content;

    if (!content) {
      return res.status(500).json({ error: 'No response from LLM' });
    }

    // Try to parse the JSON schema from the response
    let schema: Record<string, unknown>;
    try {
      // Remove any markdown code blocks if present
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.slice(7);
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.slice(3);
      }
      if (cleanContent.endsWith('```')) {
        cleanContent = cleanContent.slice(0, -3);
      }
      cleanContent = cleanContent.trim();

      schema = JSON.parse(cleanContent);
    } catch {
      return res.status(500).json({ error: 'Failed to parse generated schema', raw: content });
    }

    res.json({ schema, schemaName: 'response' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Schema generation failed';
    res.status(500).json({ error: message });
  }
});

export default router;
