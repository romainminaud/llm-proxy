import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { calculateCost, type CostInfo } from '../pricing.js';
import { saveRequest } from '../db.js';
import { forward, providers, type ProviderConfig } from '../providers.js';
import { getTokenSplit } from '../tokens.js';

const router = Router();

function createProxyHandler(provider: ProviderConfig) {
  return async (req: Request, res: Response) => {
    const requestId = uuidv4();
    const startTime = Date.now();
    const path = provider.stripPrefix ? req.path.replace(new RegExp(`^${provider.stripPrefix}`), '') : req.path;
    const method = req.method;

    const apiKey = provider.extractApiKey(req);
    if (!apiKey) {
      return res.status(401).json({ error: 'Missing API key header' });
    }

    const model = req.body?.model || null;

    console.log(`[${requestId}] ${provider.name} ${method} ${path} - Model: ${model || 'N/A'}`);

    try {
      const response = await forward(provider, method, path, req.body, apiKey) as Record<string, unknown>;
      const durationMs = Date.now() - startTime;

      const actualModel = (response.model as string) || model;

      const usage = response.usage as Record<string, unknown> | undefined;
      const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = provider.extractTokenUsage(usage);
      const { totalInputTokens, nonCachedInputTokens, cachedInputTokens } = getTokenSplit(inputTokens, cacheReadTokens);
      let costInfo: CostInfo = { inputCost: 0, cachedCost: 0, cacheWriteCost: 0, outputCost: 0, totalCost: 0 };

      if (usage) {
        console.log(`[${requestId}] Token usage:`, {
          inputTokens: totalInputTokens,
          outputTokens,
          cacheReadTokens: cachedInputTokens,
          cacheWriteTokens,
        });

        if (actualModel) {
          costInfo = calculateCost(actualModel, nonCachedInputTokens, outputTokens, cachedInputTokens, cacheWriteTokens);
          console.log(`[${requestId}] Cost calculation:`, costInfo);
        }
      }

      saveRequest({
        id: requestId,
        timestamp: new Date().toISOString(),
        method,
        path,
        provider: provider.name,
        model: actualModel,
        requestBody: req.body,
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

      console.log(`[${requestId}] Completed in ${durationMs}ms - Model: ${actualModel} - Tokens: ${totalInputTokens}/${outputTokens} - Cost: $${costInfo.totalCost.toFixed(6)}`);

      res.json(response);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const err = error as Error & { status?: number };

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

// Register all providers dynamically
for (const provider of Object.values(providers)) {
  router.all(`${provider.routePrefix}/*`, createProxyHandler(provider));
}

export default router;
