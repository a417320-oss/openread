import { spawnSync } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'

export function protect(text, decrypt = false) {
  if (process.platform !== 'win32') throw new Error('This deployment uses Windows DPAPI credential protection')
  const command = '[void][Reflection.Assembly]::LoadWithPartialName("System.Security");' +
    '[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);' +
    '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$value=[Console]::In.ReadToEnd();' +
    (decrypt
      ? '$bytes=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($value),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))'
      : '$bytes=[Text.Encoding]::UTF8.GetBytes($value);[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))')
  // Credentials travel over stdin, never command-line arguments or logs.
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { input: text, encoding: 'utf8', windowsHide: true, timeout: 15000 })
  if (result.status !== 0) throw new Error('Windows credential protection failed')
  return result.stdout.trim()
}

export function initialState() {
  return { hostId: `urn:uuid:${randomUUID()}`, localKey: randomBytes(32).toString('base64url'), accounts: [], activeClientId: null }
}

export async function readState(directory) {
  return JSON.parse(protect(await readFile(path.join(directory, 'credentials.dpapi'), 'utf8'), true))
}

export async function openStore(directory) {
  await mkdir(directory, { recursive: true })
  const filename = path.join(directory, 'credentials.dpapi')
  let state
  let created = false
  try { state = await readState(directory) }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = initialState(); created = true }
  let queue = Promise.resolve()
  const save = () => {
    const snapshot = JSON.stringify(state)
    const operation = queue.catch(() => {}).then(async () => {
      const temporary = filename + '.tmp'
      await writeFile(temporary, protect(snapshot), { mode: 0o600 })
      await rename(temporary, filename)
    })
    queue = operation
    return operation
  }
  if (created) await save()
  return { state, save }
}
