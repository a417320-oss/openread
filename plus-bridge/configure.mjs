import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readState, protect } from './storage.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const BRIDGE_URL = 'http://127.0.0.1:38618/v1'

export function configureSettings(settings, localKey, models, now = Date.now()) {
  if (!localKey || !Array.isArray(models) || !models.length || models.some(model => typeof model !== 'string' || !model)) throw new Error('No account models available; finish ChatGPT authorization first.')
  const result = structuredClone(settings)
  const id = 'readany-chatgpt-plan'
  const old = result.aiConfig ?? {}
  const previous = old.endpoints?.find(endpoint => endpoint.id === id)
  const endpoint = { id, name: 'ChatGPT Plus（订阅额度）', provider: 'openai', apiKey: localKey,
    baseUrl: BRIDGE_URL, useExactRequestUrl: false, models: [...models], modelsFetched: true, modelsFetching: false }
  result.aiConfig = { temperature: 0.7, maxTokens: 8192, slidingWindowSize: 8, ...old,
    endpoints: [...(old.endpoints ?? []).filter(item => item.id !== id), endpoint], activeEndpointId: id,
    activeModel: previous && models.includes(old.activeModel) ? old.activeModel : models[0] }
  result.settingsUpdatedAt = now
  return result
}

export async function accountModels(state, request = fetch) {
  const response = await request(`${BRIDGE_URL}/models`, {
    headers: { Authorization: `Bearer ${state.localKey}` }, signal: AbortSignal.timeout(30000),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message ?? 'ChatGPT model lookup failed')
  const models = data.data?.map(model => model.id)
  if (!models?.length) throw new Error('No models available to the selected ChatGPT account')
  return models
}

export async function applyConfiguration({ request = fetch } = {}) {
  const directory = path.join(root, '.cache/plus')
  const state = await readState(directory)
  const models = await accountModels(state, request)
  const defaultData = path.join(process.env.APPDATA, 'com.readany.app')
  let dataRoot = defaultData
  try {
    const config = JSON.parse(await readFile(path.join(defaultData, 'desktop-data-root.json'), 'utf8'))
    if (typeof config.dataRoot === 'string' && config.dataRoot.trim()) dataRoot = path.resolve(config.dataRoot.replace(/^file:\/\//, ''))
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const settingsPath = path.join(dataRoot, 'readany-store/settings.json')
  const before = JSON.parse(await readFile(settingsPath, 'utf8'))
  const active = before.aiConfig?.endpoints?.find(endpoint => endpoint.id === before.aiConfig?.activeEndpointId)
  if (active?.id === 'readany-chatgpt-plan' && active.apiKey === state.localKey && active.baseUrl === BRIDGE_URL && models.includes(before.aiConfig.activeModel)) {
    return { model: before.aiConfig.activeModel, modelCount: models.length, changed: false }
  }
  // Graceful close flushes ReadAny's pending settings before editing its file.
  const executable = path.join(root, 'runtime/app.exe')
  const close = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    '$ErrorActionPreference="Stop";$apps=@(Get-Process -Name app -ErrorAction SilentlyContinue|Where-Object {$_.Path -eq $env:READANY_CONFIG_EXE});foreach($app in $apps){if(!$app.CloseMainWindow()){throw "Close ReadAny before applying AI settings"};if(!$app.WaitForExit(10000)){throw "ReadAny is still open; close it before retrying"}}'],
    { env: { ...process.env, READANY_CONFIG_EXE: executable }, encoding: 'utf8', windowsHide: true, timeout: 15000 })
  if (close.status !== 0) throw new Error('Please close ReadAny, then run configuration again.')
  const raw = await readFile(settingsPath, 'utf8')
  const next = configureSettings(JSON.parse(raw), state.localKey, models)
  const backup = path.join(directory, 'settings-before-plus.dpapi')
  try { await access(backup) }
  catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(backup, protect(raw), { mode: 0o600 }) }
  await mkdir(path.dirname(settingsPath), { recursive: true })
  const temporary = settingsPath + '.plus.tmp'
  await writeFile(temporary, JSON.stringify(next))
  await rename(temporary, settingsPath)
  return { model: next.aiConfig.activeModel, modelCount: models.length, changed: true }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await applyConfiguration()
    console.log(`ReadAny configured for ChatGPT subscription: ${result.model} (${result.modelCount} models).`)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
