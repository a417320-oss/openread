import { createHash, randomBytes } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'

export const AUTH = 'https://auth.openai.com'
export const RESOURCE = 'https://api.openai.com/v1'
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct'
const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`
const keys = createRemoteJWKSet(new URL(`${AUTH}/.well-known/jwks.json`))

export class ConnectionError extends Error {
  constructor(message, status = 400, code = 'connection_error') { super(message); this.status = status; this.code = code }
}

export class ChatGPTAuth {
  constructor(store, { request = fetch, keySet = keys, now = () => Date.now() } = {}) {
    this.store = store; this.request = request; this.keySet = keySet; this.now = now
    this.pending = new Map(); this.refreshing = null
  }
  get active() { return this.store.state.accounts.find(a => a.clientId === this.store.state.activeClientId) }
  get enabled() { return !!this.active?.accessToken && this.active.scopes.includes(PLAN_SCOPE) }
  begin(redirectUri, clientId = this.store.state.activeClientId) {
    const account = clientId ? this.store.state.accounts.find(a => a.clientId === clientId) : null
    if (clientId && !account) throw new ConnectionError('Unknown saved ChatGPT account')
    const fresh = () => randomBytes(32).toString('base64url')
    const state = fresh(), nonce = fresh(), verifier = fresh()
    for (const [key, value] of this.pending) if (value.expires < this.now()) this.pending.delete(key)
    if (this.pending.size >= 5) throw new ConnectionError('Too many pending sign-ins; retry later', 429)
    this.pending.set(state, { nonce, verifier, redirectUri, account, expires: this.now() + 10 * 60_000 })
    const params = new URLSearchParams({
      client_id: account?.clientId ?? 'dynamic_agent_client', ext_agent_host_id: this.store.state.hostId,
      response_type: 'code', redirect_uri: redirectUri, scope: SCOPES, resource: RESOURCE,
      state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    })
    if (!account) params.set('agent_name_hint', 'OpenRead')
    if (account?.idToken) params.set('id_token_hint', account.idToken)
    if (account?.email) params.set('login_hint', account.email)
    if (account?.accessToken && !account.scopes.includes(PLAN_SCOPE)) params.set('prompt', 'consent')
    return `${AUTH}/api/accounts/authorize?${params}`
  }
  async token(body) {
    const response = await this.request(`${AUTH}/api/accounts/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body), signal: AbortSignal.timeout(25000),
    })
    const data = await response.json()
    if (!response.ok) {
      const code = typeof data.error === 'string' ? data.error : data.error?.code ?? 'oauth_error'
      throw new ConnectionError(`OpenAI authorization failed (${code}); sign in again if required.`, response.status, code)
    }
    if (!data.access_token || data.token_type?.toLowerCase() !== 'bearer' || !(data.expires_in > 0)) throw new ConnectionError('OpenAI returned an incomplete token response')
    return data
  }
  async complete(query) {
    const transaction = this.pending.get(query.get('state'))
    if (!transaction || transaction.expires < this.now()) throw new ConnectionError('Sign-in expired or state did not match. Start again.')
    this.pending.delete(query.get('state')) // One-time callback, including errors.
    if (query.has('error')) throw new ConnectionError('ChatGPT authorization was declined. No plan requests were enabled.')
    const clientId = query.get('client_id') ?? transaction.account?.clientId
    if (!clientId || clientId === 'dynamic_agent_client' || (transaction.account && clientId !== transaction.account.clientId)) throw new ConnectionError('Issued client ID was missing or did not match')
    if (!query.get('code')) throw new ConnectionError('Authorization code was missing')
    let tokens
    try {
      tokens = await this.token({ grant_type: 'authorization_code', client_id: clientId,
        code: query.get('code'), code_verifier: transaction.verifier, redirect_uri: transaction.redirectUri, resource: RESOURCE })
    } catch (error) {
      if (error.code === 'invalid_grant' && !this.store.state.accounts.some(a => a.clientId === clientId)) {
        this.store.state.accounts.push({ clientId, scopes: [] })
        await this.store.save()
      }
      throw error
    }
    const { payload } = await jwtVerify(tokens.id_token, this.keySet, {
      issuer: AUTH, audience: clientId, requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5,
      algorithms: ['RS256', 'ES256'], currentDate: new Date(this.now()),
    })
    const existing = this.store.state.accounts.find(a => a.clientId === clientId)
    if (payload.nonce !== transaction.nonce || !payload.sub || payload.iat > this.now() / 1000 + 5 ||
        (payload.azp && payload.azp !== clientId) || (existing?.subject && payload.sub !== existing.subject)) throw new ConnectionError('OpenAI identity validation failed')
    const account = { clientId, subject: payload.sub, email: payload.email ?? '', idToken: tokens.id_token,
      accessToken: tokens.access_token, refreshToken: tokens.refresh_token, scopes: String(tokens.scope ?? '').split(/\s+/),
      expiresAt: this.now() + tokens.expires_in * 1000 }
    const index = this.store.state.accounts.findIndex(a => a.clientId === clientId)
    if (index < 0) this.store.state.accounts.push(account)
    else this.store.state.accounts[index] = account
    this.store.state.activeClientId = clientId
    await this.store.save()
    return this.enabled
  }
  async accessToken() {
    if (!this.enabled) throw new ConnectionError('Open the local connection page and authorize use of your ChatGPT plan.', 401, 'chatgpt_login_required')
    if (this.active.expiresAt > this.now() + 60_000) return this.active.accessToken
    if (!this.refreshing) this.refreshing = this.refresh().finally(() => { this.refreshing = null })
    return this.refreshing
  }
  async refresh() {
    const account = this.active
    if (!account.refreshToken) throw new ConnectionError('ChatGPT sign-in expired; sign in again.', 401)
    try {
      const tokens = await this.token({ grant_type: 'refresh_token', client_id: account.clientId, refresh_token: account.refreshToken, resource: RESOURCE })
      Object.assign(account, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? account.refreshToken,
        idToken: tokens.id_token ?? account.idToken, scopes: tokens.scope ? tokens.scope.split(/\s+/) : account.scopes,
        expiresAt: this.now() + tokens.expires_in * 1000 })
      await this.store.save()
      if (!account.scopes.includes(PLAN_SCOPE)) throw new ConnectionError('ChatGPT plan permission is not enabled', 403)
      return account.accessToken
    } catch (error) {
      if (['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'].includes(error.code)) {
        delete account.accessToken; delete account.refreshToken; delete account.idToken
        await this.store.save()
      }
      throw error
    }
  }
  async signOut() {
    const account = this.active
    if (!account) return true
    let revoked = !account.refreshToken
    try {
      if (account.refreshToken) {
        const discovery = await this.request(`${AUTH}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15000) })
        const { revocation_endpoint: endpoint } = await discovery.json()
        if (!endpoint || new URL(endpoint).origin !== AUTH) throw new Error('Invalid revocation endpoint')
        const result = await this.request(endpoint, { method: 'POST', body: new URLSearchParams({ token: account.refreshToken, token_type_hint: 'refresh_token', client_id: account.clientId }), signal: AbortSignal.timeout(15000) })
        revoked = result.ok
      }
    } catch { revoked = false }
    delete account.accessToken; delete account.refreshToken; delete account.idToken
    await this.store.save()
    return revoked
  }
}
