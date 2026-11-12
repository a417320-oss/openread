param([ValidateRange(1,5)][int]$Rounds=2)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$executable=Join-Path $projectRoot 'runtime\app.exe'
$shortcutPath=Join-Path ([Environment]::GetFolderPath('Desktop')) 'OpenRead.lnk'
$settingsPath=Join-Path $env:APPDATA 'com.readany.app\readany-store\settings.json'
$initial=Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
$expectedModel=$initial.aiConfig.activeModel
if (!$expectedModel) { throw 'Choose a Plus model before this restart test.' }
$details=@()
. (Join-Path $projectRoot 'plus-bridge\close-app.ps1')

for ($round=1;$round -le $Rounds;$round++) {
    Close-ReadAnyApplication -ExecutablePath $executable
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot 'plus-bridge\control.ps1') stop
    if ($LASTEXITCODE -ne 0) { throw 'Failed to stop the local bridge before the restart test.' }
    # Reproduce Explorer startup: no Codex proxy variables and no Node-specific PATH.
    foreach ($name in @('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY')) {
        [Environment]::SetEnvironmentVariable($name,$null,'Process')
    }
    $env:PATH="$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
    $launcher=Start-Process -FilePath $shortcutPath -PassThru
    if ($launcher) {
        if (!$launcher.WaitForExit(45000)) { throw 'The desktop launcher did not finish in time.' }
        if ($launcher.ExitCode -ne 0) { throw "Desktop launcher failed with exit code $($launcher.ExitCode)." }
    }
    $ready=$false
    for ($attempt=0;$attempt -lt 30;$attempt++) {
        try {
            $health=Invoke-RestMethod 'http://127.0.0.1:38618/health' -TimeoutSec 2
            $runningApps=@(Get-Process -Name app -ErrorAction SilentlyContinue | Where-Object Path -eq $executable)
            if ($runningApps.Count -eq 1 -and $health.planEnabled) { $ready=$true;break }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    if (!$ready) { throw 'Desktop startup did not restore both ReadAny and its Plus connection.' }
    # Allow normal store hydration/debounced saves, then check that startup kept the model.
    Start-Sleep -Seconds 3
    $settings=Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    $endpoint=$settings.aiConfig.endpoints | Where-Object id -eq $settings.aiConfig.activeEndpointId
    if ($endpoint.id -ne 'readany-chatgpt-plan' -or $settings.aiConfig.activeModel -ne $expectedModel -or $endpoint.models -notcontains $expectedModel) {
        throw 'The configured model was not preserved after desktop startup.'
    }
    $details+=@{round=$round;model=$expectedModel;modelCount=$endpoint.models.Count;bridgeReady=$true;appProcessCount=$runningApps.Count}
    Write-Output "Desktop restart $round passed: $expectedModel, $($endpoint.models.Count) models."
}
@{checkedAt=[DateTime]::UtcNow.ToString('o');rounds=$details;cleanEnvironment=$true} |
    ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $projectRoot '.cache\plus\desktop-restart-verification.json') -Encoding UTF8
