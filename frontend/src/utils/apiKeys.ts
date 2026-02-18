const STORAGE_KEY = 'llm-proxy-api-keys'

export type StoredApiKeys = Record<string, string>

/**
 * Load API keys from localStorage
 */
export function loadApiKeys(): StoredApiKeys {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored) as StoredApiKeys
    }
  } catch {
    // ignore parse errors
  }
  return {}
}

/**
 * Save API keys to localStorage
 */
export function saveApiKeys(keys: StoredApiKeys): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // ignore storage errors (e.g., quota exceeded)
  }
}

/**
 * Update a single API key and persist
 */
export function updateApiKey(provider: string, key: string): StoredApiKeys {
  const keys = loadApiKeys()
  if (key) {
    keys[provider] = key
  } else {
    delete keys[provider]
  }
  saveApiKeys(keys)
  return keys
}

/**
 * Get a single API key
 */
export function getApiKey(provider: string): string | undefined {
  const keys = loadApiKeys()
  return keys[provider]
}

/**
 * Clear all stored API keys
 */
export function clearApiKeys(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
