import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from 'jose'
import { ChatGPTAuth, AUTH, RESOURCE, PLAN_SCOPE } from './oauth.mjs'
import { initialState, openStore, readState } from './storage.mjs'
import { configureSettings, accountModels, BRIDGE_URL } from './configure.mjs'
import { toResponses, convertResponse } from './protocol.mjs'
import { createHandler } from './server.mjs'

const { privateKey, publicKey } = await generateKeyPair('RS256')
const keySet = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' }] })
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const memory = () => ({ state: initialState(), saves: 0, async save() { this.saves++ } })
const encodeEvents = events => new Response(new ReadableStream({ start(controller) {
  const bytes = new TextEncoder().encode(events.map(event => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join(''))
  for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
  controller.close()
} }))
const complete = { type: 'response.completed', response: { usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 } } }
async function signedToken(nonce, clientId = 'oaiapp_readany_test', fields = {}) {
  return new SignJWT({ nonce, ...fields }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(AUTH).setAudience(clientId).setSubject('user-test').setIssuedAt().setExpirationTime('5m').sign(privateKey)
}
async function authorize({ scope = `openid ${PLAN_SCOPE}`, claims = {}, returning = false } = {}) {
  const store = memory(); let transaction, exchanges = 0
  if (returning) store.state.accounts.push({ clientId: 'oaiapp_readany_test', subject: 'user-test', scopes: [] })
  const auth = new ChatGPTAuth(store, { keySet, request: async (url, options) => {
    exchanges++; assert.equal(url, `${AUTH}/api/accounts/oauth/token`)
    assert.equal(options.body.get('client_id'), 'oaiapp_readany_test')
    assert.equal(options.body.get('redirect_uri'), 'http://127.0.0.1:38618/auth/callback')
    assert.equal(options.body.get('resource'), RESOURCE)
    assert.equal(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'), transaction.searchParams.get('code_challenge'))
    return Response.json({ id_token: await signedToken(transaction.searchParams.get('nonce'), 'oaiapp_readany_test', claims), access_token: 'opaque-test-access', refresh_token: 'opaque-test-refresh', token_type: 'Bearer', expires_in: 3600, scope })
  } })
  transaction = new URL(auth.begin('http://127.0.0.1:38618/auth/callback', returning ? 'oaiapp_readany_test' : null))
  return { auth, store, transaction, exchanges: () => exchanges,
    query: new URLSearchParams({ state: transaction.searchParams.get('state'), code: 'test-code', client_id: 'oaiapp_readany_test' }) }
}

test('OAuth dynamic registration uses PKCE, exact loopback callback and subscription scopes', async () => {
  const { auth, store, transaction, query } = await authorize()
  assert.equal(transaction.origin, AUTH)
  assert.equal(transaction.searchParams.get('client_id'), 'dynamic_agent_client')
  assert.equal(transaction.searchParams.get('agent_name_hint'), 'ReadAny')
  assert.ok(transaction.searchParams.get('scope').includes(PLAN_SCOPE))
  assert.equal(await auth.complete(query), true)
  assert.equal(store.state.accounts[0].clientId, 'oaiapp_readany_test')
  assert.equal(await auth.accessToken(), 'opaque-test-access')
  const returning = new URL(auth.begin('http://127.0.0.1:38618/auth/callback'))
  assert.equal(returning.searchParams.get('client_id'), 'oaiapp_readany_test')
  assert.equal(returning.searchParams.has('agent_name_hint'), false)
  assert.equal(returning.searchParams.get('ext_agent_host_id'), transaction.searchParams.get('ext_agent_host_id'))
})

test('OAuth rejects wrong state, missing issued client ID, replay, denial and changed account', async () => {
  const { auth, query, exchanges } = await authorize()
  await assert.rejects(auth.complete(new URLSearchParams({ state: 'wrong', code: 'x' })), /state/)
  assert.equal(exchanges(), 0)
  const missing = await authorize(); missing.query.delete('client_id')
  await assert.rejects(missing.auth.complete(missing.query), /client ID/)
  const denied = await authorize(); denied.query.set('error', 'access_denied')
  await assert.rejects(denied.auth.complete(denied.query), /declined/)
  assert.equal(denied.exchanges(), 0)
  await auth.complete(query)
  await assert.rejects(auth.complete(query), /state/)
  const changed = await authorize({ returning: true }); changed.query.set('client_id', 'other-client')
  await assert.rejects(changed.auth.complete(changed.query), /client ID/)
})

test('OAuth signature/audience/nonce are validated before activating credentials', async () => {
  const bad = await authorize({ claims: { nonce: 'wrong-nonce' } })
  await assert.rejects(bad.auth.complete(bad.query), /identity validation/)
  assert.equal(bad.store.state.activeClientId, null)
  const signed = await signedToken('nonce', 'another-client')
  const store = memory()
  const auth = new ChatGPTAuth(store, { keySet, request: async () => Response.json({ id_token: signed, access_token: 'a', token_type: 'Bearer', expires_in: 60, scope: PLAN_SCOPE }) })
  const url = new URL(auth.begin('http://127.0.0.1:38618/auth/callback'))
  await assert.rejects(auth.complete(new URLSearchParams({ state: url.searchParams.get('state'), code: 'x', client_id: 'oaiapp_readany_test' })), /aud/)
})

test('sign-in without explicit plan permission never enables inference', async () => {
  const { auth, query } = await authorize({ scope: 'openid email' })
  assert.equal(await auth.complete(query), false)
  await assert.rejects(auth.accessToken(), /authorize/)
})

test('rotating refresh tokens are refreshed once, atomically saved and not replaced by paid API credentials', async () => {
  const store = memory()
  store.state.accounts.push({ clientId: 'saved-client', subject: 'user-test', accessToken: 'expired', refreshToken: 'old-refresh', scopes: [PLAN_SCOPE], expiresAt: 0 })
  store.state.activeClientId = 'saved-client'
  let count = 0
  const auth = new ChatGPTAuth(store, { request: async (url, options) => {
    count++; assert.equal(url, `${AUTH}/api/accounts/oauth/token`)
    assert.equal(options.body.get('scope'), null)
    assert.equal(options.body.get('client_id'), 'saved-client')
    return Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 3600 })
  } })
  assert.deepEqual(await Promise.all([auth.accessToken(), auth.accessToken()]), ['new-access', 'new-access'])
  assert.equal(count, 1); assert.equal(store.state.accounts[0].refreshToken, 'new-refresh'); assert.equal(store.saves, 1)
})

