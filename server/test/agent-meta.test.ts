import test from 'node:test'
import assert from 'node:assert/strict'
import { extractAgentMeta, overridesFromHeaders } from '../src/agent-meta.ts'

// --- Anthropic / Claude Code shaped fixtures ---

const claudeCodeRequest = {
  model: 'claude-opus-4-7',
  metadata: {
    user_id: JSON.stringify({
      device_id: '47f76b89c028',
      account_uuid: '',
      session_id: '6135c26c-bf57-490c-9e38-95124c004e15',
    }),
  },
  system: [
    { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.153.d01; cc_entrypoint=sdk-cli; cch=b' },
    { type: 'text', text: 'You are Claude Code...', cache_control: { type: 'ephemeral' } },
  ],
  tools: [{ name: 'Read' }, { name: 'Bash' }, { name: 'Edit' }],
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'list files' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
  ],
  max_tokens: 32000,
  stream: true,
}

const claudeCodeResponse = {
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-4-7',
  stop_reason: 'tool_use',
  content: [
    { type: 'thinking', thinking: 'hmm' },
    { type: 'text', text: 'Reading it now.' },
    { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/tmp/x' } },
  ],
  usage: {
    input_tokens: 1,
    cache_creation_input_tokens: 2128,
    cache_read_input_tokens: 51605,
    output_tokens: 1060,
    output_tokens_details: { thinking_tokens: 250 },
  },
}

test('anthropic: extracts Claude Code session id, agent identity, tools, thinking', () => {
  const meta = extractAgentMeta(
    'anthropic',
    claudeCodeRequest,
    claudeCodeResponse,
    claudeCodeResponse.usage as Record<string, unknown>
  )

  assert.equal(meta.sessionId, 's:6135c26c-bf57-490c-9e38-95124c004e15')
  assert.equal(meta.agentEntrypoint, 'sdk-cli')
  assert.equal(meta.agentVersion, '2.1.153.d01')
  assert.equal(meta.toolsDefinedCount, 3)
  assert.equal(meta.toolCallsCount, 1)
  assert.deepEqual(meta.toolNames, ['Read'])
  assert.equal(meta.reasoningTokens, 250)
  assert.equal(meta.stopReason, 'tool_use')
  assert.equal(meta.messageCount, 3)
  assert.ok((meta.requestBytes ?? 0) > 0)
  assert.ok((meta.responseBytes ?? 0) > 0)
})

test('anthropic: usage is read from the response body when not passed explicitly', () => {
  const meta = extractAgentMeta('anthropic', claudeCodeRequest, claudeCodeResponse)
  assert.equal(meta.reasoningTokens, 250)
})

test('anthropic: falls back to hash session for plain API traffic', () => {
  const request = {
    model: 'claude-sonnet-4-5',
    system: 'You are helpful.',
    messages: [{ role: 'user', content: 'hello' }],
  }
  const meta = extractAgentMeta('anthropic', request, null)
  assert.ok(meta.sessionId?.startsWith('h:'))

  // Same system + first user message → same session, even with more turns
  const followUp = {
    ...request,
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi!' },
      { role: 'user', content: 'more' },
    ],
  }
  const meta2 = extractAgentMeta('anthropic', followUp, null)
  assert.equal(meta2.sessionId, meta.sessionId)

  // Different conversation → different session
  const other = { ...request, messages: [{ role: 'user', content: 'goodbye' }] }
  const meta3 = extractAgentMeta('anthropic', other, null)
  assert.notEqual(meta3.sessionId, meta.sessionId)
})

// --- Absence rule ---

test('absence rule: unknown shapes yield nulls, never zeros', () => {
  const meta = extractAgentMeta('anthropic', {}, null)
  assert.equal(meta.sessionId, null)
  assert.equal(meta.agentEntrypoint, null)
  assert.equal(meta.agentVersion, null)
  assert.equal(meta.toolsDefinedCount, null)
  assert.equal(meta.toolCallsCount, null)
  assert.equal(meta.toolNames, null)
  assert.equal(meta.reasoningTokens, null)
  assert.equal(meta.stopReason, null)
  assert.equal(meta.messageCount, null)
  assert.equal(meta.responseBytes, null)
})

test('absence rule: recognized response with no tool calls reports 0, not null', () => {
  const meta = extractAgentMeta('anthropic', claudeCodeRequest, {
    ...claudeCodeResponse,
    content: [{ type: 'text', text: 'done' }],
    stop_reason: 'end_turn',
  })
  assert.equal(meta.toolCallsCount, 0)
  assert.deepEqual(meta.toolNames, [])
  assert.equal(meta.stopReason, 'end_turn')
})

// --- OpenAI ---

