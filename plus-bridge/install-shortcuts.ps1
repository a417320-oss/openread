param(
    [string]$DesktopDirectory=[Environment]::GetFolderPath('Desktop'),
    [string]$ProgramsDirectory=(Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'),
    [string]$StateDirectory,
    [string]$ExecutablePath
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$projectRoot=Split-Path $PSScriptRoot -Parent
if (!$StateDirectory) { $StateDirectory=Join-Path $projectRoot '.cache\plus' }
. (Join-Path $PSScriptRoot 'environment.ps1')
$nodePath=Get-ReadAnyNode -ProjectRoot $projectRoot
$nodeMajor=[int]((& $nodePath --version) -replace '^v(\d+).*','$1')
if ($nodeMajor -lt 24) { throw 'The Plus connection requires Node.js 24 or later.' }
$powerShellPath=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$launcherPath=Join-Path $PSScriptRoot 'launch.ps1'
$executable=$ExecutablePath
if (!$executable) { $executable=Join-Path $projectRoot 'runtime\app.exe' }
if (!(Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'OpenRead is not installed.' }
New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
@{nodePath=$nodePath} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $StateDirectory 'runtime.json') -Encoding UTF8
$backupDirectory=Join-Path $StateDirectory 'shortcut-backups'
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
$shortcutShell=New-Object -ComObject WScript.Shell
foreach ($location in @(@{name='desktop';directory=$DesktopDirectory},@{name='start-menu';directory=$ProgramsDirectory})) {
    New-Item -ItemType Directory -Path $location.directory -Force | Out-Null
    $shortcutPath=Join-Path $location.directory 'OpenRead.lnk'
    $backupPath=Join-Path $backupDirectory ($location.name + '-OpenRead.lnk')
    if ((Test-Path -LiteralPath $shortcutPath) -and !(Test-Path -LiteralPath $backupPath)) {
        Copy-Item -LiteralPath $shortcutPath -Destination $backupPath
    }
    $shortcut=$shortcutShell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath=$powerShellPath
    $shortcut.Arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcherPath + '"'
    $shortcut.WorkingDirectory=$projectRoot
    $shortcut.IconLocation=$executable + ',0'
    $shortcut.Description='OpenRead with automatic ChatGPT subscription connection'
    $shortcut.WindowStyle=7
    $shortcut.Save()
    # Migrate only this installation's old shortcut; leave other ReadAny installs alone.
    $legacyPath=Join-Path $location.directory 'ReadAny.lnk'
    if (Test-Path -LiteralPath $legacyPath) {
        $legacy=$shortcutShell.CreateShortcut($legacyPath)
        $owned=($legacy.TargetPath -eq $executable) -or (($legacy.TargetPath -eq $powerShellPath) -and $legacy.Arguments.Contains($launcherPath))
        if ($owned) {
            $legacyBackup=Join-Path $backupDirectory ($location.name + '-ReadAny.lnk')
            if (!(Test-Path -LiteralPath $legacyBackup)) { Copy-Item -LiteralPath $legacyPath -Destination $legacyBackup }
            Remove-Item -LiteralPath $legacyPath
        }
    }
    Write-Output "Updated OpenRead shortcut: $shortcutPath"
}
