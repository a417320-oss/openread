$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'environment.ps1')
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'control.ps1') start
if ($LASTEXITCODE -ne 0) { throw 'Could not start the ChatGPT connection service.' }
$health=Invoke-RestMethod 'http://127.0.0.1:38618/health' -TimeoutSec 5
if (!$health.planEnabled) {
    Write-Output 'Optional ChatGPT connection: http://127.0.0.1:38618/'
} else {
$nodePath=Get-ReadAnyNode -ProjectRoot $projectRoot
& $nodePath (Join-Path $PSScriptRoot 'configure.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Could not apply ChatGPT settings. Existing settings have been preserved.' }
}
$executable=Join-Path $projectRoot 'runtime\app.exe'
Start-Process -FilePath $executable -WorkingDirectory (Split-Path $executable -Parent)
