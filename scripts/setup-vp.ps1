# Windows x64, PowerShell 7. Vite+ is installed only under this checkout.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$scsRoot = Split-Path -Parent $PSScriptRoot
$scsVpRoot = Join-Path $scsRoot '.local/tools/vp-native'
New-Item -ItemType Directory -Force -Path $scsVpRoot | Out-Null
$scsVpMetadata = Invoke-RestMethod -Uri 'https://registry.npmjs.org/@voidzero-dev%2fvite-plus-cli-win32-x64-msvc/0.2.4'
$scsVpArchive = Join-Path $scsVpRoot 'vp-cli.tgz'
Invoke-WebRequest -Uri $scsVpMetadata.dist.tarball -OutFile $scsVpArchive
$scsVpBytes = [System.IO.File]::ReadAllBytes($scsVpArchive)
$scsVpIntegrity = 'sha512-' + [Convert]::ToBase64String([System.Security.Cryptography.SHA512]::HashData($scsVpBytes))
if ($scsVpIntegrity -ne $scsVpMetadata.dist.integrity) { throw 'Vite+ package integrity mismatch' }
$scsVpEntries = & tar -tzf $scsVpArchive
if ($LASTEXITCODE -ne 0 -or ($scsVpEntries | Where-Object { $_ -match '(^/|(^|/)\.\.(/|$)|^[A-Za-z]:)' })) { throw 'Unexpected archive entry' }
& tar -xzf $scsVpArchive -C $scsVpRoot 'package/vp.exe'
if ($LASTEXITCODE -ne 0) { throw 'Vite+ extraction failed' }
$env:VP_HOME = Join-Path $scsRoot '.local/tools/vite-plus'
& (Join-Path $scsVpRoot 'package/vp.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'Vite+ setup failed' }
