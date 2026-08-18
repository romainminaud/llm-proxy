import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { extractAgentMeta, overridesFromHeaders, type AgentMetaOverrides } from '../agent-meta.js';
import { calculateCost, type CostInfo } from '../pricing.js';
import { saveRequest } from '../db.js';
import { forward, forwardStream, providers, type ProviderConfig } from '../providers.js';
import { getTokenSplit } from '../tokens.js';
import { isStreamingRequest, StreamUsageAccumulator } from '../streaming.js';

const router = Router();

/**
 * Compute cost from a raw usage payload and persist the request record.
 * Shared by the streaming and non-streaming paths.
 */
function recordUsage(opts: {
  requestId: string;
  provider: ProviderConfig;
  method: string;
  path: string;
  model: string | null;
  requestBody: unknown;
  responseBody: unknown;
  usage: Record<string, unknown> | undefined;
  durationMs: number;
  overrides: AgentMetaOverrides;
}) {
  const { requestId, provider, usage } = opts;

  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = provider.extractTokenUsage(usage);
  const { totalInputTokens, nonCachedInputTokens, cachedInputTokens } = getTokenSplit(
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    provider.inputTokensIncludeCache
  );
  let costInfo: CostInfo = { inputCost: 0, cachedCost: 0, cacheWriteCost: 0, outputCost: 0, totalCost: 0 };

  if (usage && opts.model) {
    costInfo = calculateCost(opts.model, nonCachedInputTokens, outputTokens, cachedInputTokens, cacheWriteTokens);
  }

  const meta = extractAgentMeta(provider.name, opts.requestBody, opts.responseBody, usage, opts.overrides);

  saveRequest({
    id: requestId,
    timestamp: new Date().toISOString(),
    method: opts.method,
    path: opts.path,
    provider: provider.name,
    model: opts.model,
    requestBody: opts.requestBody,
    responseBody: opts.responseBody,
    statusCode: 200,
    durationMs: opts.durationMs,
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
    sessionId: meta.sessionId,
    turnId: meta.turnId,
    turnPrompt: meta.turnPrompt,
    agentEntrypoint: meta.agentEntrypoint,
    agentVersion: meta.agentVersion,
    toolsDefinedCount: meta.toolsDefinedCount,
    toolCallsCount: meta.toolCallsCount,
    toolNames: meta.toolNames,
    reasoningTokens: meta.reasoningTokens,
    stopReason: meta.stopReason,
    messageCount: meta.messageCount,
    requestBytes: meta.requestBytes,
    responseBytes: meta.responseBytes,
  });

  console.log(`[${requestId}] Completed in ${opts.durationMs}ms - Model: ${opts.model} - Tokens: ${totalInputTokens}/${outputTokens} - Cost: $${costInfo.totalCost.toFixed(6)}`);
}

function createProxyHandler(provider: ProviderConfig) {
  return async (req: Request, res: Response) => {
    const requestId = uuidv4();
    const startTime = Date.now();
    const strippedPath = provider.stripPrefix ? req.path.replace(new RegExp(`^${provider.stripPrefix}`), '') : req.path;
    const path = provider.normalizePath ? provider.normalizePath(strippedPath) : strippedPath;
    const method = req.method;

    const apiKey = provider.extractApiKey(req);
    if (!apiKey) {
      return res.status(401).json({ error: 'Missing API key header' });
    }

    // Model can be in body (OpenAI/Anthropic) or in URL path (Gemini: /v1beta/models/{model}:action)
    const modelFromPath = req.path.match(/\/models\/([^/:]+)/)?.[1] ?? null;
    const model = req.body?.model || modelFromPath || null;

    // Vendor-agnostic session/agent tagging headers. Never forwarded upstream:
    // buildHeaders() constructs the outbound header set from scratch.
    const overrides = overridesFromHeaders(req.headers);

    const streaming = isStreamingRequest(provider, req);
    console.log(`[${requestId}] ${provider.name} ${method} ${path} - Model: ${model || 'N/A'}${streaming ? ' (stream)' : ''}`);

    if (streaming) {
      return handleStreaming({ provider, req, res, requestId, startTime, path, method, model, apiKey, overrides });
    }

    try {
      const response = await forward(provider, method, path, req.body, apiKey, req) as Record<string, unknown>;
      const durationMs = Date.now() - startTime;

      const actualModel = (response.model as string) || (response.modelVersion as string) || model;

      const usage = (response.usage ?? response.usageMetadata) as Record<string, unknown> | undefined;
      console.log(`[${requestId}] usage keys:`, usage ? Object.keys(usage) : 'none', '| actualModel:', actualModel);

      recordUsage({
        requestId,
        provider,
        method,
        path,
        model: actualModel,
        requestBody: req.body,
        responseBody: response,
        usage,
        durationMs,
        overrides,
      });

      res.json(response);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const err = error as Error & { status?: number };

      // Failed requests still belong to their session: extract request-side meta.
      const meta = extractAgentMeta(provider.name, req.body, null, undefined, overrides);

      saveRequest({
        id: requestId,
        timestamp: new Date().toISOString(),
        method,
        path,
        provider: provider.name,
        model,
        requestBody: req.body,
        responseBody: null,
        statusCode: err.status || 500,
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
        error: err.message,
        sessionId: meta.sessionId,
        turnId: meta.turnId,
        turnPrompt: meta.turnPrompt,
        agentEntrypoint: meta.agentEntrypoint,
        agentVersion: meta.agentVersion,
        toolsDefinedCount: meta.toolsDefinedCount,
        messageCount: meta.messageCount,
        requestBytes: meta.requestBytes,
      });

      console.error(`[${requestId}] Error: ${err.message}`);

      res.status(err.status || 500).json({
        error: {
          message: err.message,
          type: 'proxy_error',
        },
      });
    }
  };
}

