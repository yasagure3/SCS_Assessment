$ErrorActionPreference = 'Stop'
$vendor = Join-Path $PSScriptRoot 'vendor'
New-Item -ItemType Directory -Path $vendor -Force | Out-Null
$bundle = Join-Path $vendor 'exceljs.min.js'
Invoke-WebRequest -Uri 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js' -OutFile $bundle
$expected = '7E49DA68588E250DBB8BBA190D2CAA8AB3787CC0284BDA1D8B2F805C4DF742C9'
if ((Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash -ne $expected) {
  throw 'ExcelJS bundle checksum mismatch'
}
Invoke-WebRequest -Uri 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/LICENSE' -OutFile (Join-Path $vendor 'ExcelJS-LICENSE.txt')
Write-Output 'ExcelJS 4.4.0 browser bundle verified.'
