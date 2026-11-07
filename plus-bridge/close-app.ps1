function Close-ReadAnyApplication {
    param(
        [Parameter(Mandatory=$true)][string]$ExecutablePath,
        [ValidateRange(100,60000)][int]$TimeoutMilliseconds=30000,
        [scriptblock]$GetProcesses={ @(Get-Process -Name app -ErrorAction SilentlyContinue | Where-Object Path -eq $ExecutablePath) },
        [scriptblock]$StopResidualProcess={ param($processId) Stop-Process -Id $processId -ErrorAction Stop }
    )
    $deadline=[DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    $requested=@{}
    while ([DateTime]::UtcNow -lt $deadline) {
        $runningApps=@(& $GetProcesses)
        if (!$runningApps.Count) { return }
        foreach ($runningApp in $runningApps) {
            $windowHandle=[string]$runningApp.MainWindowHandle
            if ($windowHandle -ne '0' -and !$requested.ContainsKey($windowHandle)) {
                if (!$runningApp.CloseMainWindow()) { throw 'ReadAny could not accept a normal close request.' }
                $requested[$windowHandle]=$true
            }
        }
        # Re-query process metadata so another reading window can become the main window.
        Start-Sleep -Milliseconds 200
    }
    $residualApps=@(& $GetProcesses)
    if (!$residualApps.Count) { return }
    foreach ($residual in $residualApps) {
        if ($residual.MainWindowHandle -ne 0 -or $residual.Path -ne $ExecutablePath) {
            throw 'ReadAny still has an open window. Close its remaining windows, then retry.'
        }
    }
    # All windows accepted normal close and had the full grace period to flush writes.
    # Tauri can leave a windowless process behind; only clean up that exact executable.
    foreach ($residual in $residualApps) { & $StopResidualProcess $residual.Id }
}