test('openai: chat completions tool calls, finish_reason, reasoning tokens', () => {
  const request = {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are an agent.' },
      { role: 'user', content: 'do the thing' },
    ],
    tools: [{ type: 'function', function: { name: 'search' } }],
  }
  const response = {
    model: 'gpt-4o',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'search', arguments: '{}' } },
          { id: 'c2', type: 'function', function: { name: 'search', arguments: '{}' } },
        ],
      },
      finish_reason: 'tool_calls',
    }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      completion_tokens_details: { reasoning_tokens: 12 },
    },
  }
  const meta = extractAgentMeta('openai', request, response, response.usage as Record<string, unknown>)

  assert.ok(meta.sessionId?.startsWith('h:'))
  assert.equal(meta.toolsDefinedCount, 1)
  assert.equal(meta.toolCallsCount, 2)
  assert.deepEqual(meta.toolNames, ['search', 'search'])
  assert.equal(meta.reasoningTokens, 12)
  assert.equal(meta.stopReason, 'tool_calls')
  assert.equal(meta.messageCount, 2)
})

test('openai: responses API function calls', () => {
  const request = {
    model: 'gpt-4o',
    instructions: 'You are an agent.',
    input: [{ role: 'user', content: 'go' }],
  }
  const response = {
    model: 'gpt-4o',
    output: [
      { type: 'function_call', name: 'lookup', arguments: '{}' },
      { type: 'message', content: [{ type: 'output_text', text: 'ok' }] },
    ],
  }
  const meta = extractAgentMeta('openai', request, response)
  assert.equal(meta.toolCallsCount, 1)
  assert.deepEqual(meta.toolNames, ['lookup'])
  assert.equal(meta.messageCount, 1)
  assert.ok(meta.sessionId?.startsWith('h:'))
})

// --- Gemini ---

test('gemini: functionCall parts, finishReason, thoughts tokens', () => {
  const request = {
    systemInstruction: { parts: [{ text: 'You are an agent.' }] },
    contents: [{ role: 'user', parts: [{ text: 'go' }] }],
    tools: [{ functionDeclarations: [{ name: 'search' }, { name: 'fetch' }] }],
  }
  const response = {
    candidates: [{
      content: {
        role: 'model',
        parts: [{ text: 'Calling.' }, { functionCall: { name: 'search', args: {} } }],
      },
      finishReason: 'STOP',
    }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7 },
  }
  const meta = extractAgentMeta('gemini', request, response, response.usageMetadata as Record<string, unknown>)

  assert.ok(meta.sessionId?.startsWith('h:'))
  assert.equal(meta.toolsDefinedCount, 2)
  assert.equal(meta.toolCallsCount, 1)
  assert.deepEqual(meta.toolNames, ['search'])
  assert.equal(meta.reasoningTokens, 7)
  assert.equal(meta.stopReason, 'STOP')
  assert.equal(meta.messageCount, 1)
})

// --- Vendor-agnostic header overrides ---

test('header overrides: session and agent from proxy headers, any provider', () => {
  const overrides = overridesFromHeaders({
    'x-llm-proxy-session-id': 'my-task-42',
    'x-llm-proxy-agent': 'my-agent/1.2.3',
  })
  assert.equal(overrides.sessionId, 's:my-task-42')
  assert.equal(overrides.agentEntrypoint, 'my-agent')
  assert.equal(overrides.agentVersion, '1.2.3')

  const meta = extractAgentMeta('openai', { messages: [{ role: 'user', content: 'hi' }] }, null, undefined, overrides)
  assert.equal(meta.sessionId, 's:my-task-42')
  assert.equal(meta.agentEntrypoint, 'my-agent')
  assert.equal(meta.agentVersion, '1.2.3')
})

test('header overrides: explicit session beats Claude Code metadata', () => {
  const overrides = overridesFromHeaders({ 'x-llm-proxy-session-id': 'explicit' })
  const meta = extractAgentMeta('anthropic', claudeCodeRequest, claudeCodeResponse, undefined, overrides)
  assert.equal(meta.sessionId, 's:explicit')
  // agent identity still comes from the billing block when not overridden
  assert.equal(meta.agentEntrypoint, 'sdk-cli')
})

test('header overrides: absent/blank headers yield nulls and change nothing', () => {
  const overrides = overridesFromHeaders({ 'x-llm-proxy-session-id': '   ' })
  assert.equal(overrides.sessionId, null)
  assert.equal(overrides.agentEntrypoint, null)
  const meta = extractAgentMeta('anthropic', claudeCodeRequest, null, undefined, overrides)
  assert.equal(meta.sessionId, 's:6135c26c-bf57-490c-9e38-95124c004e15')
})

test('header overrides: agent name without version', () => {
  const overrides = overridesFromHeaders({ 'x-llm-proxy-agent': 'langchain' })
  assert.equal(overrides.agentEntrypoint, 'langchain')
  assert.equal(overrides.agentVersion, null)
})

test('header overrides: turn id stored verbatim, null without the header', () => {
  const overrides = overridesFromHeaders({ 'x-llm-proxy-turn-id': 'turn-7' })
  assert.equal(overrides.turnId, 'turn-7')

  const meta = extractAgentMeta('openai', { messages: [{ role: 'user', content: 'hi' }] }, null, undefined, overrides)
  assert.equal(meta.turnId, 'turn-7')

  // No header → null (absence rule); turns are never inferred from bodies.
  const bare = extractAgentMeta('anthropic', claudeCodeRequest, claudeCodeResponse)
  assert.equal(bare.turnId, null)
  assert.equal(overridesFromHeaders({ 'x-llm-proxy-turn-id': '   ' }).turnId, null)
})
