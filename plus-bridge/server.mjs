import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { ChatGPTAuth, ConnectionError, RESOURCE } from './oauth.mjs'
import { openStore } from './storage.mjs'
import { toResponses, convertResponse } from './protocol.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
function equal(a, b) {
  const left = Buffer.from(a ?? ''), right = Buffer.from(b ?? '')
  return left.length === right.length && timingSafeEqual(left, right)
}
async function readBody(request, limit = 8 * 1024 * 1024) {
  let size = 0; const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw new ConnectionError('Request is too large', 413)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}
function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data))
}
function page(response, text) {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>OpenRead · ChatGPT 连接</title><style>body{font:16px/1.65 system-ui;background:#f8f6ef;color:#29261f;max-width:720px;margin:8vh auto;padding:24px}main{background:#fff;border:1px solid #ded9cc;border-radius:18px;padding:36px}h1{font-size:26px}button,a{font:inherit}button{padding:11px 20px;background:#242424;color:#fff;border:0;border-radius:8px;cursor:pointer}form{margin:18px 0}small{color:#68645b}a{color:#665235}code{overflow-wrap:anywhere}</style><main>${text}</main></html>`)
}

export function createHandler(auth, { request = fetch } = {}) {
  const csrf = randomBytes(32).toString('base64url')
  return async (req, res) => {
    const origin = `http://127.0.0.1:${req.socket.localPort}`
    const permittedOrigins = [origin, 'http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost']
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    // no-referrer makes native form POSTs send Origin: null in browsers.
    // Preserve same-origin form attribution; keep OAuth callback URLs private below.
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://auth.openai.com; frame-ancestors 'none'; base-uri 'none'")
    try {
      if (req.headers.host !== new URL(origin).host) throw new ConnectionError('Invalid local host', 403)
      if (req.headers.origin && !permittedOrigins.includes(req.headers.origin)) throw new ConnectionError('Origin is not permitted', 403)
      if (req.headers.origin) {
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin)
        res.setHeader('Vary', 'Origin')
        res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
      const url = new URL(req.url, origin)
      if (url.pathname === '/health' && req.method === 'GET') {
        json(res, 200, { service: 'readany-chatgpt-plan', connected: !!auth.active?.accessToken, planEnabled: auth.enabled }); return
      }
      if (url.pathname === '/' && req.method === 'GET') {
        const fields = `<input type="hidden" name="csrf" value="${csrf}">`
        const accountForms = auth.store.state.accounts.map((account, index) =>
          `<form method="post" action="/auth/start">${fields}<input type="hidden" name="clientId" value="${escape(account.clientId)}"><button data-oai-siwc-button>Continue with ChatGPT</button><br><small>账户 ${index + 1}：${escape(account.email || '已保存的 ChatGPT 账户')}${account.clientId === auth.store.state.activeClientId ? '（当前）' : ''}</small></form>`).join('')
        page(res, `<h1>OpenRead · ChatGPT 订阅连接</h1><p>${auth.enabled ? '已连接，可返回 OpenRead 使用 AI。' : '使用现有 ChatGPT Plus / Pro 订阅额度，连接后可在 OpenRead 中问答、总结和翻译。'}</p><p>额度与 ChatGPT 的订阅用量共享。阅读片段和提问将发送给 OpenAI；本服务不会切换到 API 付费路径。</p>${accountForms}<form method="post" action="/auth/start">${fields}<input type="hidden" name="clientId" value="new"><button data-oai-siwc-button>Continue with ChatGPT</button><br><small>${accountForms ? '添加另一个 ChatGPT 账户' : '登录并授权使用你的 ChatGPT 订阅'}</small></form>${auth.active?.accessToken ? `<form method="post" action="/auth/logout">${fields}<button>断开当前账户</button></form>` : ''}<p><a href="https://chatgpt.com/settings/usage" rel="noreferrer">查看 ChatGPT 用量与额度</a></p><small>登录和授权在 OpenAI 官方页面完成。账号密码不会交给 OpenRead。</small>`)
        return
      }
      if (url.pathname === '/auth/callback' && req.method === 'GET') {
        res.setHeader('Referrer-Policy', 'no-referrer')
        const enabled = await auth.complete(url.searchParams)
        // Remove the code and state from the address bar immediately.
        res.writeHead(303, { Location: enabled ? '/?connected=1' : '/?permission=missing' }); res.end(); return
      }
      if (['/auth/start', '/auth/logout'].includes(url.pathname) && req.method === 'POST') {
        if (req.headers.origin && req.headers.origin !== origin) throw new ConnectionError('Use the local connection page', 403)
        const form = new URLSearchParams(await readBody(req, 10000))
        if (!equal(form.get('csrf'), csrf)) throw new ConnectionError('Reload the connection page before continuing', 403)
        if (url.pathname === '/auth/logout') {
          const revoked = await auth.signOut()
          page(res, `<h1>已断开当前账户</h1><p>${revoked ? '已停止使用并清除本机令牌。' : '已停止使用并清除本机令牌，但未确认远端撤销。请在 ChatGPT 设置中断开此应用。'}</p><a href="/">返回</a>`); return
        }
        const clientId = form.get('clientId')
        const target = auth.begin(`${origin}/auth/callback`, clientId === 'new' ? null : clientId)
        res.writeHead(303, { Location: target }); res.end(); return
      }
      if (!url.pathname.startsWith('/v1/')) throw new ConnectionError('Not found', 404)
      if (!equal(req.headers.authorization, `Bearer ${auth.store.state.localKey}`)) throw new ConnectionError('Invalid local connection key', 401)
      const accessToken = await auth.accessToken()
      const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
      if (url.pathname === '/v1/models' && req.method === 'GET') {
        const response = await request(`${RESOURCE}/models`, { headers, signal: AbortSignal.timeout(25000) })
        const data = await response.json()
        if (!response.ok) { json(res, response.status, data); return }
        if (!Array.isArray(data.models)) throw new ConnectionError('Unexpected ChatGPT model catalog', 502)
        json(res, 200, { object: 'list', data: data.models.filter(model => model.visibility === 'list').map(model => ({ id: model.slug, object: 'model', owned_by: 'openai-chatgpt-plan', display_name: model.display_name })) }); return
      }
      if (url.pathname !== '/v1/chat/completions' || req.method !== 'POST') throw new ConnectionError('Only models and chat completions are supported', 404)
      const body = JSON.parse(await readBody(req))
      const payload = toResponses(body)
      const abort = new AbortController()
      res.once('close', () => abort.abort())
      const response = await request(`${RESOURCE}/responses`, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(180000)]) })
      const requestId = response.headers.get('x-request-id') ?? response.headers.get('openai-request-id')
      if (requestId) res.setHeader('x-request-id', requestId)
      if (!response.ok) {
        const text = await response.text()
        try { json(res, response.status, JSON.parse(text)) }
        catch { json(res, response.status, { error: { message: text.slice(0, 2000), code: 'openai_request_failed' } }) }
        return
      }
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' })
        try {
          await convertResponse(response, body, chunk => res.write(`data: ${JSON.stringify(chunk)}\n\n`))
          res.end('data: [DONE]\n\n')
        } catch (error) {
          res.end(`data: ${JSON.stringify({ error: { message: error.message, code: error.code ?? 'stream_incomplete' } })}\n\n`)
        }
      } else json(res, 200, await convertResponse(response, body))
    } catch (error) {
      if (!res.headersSent) json(res, error.status ?? (error instanceof SyntaxError ? 400 : 502), { error: { message: error.message, code: error.code ?? 'bridge_error' } })
      else res.end()
    }
  }
}

export async function startBridge(port = 38618, directory = path.join(root, '.cache/plus')) {
  let handler
  const server = http.createServer((req, res) => handler ? handler(req, res) : json(res, 503, { error: { message: 'Starting' } }))
  // Acquire the port before reading/creating credentials, preventing two owners.
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  try { handler = createHandler(new ChatGPTAuth(await openStore(directory))) }
  catch (error) { server.close(); throw error }
  return server
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startBridge()
  console.log(`OpenRead ChatGPT connection: http://127.0.0.1:${server.address().port}`)
}
