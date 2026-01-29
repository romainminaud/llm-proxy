import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { calculateCost, type CostInfo } from '../pricing.js';
import { saveRequest, getRequest } from '../db.js';
import { forward, getProvider } from '../providers.js';
import { getTokenSplit } from '../tokens.js';

const router = Router();

// Replay endpoint - resend a request to the original provider with optional modified body
router.post('/api/replay/:id', async (req: Request, res: Response) => {
  const original = getRequest(req.params.id);
  if (!original) {
    return res.status(404).json({ error: 'Request not found' });
  }

  const providerName = original.provider || 'openai';
  const provider = getProvider(providerName);

  // Get API key from header (use provider's configured header)
  const apiKey = req.headers[provider.replayApiKeyHeader.toLowerCase()] as string | undefined;

  if (!apiKey) {
    return res.status(400).json({ error: `API key required (${provider.replayApiKeyHeader} header)` });
  }

  // Use modified body from request, or fall back to original
  const requestBody = req.body && Object.keys(req.body).length > 0 ? req.body : original.request_body;

  const replayId = uuidv4();
  const startTime = Date.now();

  try {
    const response = await forward(provider, original.method, original.path, requestBody, apiKey) as Record<string, unknown>;

    const durationMs = Date.now() - startTime;
    const actualModel = (response.model as string) || (requestBody as { model?: string })?.model || original.model;

    // Extract token usage and calculate cost
    const usage = response.usage as Record<string, unknown> | undefined;
    const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = provider.extractTokenUsage(usage);
    const { totalInputTokens, nonCachedInputTokens, cachedInputTokens } = getTokenSplit(inputTokens, cacheReadTokens);
    let costInfo: CostInfo = { inputCost: 0, cachedCost: 0, cacheWriteCost: 0, outputCost: 0, totalCost: 0 };
    if (actualModel) {
      costInfo = calculateCost(actualModel, nonCachedInputTokens, outputTokens, cachedInputTokens, cacheWriteTokens);
    }

    // Save the replay request with reference to original
    saveRequest({
      id: replayId,
      timestamp: new Date().toISOString(),
      method: original.method,
      path: original.path,
      provider: providerName,
      model: actualModel,
      requestBody: requestBody,
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
      replayOf: original.id,
    });

    console.log(`[${replayId}] Replay of ${original.id} completed in ${durationMs}ms`);

    // Return response with comparison to original
    res.json({
      id: replayId,
      response,
      comparison: {
        original: {
          id: original.id,
          inputTokens: original.input_tokens || 0,
          outputTokens: original.output_tokens || 0,
          cacheReadTokens: original.cached_tokens || 0,
          cacheWriteTokens: original.cache_write_tokens || 0,
          inputCost: original.input_cost || 0,
          cachedCost: original.cached_cost || 0,
          cacheWriteCost: original.cache_write_cost || 0,
          outputCost: original.output_cost || 0,
          totalCost: original.total_cost || 0,
          durationMs: original.duration_ms || 0,
        },
        replay: {
          id: replayId,
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
        },
        diff: {
          inputTokens: totalInputTokens - (original.input_tokens || 0),
          outputTokens: outputTokens - (original.output_tokens || 0),
          cacheReadTokens: cachedInputTokens - (original.cached_tokens || 0),
          cacheWriteTokens: cacheWriteTokens - (original.cache_write_tokens || 0),
          inputCost: costInfo.inputCost - (original.input_cost || 0),
          cachedCost: costInfo.cachedCost - (original.cached_cost || 0),
          cacheWriteCost: costInfo.cacheWriteCost - (original.cache_write_cost || 0),
          outputCost: costInfo.outputCost - (original.output_cost || 0),
          totalCost: costInfo.totalCost - (original.total_cost || 0),
          durationMs: durationMs - (original.duration_ms || 0),
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Replay failed';
    res.status(500).json({ error: message });
  }
});

export default router;
