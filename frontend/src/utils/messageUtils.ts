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
        if (typed.type === 'text') return { type: 'text', text: String(typed.text ?? '') }
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
