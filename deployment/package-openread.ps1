param([string]$Version='1.4.0')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$destination=Join-Path $projectRoot ".cache\release\OpenRead-$Version-windows-x64"
if (Test-Path -LiteralPath $destination) { throw 'Package output already exists. Choose a fresh output/version.' }
New-Item -ItemType Directory -Force (Join-Path $destination 'runtime'),(Join-Path $destination 'plus-bridge\node_modules') | Out-Null
$binary=Join-Path $projectRoot 'packages\app\src-tauri\target\release\app.exe'
if (!(Test-Path -LiteralPath $binary)) { throw 'Build OpenRead with Tauri first.' }
Copy-Item -LiteralPath $binary -Destination (Join-Path $destination 'runtime\app.exe')
Copy-Item -LiteralPath (Join-Path $projectRoot 'packages\cli\dist') -Destination (Join-Path $destination 'runtime\readany-cli') -Recurse
New-Item -ItemType Directory (Join-Path $destination 'runtime\readany-cli\node_modules') | Out-Null
foreach ($dependency in @('better-sqlite3','bindings','file-uri-to-path')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "node_modules\$dependency") -Destination (Join-Path $destination "runtime\readany-cli\node_modules\$dependency") -Recurse
}
. (Join-Path $projectRoot 'plus-bridge\environment.ps1')
$nodePath=Get-ReadAnyNode -ProjectRoot $projectRoot
Copy-Item -LiteralPath $nodePath -Destination (Join-Path $destination 'runtime\node.exe')
$licenseOutput=Join-Path $destination 'runtime\NODE-LICENSE.txt'
$nodeVersion=(& $nodePath --version).Trim()
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE" -OutFile $licenseOutput
# Explicit allowlist. No .cache, credentials, personal settings, books, or OCR cache.
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'plus-bridge') -File | Where-Object { $_.Extension -in '.mjs','.ps1','.json' -and $_.Name -notlike '*.test.mjs' } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $destination 'plus-bridge')
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'plus-bridge\node_modules\jose') -Destination (Join-Path $destination 'plus-bridge\node_modules\jose') -Recurse
foreach ($file in @('Start-OpenRead.cmd','Setup-OpenRead.cmd','README.md','LICENSE','NOTICE.md')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $destination $file)
}
New-Item -ItemType Directory (Join-Path $destination 'docs') | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\pdf-ocr.md') -Destination (Join-Path $destination 'docs')
$zip="$destination.zip"
& (Join-Path $PSScriptRoot 'verify-portable.ps1') -PackageDirectory $destination -ExpectedVersion $Version
Compress-Archive -LiteralPath $destination -DestinationPath $zip
Get-FileHash -LiteralPath $zip -Algorithm SHA256 | ForEach-Object { "$($_.Hash.ToLower())  $(Split-Path $zip -Leaf)" } | Set-Content -LiteralPath "$zip.sha256" -Encoding ASCII
Write-Output $zip