/**
 * Pipe an upstream streamed response straight to the client while tee-ing the
 * bytes through a usage accumulator. The request record is saved once the
 * stream ends so token usage / cost is captured from the final SSE events.
 */
async function handleStreaming(opts: {
  provider: ProviderConfig;
  req: Request;
  res: Response;
  requestId: string;
  startTime: number;
  path: string;
  method: string;
  model: string | null;
  apiKey: string;
  overrides: AgentMetaOverrides;
}) {
  const { provider, req, res, requestId, startTime, path, method, model, apiKey, overrides } = opts;

  try {
    const body = provider.prepareStreamBody ? provider.prepareStreamBody(req.body, path) : req.body;
    const upstream = await forwardStream(provider, method, path, body, apiKey, req);

    // Mirror the upstream content type (text/event-stream for OpenAI/Anthropic,
    // application/json for Gemini's streamGenerateContent).
    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const accumulator = new StreamUsageAccumulator(provider);
    const decoder = new TextDecoder();

    if (!upstream.body) {
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    let clientGone = false;
    res.on('close', () => { clientGone = true; });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (clientGone) {
        await reader.cancel().catch(() => {});
        break;
      }
      // Tee: feed the accumulator a decoded copy, forward raw bytes to client.
      accumulator.push(decoder.decode(value, { stream: true }));
      res.write(Buffer.from(value));
    }

    res.end();

    const durationMs = Date.now() - startTime;
    const { model: streamedModel, usage, responseBody } = accumulator.result();
    const actualModel = streamedModel || model;
    console.log(`[${requestId}] stream usage keys:`, usage ? Object.keys(usage) : 'none', '| actualModel:', actualModel);

    recordUsage({
      requestId,
      provider,
      method,
      path,
      model: actualModel,
      requestBody: req.body,
      // Prefer the reconstructed native-shape body (message + stop_reason);
      // fall back to bare usage if nothing could be reassembled.
      responseBody: responseBody ?? (usage ? { usage } : null),
      usage: usage ?? undefined,
      durationMs,
      overrides,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const err = error as Error & { status?: number };

    // Failed requests still belong to their session: extract request-side meta.
    const meta = extractAgentMeta(provider.name, req.body, null, undefined, overrides);

    saveRequest({
      id: requestId,
      timestamp: new Date().toISOString(),
      method,
      path,
      provider: provider.name,
      model,
      requestBody: req.body,
      responseBody: null,
      statusCode: err.status || 500,
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
      error: err.message,
      sessionId: meta.sessionId,
      turnId: meta.turnId,
      turnPrompt: meta.turnPrompt,
      agentEntrypoint: meta.agentEntrypoint,
      agentVersion: meta.agentVersion,
      toolsDefinedCount: meta.toolsDefinedCount,
      messageCount: meta.messageCount,
      requestBytes: meta.requestBytes,
    });

    console.error(`[${requestId}] Stream error: ${err.message}`);

    // If headers were already sent we can't switch to a JSON error response.
    if (res.headersSent) {
      res.end();
    } else {
      res.status(err.status || 500).json({
        error: { message: err.message, type: 'proxy_error' },
      });
    }
  }
}

// Register all providers dynamically
for (const provider of Object.values(providers)) {
  router.all(`${provider.routePrefix}/*`, createProxyHandler(provider));
}

export default router;
