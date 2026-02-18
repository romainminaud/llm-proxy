import type { SavedComparison, CompareMessage, CompareTarget, CompareResult } from '../types'

const STORAGE_KEY = 'llm-proxy-saved-comparisons'

/**
 * Load all saved comparisons from localStorage
 */
export function loadSavedComparisons(): SavedComparison[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored) as SavedComparison[]
    }
  } catch {
    // ignore parse errors
  }
  return []
}

/**
 * Save all comparisons to localStorage
 */
function saveAllComparisons(comparisons: SavedComparison[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(comparisons))
  } catch {
    // ignore storage errors
  }
}

/**
 * Generate a unique ID for a new comparison
 */
function generateId(): string {
  return `comp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Save a new comparison or update an existing one
 */
export function saveComparison(
  data: {
    systemPrompt: string
    messages: CompareMessage[]
    targets: CompareTarget[]
    maxTokens: number
    lastResults?: CompareResult[]
  },
  existingId?: string,
  name?: string
): SavedComparison {
  const comparisons = loadSavedComparisons()
  const now = Date.now()

  if (existingId) {
    // Update existing
    const index = comparisons.findIndex(c => c.id === existingId)
    if (index >= 0) {
      comparisons[index] = {
        ...comparisons[index],
        ...data,
        name: name || comparisons[index].name,
        updatedAt: now,
      }
      saveAllComparisons(comparisons)
      return comparisons[index]
    }
  }

  // Create new
  const newComparison: SavedComparison = {
    id: generateId(),
    name: name || `Comparison ${comparisons.length + 1}`,
    ...data,
    createdAt: now,
    updatedAt: now,
  }
  comparisons.unshift(newComparison)
  saveAllComparisons(comparisons)
  return newComparison
}

/**
 * Delete a saved comparison by ID
 */
export function deleteComparison(id: string): void {
  const comparisons = loadSavedComparisons()
  const filtered = comparisons.filter(c => c.id !== id)
  saveAllComparisons(filtered)
}

/**
 * Get a single saved comparison by ID
 */
export function getComparison(id: string): SavedComparison | undefined {
  const comparisons = loadSavedComparisons()
  return comparisons.find(c => c.id === id)
}

/**
 * Rename a saved comparison
 */
export function renameComparison(id: string, name: string): void {
  const comparisons = loadSavedComparisons()
  const comparison = comparisons.find(c => c.id === id)
  if (comparison) {
    comparison.name = name
    comparison.updatedAt = Date.now()
    saveAllComparisons(comparisons)
  }
}
