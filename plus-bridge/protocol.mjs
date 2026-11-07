import { randomUUID } from 'node:crypto'

export function toResponses(body) {
  if (typeof body.model !== 'string' || !Array.isArray(body.messages) || !body.messages.length) throw new Error('model and messages are required')
  const input = []
  if (body.tools?.length) input.push({ type: 'additional_tools', role: 'developer', tools: body.tools.map(tool => {
    if (tool.type !== 'function' || !tool.function?.name) throw new Error('Only function tools are supported')
    return { type: 'function', name: tool.function.name, description: tool.function.description ?? '', parameters: tool.function.parameters, strict: false }
  }) })
  for (const message of body.messages) {
    if (message.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: message.tool_call_id, output: typeof message.content === 'string' ? message.content : JSON.stringify(message.content) })
      continue
    }
    const role = message.role === 'system' ? 'developer' : message.role
    if (!['user', 'assistant', 'developer'].includes(role)) throw new Error('Unsupported message role')
    if (message.content) {
      const content = typeof message.content === 'string' ? message.content : message.content.map(part => {
        if (part.type === 'text') return { type: role === 'assistant' ? 'output_text' : 'input_text', text: part.text }
        if (part.type === 'image_url' && role === 'user') return { type: 'input_image', image_url: part.image_url.url, ...(part.image_url.detail ? { detail: part.image_url.detail } : {}) }
        throw new Error('Unsupported message content')
      })
      input.push({ role, content })
    }
    for (const call of message.tool_calls ?? []) input.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments })
  }
  // Deliberate allowlist: unsupported sampling, persistence and billing fields cannot leak through.
  const result = { model: body.model, input, store: false, stream: true }
  if (['auto', 'none', 'required'].includes(body.tool_choice)) result.tool_choice = body.tool_choice
  return result
}

export async function* sseEvents(stream) {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const bytes of stream) {
    buffer += decoder.decode(bytes, { stream: true })
    let match
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
      if (data && data !== '[DONE]') yield JSON.parse(data)
    }
  }
  if (buffer.trim()) throw new Error('Responses stream ended with an incomplete event')
}

export async function convertResponse(response, body, emit) {
  const id = `chatcmpl-${randomUUID()}`, created = Math.floor(Date.now() / 1000)
  let text = '', completed, roleSent = false
  const calls = new Map()
  const chunk = (delta, finish_reason = null, usage) => ({ id, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })
  for await (const event of sseEvents(response.body)) {
    if (!roleSent) { emit?.(chunk({ role: 'assistant', content: '' })); roleSent = true }
    if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
      const delta = event.delta ?? ''; text += delta; emit?.(chunk({ content: delta }))
    } else if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
      const call = { index: calls.size, id: event.item.call_id, name: event.item.name, arguments: event.item.arguments ?? '' }
      calls.set(event.output_index, call)
      emit?.(chunk({ tool_calls: [{ index: call.index, id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }] }))
    } else if (event.type === 'response.function_call_arguments.delta') {
      const call = calls.get(event.output_index)
      if (!call) throw new Error('Received arguments before a function call')
      call.arguments += event.delta
      emit?.(chunk({ tool_calls: [{ index: call.index, function: { arguments: event.delta } }] }))
    } else if (event.type === 'response.failed' || event.type === 'response.incomplete' || event.type === 'error') {
      const detail = event.response?.error ?? event.error ?? event
      const error = new Error(detail.message ?? `Responses request did not complete (${event.type})`)
      error.code = detail.code ?? event.type; throw error
    } else if (event.type === 'response.completed') completed = event.response
  }
  if (!completed) throw new Error('Responses stream ended before response.completed')
  const usage = { prompt_tokens: completed.usage?.input_tokens ?? 0, completion_tokens: completed.usage?.output_tokens ?? 0, total_tokens: completed.usage?.total_tokens ?? 0 }
  const finish = calls.size ? 'tool_calls' : 'stop'
  emit?.(chunk({}, finish, usage))
  return { id, object: 'chat.completion', created, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: text || null,
    ...(calls.size ? { tool_calls: [...calls.values()].map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) } : {}) }, finish_reason: finish }], usage }
}