test('terminal refresh errors clear tokens; temporary failures preserve them', async () => {
  for (const [code, cleared] of [['invalid_grant', true], ['temporarily_unavailable', false]]) {
    const store = memory(); store.state.accounts.push({ clientId: 'saved', accessToken: 'old', refreshToken: 'refresh', idToken: 'id', scopes: [PLAN_SCOPE], expiresAt: 0 }); store.state.activeClientId = 'saved'
    const auth = new ChatGPTAuth(store, { request: async () => Response.json({ error: code }, { status: 400 }) })
    await assert.rejects(auth.accessToken())
    assert.equal(!!auth.active.accessToken, !cleared)
    assert.equal(auth.active.clientId, 'saved')
  }
})

test('Chat Completions converts tools and conversation history to the subscription Responses contract', () => {
  const body = toResponses({ model: 'account-model', temperature: 0.7, max_tokens: 1000, store: true,
    tools: [{ type: 'function', function: { name: 'book_search', parameters: { type: 'object' } } }],
    messages: [{ role: 'system', content: 'Read this book.' }, { role: 'user', content: '你好' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', function: { name: 'book_search', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: 'passage' }] })
  assert.equal(body.stream, true); assert.equal(body.store, false)
  assert.equal(body.temperature, undefined); assert.equal(body.max_output_tokens, undefined)
  assert.equal(body.input[0].type, 'additional_tools'); assert.equal(body.input[1].role, 'developer')
  assert.equal(body.input.at(-1).type, 'function_call_output')
  assert.throws(() => toResponses({ model: 'm', messages: [{ role: 'invalid' }] }))
})

test('chunked UTF-8 SSE translates text, tool deltas and final usage', async () => {
  const emitted = []
  const result = await convertResponse(encodeEvents([
    { type: 'response.output_text.delta', delta: '中文内容' },
    { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', call_id: 'call_a', name: 'book_search', arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"q":"书"}' }, complete,
  ]), { model: 'm' }, chunk => emitted.push(chunk))
  assert.equal(result.choices[0].message.content, '中文内容')
  assert.equal(result.choices[0].message.tool_calls[0].function.arguments, '{"q":"书"}')
  assert.equal(result.choices[0].finish_reason, 'tool_calls')
  assert.equal(emitted.at(-1).usage.total_tokens, 7)
})

test('late usage-limit errors, incomplete responses and dropped streams never report success', async () => {
  for (const terminal of [null, { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'Plan limit' } } }, { type: 'response.incomplete' }]) {
    const chunks = []; const events = [{ type: 'response.output_text.delta', delta: 'partial' }, ...(terminal ? [terminal] : [])]
    await assert.rejects(convertResponse(encodeEvents(events), { model: 'm' }, chunk => chunks.push(chunk)))
    assert.equal(chunks.some(chunk => chunk.choices[0].finish_reason), false)
  }
})

test('HTTP bridge rejects foreign origins and missing local keys; forwards official errors without billing fallback', async (t) => {
  const store = memory(); let upstreamCalls = 0
  const auth = { store, enabled: true, active: {}, async accessToken() { return 'test-oauth' } }
  const server = http.createServer(createHandler(auth, { request: async (url, options) => {
    upstreamCalls++; assert.equal(options.headers.Authorization, 'Bearer test-oauth')
    if (url.endsWith('/models')) return Response.json({ models: [{ slug: 'visible', display_name: 'Visible', visibility: 'list' }, { slug: 'hidden', visibility: 'hide' }] })
    assert.equal(url, `${RESOURCE}/responses`)
    assert.equal(JSON.parse(options.body).store, false)
    return Response.json({ error: { code: 'subscription_sharing_user_not_eligible', message: 'Not eligible' } }, { status: 403 })
  } }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  assert.equal((await fetch(base + '/v1/models')).status, 401)
  assert.equal((await fetch(base + '/v1/models', { headers: { Origin: 'https://untrusted.example', Authorization: `Bearer ${store.state.localKey}` } })).status, 403)
  assert.equal(upstreamCalls, 0)
  const models = await (await fetch(base + '/v1/models', { headers: { Authorization: `Bearer ${store.state.localKey}` } })).json()
  assert.deepEqual(models.data.map(model => model.id), ['visible'])
  const response = await fetch(base + '/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${store.state.localKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'visible', messages: [{ role: 'user', content: 'test' }] }) })
  assert.equal(response.status, 403)
  assert.equal((await response.json()).error.code, 'subscription_sharing_user_not_eligible')
  assert.equal(upstreamCalls, 2)
  const loginPage = await fetch(base)
  assert.match(loginPage.headers.get('content-security-policy'), /form-action 'self' https:\/\/auth\.openai\.com/)
  const html = await loginPage.text()
  assert.equal(html.includes('test-oauth'), false)
  assert.equal(html.includes(store.state.localKey), false)
  assert.equal((await fetch(base + '/auth/start', { method: 'POST', body: 'csrf=wrong' })).status, 403)
})

test('Windows DPAPI survives restart and does not store plaintext credentials', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(root, '.cache/plus-test-'))
  try {
    const store = await openStore(directory)
    store.state.accounts.push({ accessToken: 'test-opaque-secret', email: '测试@example.test' })
    await Promise.all([store.save(), store.save()])
    assert.equal((await readFile(path.join(directory, 'credentials.dpapi'), 'utf8')).includes('test-opaque-secret'), false)
    const reopened = await openStore(directory)
    assert.equal(reopened.state.accounts[0].accessToken, 'test-opaque-secret')
    assert.equal(reopened.state.accounts[0].email, '测试@example.test')
    assert.equal(reopened.state.hostId, store.state.hostId)
    const encrypted = await readFile(path.join(directory, 'credentials.dpapi'), 'utf8')
    const readOnly = await readState(directory)
    assert.equal(readOnly.hostId, store.state.hostId)
    assert.equal(await readFile(path.join(directory, 'credentials.dpapi'), 'utf8'), encrypted)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('ReadAny configuration preserves unrelated settings, uses a local key and is idempotent', () => {
  const original = { readSettings: { fontSize: 21 }, translationConfig: { provider: { id: 'microsoft' } },
    hasCompletedOnboarding: false, aiConfig: { endpoints: [{ id: 'existing', apiKey: 'keep-existing-key' }],
      activeEndpointId: 'existing', activeModel: 'other-model', maxTokens: 12000 } }
  const next = configureSettings(original, 'local-only-key', ['account-model-a', 'account-model-b'], 123)
  assert.deepEqual(next.readSettings, original.readSettings)
  assert.deepEqual(next.translationConfig, original.translationConfig)
  assert.equal(next.hasCompletedOnboarding, false)
  assert.equal(next.aiConfig.endpoints[0].apiKey, 'keep-existing-key')
  assert.equal(next.aiConfig.maxTokens, 12000)
  assert.equal(next.aiConfig.activeModel, 'account-model-a')
  assert.equal(next.aiConfig.endpoints[1].baseUrl, BRIDGE_URL)
  assert.equal(next.aiConfig.endpoints[1].apiKey, 'local-only-key')
  assert.equal(original.aiConfig.activeModel, 'other-model')
  next.aiConfig.activeModel = 'account-model-b'
  const repeated = configureSettings(next, 'local-only-key', ['account-model-a', 'account-model-b'], 123)
  assert.equal(repeated.aiConfig.endpoints.length, 2)
  assert.equal(repeated.aiConfig.activeModel, 'account-model-b')
  assert.throws(() => configureSettings(original, 'local-only-key', []), /No account models/)
})

test('model setup authenticates only to the loopback bridge and rejects incomplete authorization', async () => {
  const state = { localKey: 'local-only-key' }
  assert.deepEqual(await accountModels(state, async (url, options) => {
    assert.equal(url, `${BRIDGE_URL}/models`)
    assert.equal(options.headers.Authorization, 'Bearer local-only-key')
    return Response.json({ data: [{ id: 'account-model' }] })
  }), ['account-model'])
  await assert.rejects(accountModels(state, async () => Response.json({ error: { message: 'Authorize ChatGPT first' } }, { status: 401 })), /Authorize ChatGPT first/)
})
