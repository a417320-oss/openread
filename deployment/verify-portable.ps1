param([Parameter(Mandatory=$true)][string]$PackageDirectory,[string]$ExpectedVersion='1.4.0')
$ErrorActionPreference='Stop'
$exe=Join-Path $PackageDirectory 'runtime\app.exe'
$info=(Get-Item -LiteralPath $exe).VersionInfo
if ($info.ProductVersion -ne $ExpectedVersion -or $info.ProductName -ne 'OpenRead') { throw 'Wrong application/version in portable package.' }
$node=Join-Path $PackageDirectory 'runtime\node.exe'
$cli=Join-Path $PackageDirectory 'runtime\readany-cli\bin\readany.js'
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('openread-package-test-' + [guid]::NewGuid().ToString())
$oldDataRoot=$env:READANY_HOME
$oldAgentRoot=$env:AGENT_HOME
try {
    $env:READANY_HOME=Join-Path $fixture 'library'
    $env:AGENT_HOME=Join-Path $fixture 'agent'
    $output=& $node $cli books list --json
    if ($LASTEXITCODE -ne 0) { throw 'Packaged CLI cannot read its SQLite database.' }
    $result=$output | ConvertFrom-Json
    if (!$result.ok) { throw 'Packaged CLI failed to initialize a clean library.' }
    Write-Output 'Portable package verified: OpenRead executable, bundled Node and SQLite CLI.'
} finally {
    $env:READANY_HOME=$oldDataRoot
    $env:AGENT_HOME=$oldAgentRoot
    if (Test-Path -LiteralPath $fixture) {
        $resolved=(Resolve-Path -LiteralPath $fixture).Path
        $tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if (!$resolved.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -or !(Split-Path $resolved -Leaf).StartsWith('openread-package-test-')) { throw 'Unsafe test cleanup path.' }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
