param([ValidateSet('start','stop','status')][string]$Action='start')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$cacheDir=Join-Path $projectRoot '.cache\plus'
$recordPath=Join-Path $cacheDir 'process.json'
$url='http://127.0.0.1:38618'
$running=$null
if (Test-Path -LiteralPath $recordPath) {
    $record=Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
    $candidate=Get-Process -Id $record.processId -ErrorAction SilentlyContinue
    if ($candidate -and $candidate.ProcessName -eq 'node' -and $candidate.StartTime.ToUniversalTime().ToString('o') -eq $record.startedAt) { $running=$candidate }
}
if ($Action -eq 'stop') {
    if ($running) { Stop-Process -Id $running.Id; $running.WaitForExit() }
    Remove-Item -LiteralPath $recordPath -ErrorAction SilentlyContinue
    Write-Output 'ReadAny Plus bridge stopped.'
    exit 0
}
if ($running) {
    $health=Invoke-RestMethod "$url/health" -TimeoutSec 5
    if ($health.service -ne 'readany-chatgpt-plan') { throw 'Unexpected service at the local port' }
    Write-Output "ReadAny Plus bridge is running: $url (plan enabled: $($health.planEnabled))"
    exit 0
}
if ($Action -eq 'status') { Write-Output 'ReadAny Plus bridge is not running.'; exit 1 }
New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
# Restrict all credential files and backups to this Windows user and SYSTEM.
$userSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $cacheDir /inheritance:r /grant:r "*$($userSid):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect local credential directory' }
. (Join-Path $PSScriptRoot 'environment.ps1')
$nodePath=Get-ReadAnyNode -ProjectRoot $projectRoot
Initialize-ReadAnyProxy
$entry=Join-Path $PSScriptRoot 'server.mjs'
$running=Start-Process -FilePath $nodePath -ArgumentList @('--use-env-proxy',('"'+$entry+'"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $cacheDir 'stdout.log') -RedirectStandardError (Join-Path $cacheDir 'stderr.log')
@{processId=$running.Id;startedAt=$running.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding UTF8
for ($attempt=0;$attempt -lt 60;$attempt++) {
    if ($running.HasExited) { throw 'Plus bridge exited. Check .cache/plus/stderr.log.' }
    try {
        $health=Invoke-RestMethod "$url/health" -TimeoutSec 1
        if ($health.service -eq 'readany-chatgpt-plan') { Write-Output "ReadAny Plus bridge started: $url"; exit 0 }
    } catch { }
    Start-Sleep -Milliseconds 250
}
Stop-Process -Id $running.Id -ErrorAction SilentlyContinue
throw 'Plus bridge startup timed out.'
