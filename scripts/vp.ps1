param([Parameter(ValueFromRemainingArguments = $true)][string[]]$VpArguments)
$ErrorActionPreference = 'Stop'
$scsRoot = Split-Path -Parent $PSScriptRoot
$env:WRANGLER_LOG_PATH = Join-Path $scsRoot '.local/wrangler-logs'
$env:WRANGLER_SEND_METRICS = 'false'
$scsPortable = Join-Path $scsRoot '.local/tools/vp-native/package/vp.exe'
if (Test-Path -LiteralPath $scsPortable) {
  $env:VP_HOME = Join-Path $scsRoot '.local/tools/vite-plus'
  $env:PATH = (Split-Path -Parent $scsPortable) + [IO.Path]::PathSeparator + $env:PATH
  & $scsPortable @VpArguments
} else {
  & vp @VpArguments
}
exit $LASTEXITCODE
