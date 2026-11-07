import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const powershell = (args, env = {}) => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 20000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout.trim()
}

test('desktop and Start menu shortcuts use the Plus launcher and preserve original shortcut backups', { skip: process.platform !== 'win32' }, async () => {
  await mkdir(path.join(root, '.cache'), { recursive: true })
  const fixture = await mkdtemp(path.join(root, '.cache/desktop-shortcut-test-'))
  const desktop = path.join(fixture, 'Desktop 中文'), programs = path.join(fixture, 'Programs 中文'), state = path.join(fixture, 'State')
  await mkdir(desktop); await mkdir(programs)
  const shortcutPath = path.join(desktop, 'ReadAny.lnk')
  const env = { READANY_TEST_SHORTCUT: shortcutPath, READANY_TEST_EXE: path.join(root, 'runtime/app.exe') }
  try {
    powershell(['-Command', '$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:READANY_TEST_SHORTCUT);$s.TargetPath=$env:READANY_TEST_EXE;$s.Save()'], env)
    const original = await readFile(shortcutPath)
    const args = ['-File', path.join(root, 'plus-bridge/install-shortcuts.ps1'), '-DesktopDirectory', desktop, '-ProgramsDirectory', programs, '-StateDirectory', state]
    powershell(args)
    for (const directory of [desktop, programs]) {
      const data = JSON.parse(powershell(['-Command', '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:READANY_TEST_SHORTCUT);@{target=$s.TargetPath;arguments=$s.Arguments;cwd=$s.WorkingDirectory;icon=$s.IconLocation}|ConvertTo-Json'], { READANY_TEST_SHORTCUT: path.join(directory, 'ReadAny.lnk') }))
      assert.match(data.target, /WindowsPowerShell\\v1\.0\\powershell\.exe$/i)
      assert.ok(data.arguments.includes(`-File "${path.join(root, 'plus-bridge/launch.ps1')}"`))
      assert.match(data.arguments, /-WindowStyle Hidden/)
      assert.equal(data.cwd, root)
      assert.ok(data.icon.includes('app.exe'))
    }
    const backup = path.join(state, 'shortcut-backups/desktop-ReadAny.lnk')
    assert.deepEqual(await readFile(backup), original)
    powershell(args)
    assert.deepEqual(await readFile(backup), original)
    const record = JSON.parse((await readFile(path.join(state, 'runtime.json'), 'utf8')).replace(/^\uFEFF/, ''))
    assert.ok(path.isAbsolute(record.nodePath))
  } finally { await rm(fixture, { recursive: true, force: true }) }
})

test('desktop startup resolves its pinned Node runtime even when PATH has no node', { skip: process.platform !== 'win32' }, async () => {
  const fixture = await mkdtemp(path.join(root, '.cache/pinned-runtime-test-'))
  try {
    await mkdir(path.join(fixture, '.cache/plus'), { recursive: true })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path.join(fixture, '.cache/plus/runtime.json'), JSON.stringify({ nodePath: process.execPath }))
    const output = powershell(['-Command', '. $env:READANY_TEST_HELPER;$env:PATH=$env:SystemRoot+"\\System32";[Console]::Out.Write((Get-ReadAnyNode -ProjectRoot $env:READANY_TEST_ROOT))'], { READANY_TEST_HELPER: path.join(root, 'plus-bridge/environment.ps1'), READANY_TEST_ROOT: fixture })
    assert.equal(output, process.execPath)
  } finally { await rm(fixture, { recursive: true, force: true }) }
})

test('desktop startup uses the Windows proxy without overriding explicit proxy settings or proxying loopback', { skip: process.platform !== 'win32' }, () => {
  const output = powershell(['-Command', '. $env:READANY_TEST_HELPER;$env:HTTP_PROXY=$null;$env:HTTPS_PROXY=$null;$env:ALL_PROXY=$null;$env:NO_PROXY="example.test";Initialize-ReadAnyProxy -ProxyResolver {[uri]"http://127.0.0.1:17897"};if($env:HTTPS_PROXY -ne "http://127.0.0.1:17897"){throw "Missing Windows proxy"};foreach($h in @("localhost","127.0.0.1","::1","example.test")){if(($env:NO_PROXY -split ",") -notcontains $h){throw "Missing local bypass"}};$env:HTTPS_PROXY="http://127.0.0.1:17898";Initialize-ReadAnyProxy -ProxyResolver {throw "Explicit proxy was overridden"};if($env:HTTPS_PROXY -ne "http://127.0.0.1:17898"){throw "Proxy changed"};Write-Output "Proxy checks passed"'], { READANY_TEST_HELPER: path.join(root, 'plus-bridge/environment.ps1') })
  assert.equal(output, 'Proxy checks passed')
})

test('normal app shutdown closes each distinct reading window without terminating the process', { skip: process.platform !== 'win32' }, () => {
  const output = powershell(['-Command', '. $env:READANY_TEST_HELPER;$script:closeCount=0;$first=[pscustomobject]@{MainWindowHandle=1};$first|Add-Member ScriptMethod CloseMainWindow {$script:closeCount++;return $true};$second=[pscustomobject]@{MainWindowHandle=2};$second|Add-Member ScriptMethod CloseMainWindow {$script:closeCount++;return $true};Close-ReadAnyApplication -ExecutablePath "test.exe" -GetProcesses {if($script:closeCount -eq 0){$first}elseif($script:closeCount -eq 1){$second}};if($script:closeCount -ne 2){throw "A reading window was not closed"};Write-Output "Normal shutdown checks passed"'], { READANY_TEST_HELPER: path.join(root, 'plus-bridge/close-app.ps1') })
  assert.equal(output, 'Normal shutdown checks passed')
})

test('shutdown cleans up only a matching windowless residual after its grace period', { skip: process.platform !== 'win32' }, () => {
  const output = powershell(['-Command', '. $env:READANY_TEST_HELPER;$script:stopped=$false;$residual=[pscustomobject]@{Id=123;MainWindowHandle=0;Path="test.exe"};Close-ReadAnyApplication -ExecutablePath "test.exe" -TimeoutMilliseconds 100 -GetProcesses {$residual} -StopResidualProcess {param($processId)if($processId -ne 123){throw "Wrong process"};$script:stopped=$true};if(!$script:stopped){throw "Residual was not cleaned up"};$visible=[pscustomobject]@{Id=124;MainWindowHandle=1;Path="test.exe"};$visible|Add-Member ScriptMethod CloseMainWindow {return $true};$refused=$false;try{Close-ReadAnyApplication -ExecutablePath "test.exe" -TimeoutMilliseconds 100 -GetProcesses {$visible} -StopResidualProcess {throw "Visible app was terminated"}}catch{if($_.Exception.Message -notlike "*still has an open window*"){throw};$refused=$true};if(!$refused){throw "Visible window was not protected"};Write-Output "Residual checks passed"'], { READANY_TEST_HELPER: path.join(root, 'plus-bridge/close-app.ps1') })
  assert.equal(output, 'Residual checks passed')
})
