import type { MessageLike, NormalizedContent, NormalizedContentPart } from '../types'

export function getMessageContent(message: MessageLike): NormalizedContent {
  if (!message) return ''
  if (typeof message.content === 'string') {
    return message.content
  }
  if (Array.isArray(message.content)) {
    return message.content.map((part: unknown): NormalizedContentPart => {
      if (typeof part === 'string') return { type: 'text', text: part }
      if (typeof part === 'object' && part !== null) {
        const typed = part as Record<string, unknown>
        // 'input_text'/'output_text' are the Responses API's text part types
        if (typed.type === 'text' || typed.type === 'input_text' || typed.type === 'output_text') {
          return { type: 'text', text: String(typed.text ?? '') }
        }
        if (typed.type === 'image_url') return { type: 'image_url', image_url: typed.image_url as { url?: string } }
        if (typed.type === 'tool_use') return { type: 'tool_use', name: typed.name as string, input: typed.input }
        if (typed.type === 'tool_result') return { type: 'tool_result', content: typed.content }
        return { type: 'unknown', data: part }
      }
      return { type: 'unknown', data: part }
    })
  }
  if (message.content !== undefined && message.content !== null) {
    if (typeof message.content === 'object') return JSON.stringify(message.content, null, 2)
    return String(message.content)
  }
  return ''
}

/**
 * Normalize one OpenAI Responses API conversation item (from request input[]
 * or response output[]) into a renderable message. Tool calls and results map
 * onto the existing tool_use / tool_result part renderers; reasoning items are
 * kept only when they carry readable summary text (encrypted blobs are noise).
 * Returns null for items with nothing human-readable to show.
 */
export function normalizeResponsesItem(item: unknown): MessageLike | null {
  if (typeof item === 'string') return { role: 'user', content: item }
  if (typeof item !== 'object' || item === null) return null
  const typed = item as Record<string, unknown>

  // Plain message: {role, content} — with or without type: 'message'
  if (typeof typed.role === 'string' && typed.content !== undefined) {
    return { role: typed.role, content: typed.content }
  }

  if (typed.type === 'function_call') {
    let input: unknown = typed.arguments
    if (typeof typed.arguments === 'string') {
      try { input = JSON.parse(typed.arguments) } catch { /* keep raw string */ }
    }
    return {
      role: 'assistant',
      content: [{ type: 'tool_use', name: String(typed.name ?? 'unknown'), input }],
    }
  }

  if (typed.type === 'function_call_output') {
    return {
      role: 'tool',
      content: [{ type: 'tool_result', content: typed.output }],
    }
  }

  if (typed.type === 'reasoning') {
    const summary = Array.isArray(typed.summary)
      ? typed.summary
          .map(part => (typeof (part as Record<string, unknown>)?.text === 'string'
            ? String((part as Record<string, unknown>).text)
            : ''))
          .filter(Boolean)
          .join('\n')
      : ''
    if (!summary) return null // encrypted-only reasoning: nothing to show
    return { role: 'assistant', content: `[Reasoning]\n${summary}` }
  }

  // Unknown item type: show its JSON rather than a blank row
  return { role: String(typed.type ?? typed.role ?? 'unknown'), content: JSON.stringify(item, null, 2) }
}

export function estimateTokens(message: MessageLike): number {
  const content = getMessageContent(message)
  let charCount = 0

  if (typeof content === 'string') {
    charCount = content.length
  } else if (Array.isArray(content)) {
    content.forEach(part => {
      if (part.type === 'text' && part.text) {
        charCount += part.text.length
      } else if (part.type === 'image_url') {
        charCount += 340
      } else if (part.type === 'tool_use' && part.input) {
        charCount += JSON.stringify(part.input).length
      } else if (part.type === 'tool_result' && part.content) {
        const resultContent = typeof part.content === 'string' ? part.content : JSON.stringify(part.content)
        charCount += resultContent.length
      }
    })
  }

  const structureTokens = 15
  const contentTokens = Math.ceil(charCount / 3.5)

  return contentTokens + structureTokens
}
