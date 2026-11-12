function Get-ReadAnyNode {
    param([Parameter(Mandatory=$true)][string]$ProjectRoot)
    $bundledNode=Join-Path $ProjectRoot 'runtime\node.exe'
    if (Test-Path -LiteralPath $bundledNode -PathType Leaf) { return $bundledNode }
    $recordPath=Join-Path $ProjectRoot '.cache\plus\runtime.json'
    if (Test-Path -LiteralPath $recordPath) {
        $record=Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
        if ($record.nodePath -and (Test-Path -LiteralPath $record.nodePath -PathType Leaf)) {
            return [string]$record.nodePath
        }
    }
    $nodeCommand=Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (!$nodeCommand) { throw 'Node.js is unavailable. Reinstall the ReadAny desktop shortcuts to select its runtime.' }
    return $nodeCommand.Source
}

function Initialize-ReadAnyProxy {
    param([scriptblock]$ProxyResolver={
        [System.Net.WebRequest]::GetSystemWebProxy().GetProxy([uri]'https://auth.openai.com/')
    })
    # Explorer-launched shortcuts do not inherit Codex's proxy environment.
    # Respect explicit overrides; otherwise use the existing Windows system proxy.
    if (!$env:HTTPS_PROXY -and !$env:HTTP_PROXY -and !$env:ALL_PROXY) {
        $systemProxy=& $ProxyResolver
        if ($systemProxy -and $systemProxy.AbsoluteUri -ne 'https://auth.openai.com/') {
            if ($systemProxy.Scheme -notin @('http','https')) { throw 'Windows proxy scheme is not supported by the Node runtime.' }
            $env:HTTPS_PROXY=$systemProxy.GetLeftPart([UriPartial]::Authority)
            $env:HTTP_PROXY=$env:HTTPS_PROXY
        }
    }
    foreach ($localHost in @('localhost','127.0.0.1','::1')) {
        if (@($env:NO_PROXY -split ',' | ForEach-Object { $_.Trim() }) -notcontains $localHost) {
            $env:NO_PROXY=(@($env:NO_PROXY,$localHost) | Where-Object { $_ }) -join ','
        }
    }
}
