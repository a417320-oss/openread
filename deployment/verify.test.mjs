import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const release = JSON.parse(readFileSync(path.join(root, 'deployment/release.json'), 'utf8'))
const executable = path.join(root, 'runtime/app.exe')

test('official installer SHA-256 matches the GitHub release digest', () => {
  const installer = readFileSync(path.join(root, '.cache/downloads', release.installer))
  assert.equal(createHash('sha256').update(installer).digest('hex'), release.sha256)
})

test('installed Windows executable matches the selected release version', () => {
  const binary = readFileSync(executable)
  assert.equal(binary.subarray(0, 2).toString(), 'MZ')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    '(Get-Item -LiteralPath $env:READANY_VERIFY_EXE).VersionInfo.ProductVersion'], {
    env: { ...process.env, READANY_VERIFY_EXE: executable }, encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), release.version)
})

test('bundled CLI JavaScript passes syntax validation', () => {
  const result = spawnSync(process.execPath, ['--check', path.join(root, 'runtime/readany-cli/bin/readany.js')], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

test('desktop app is running from the installed directory', () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    'if (!(Get-Process -Name app -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:READANY_VERIFY_EXE })) { exit 1 }'], {
    env: { ...process.env, READANY_VERIFY_EXE: executable }, encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(existsSync(path.join(root, 'Start-ReadAny.cmd')))
})

test('desktop app has initialized its SQLite database', () => {
  const database = path.join(process.env.APPDATA, 'com.readany.app/readany.db')
  assert.equal(readFileSync(database).subarray(0, 16).toString(), 'SQLite format 3\0')
})

test('DeepRead is removed and its former server port is closed', async () => {
  assert.equal(existsSync(path.join(root, '..', 'DeepRead')), false)
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 38617 })
    socket.setTimeout(3000)
    socket.once('connect', () => { socket.destroy(); reject(new Error('DeepRead port is still listening')) })
    socket.once('error', (error) => {
      socket.destroy()
      if (error.code === 'ECONNREFUSED') resolve()
      else reject(error)
    })
    socket.once('timeout', () => { socket.destroy(); reject(new Error('Cannot verify old server shutdown')) })
  })
})
