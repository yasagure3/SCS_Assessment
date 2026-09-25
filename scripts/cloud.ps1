param(
  [Parameter(Mandatory = $true)][string]$Config,
  [ValidateSet('Prepare', 'Build', 'DryRun', 'Deploy')][string]$Action = 'DryRun',
  [switch]$Restore
)
$ErrorActionPreference = 'Stop'
$scsRoot = Split-Path -Parent $PSScriptRoot
$scsConfig = (Resolve-Path -LiteralPath $Config).Path
$scsVp = Join-Path $PSScriptRoot 'vp.ps1'
$scsPrevious = @{}
$scsEnvironment = @('SCS_CLOUD_INPUT', 'SCS_CLOUD_RESTORE', 'SCS_PREVIEW_INPUT', 'CLOUDFLARE_ENV', 'CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV', 'CLOUDFLARE_INCLUDE_PROCESS_ENV', 'VITEST')
foreach ($scsKey in $scsEnvironment) { $scsPrevious[$scsKey] = [Environment]::GetEnvironmentVariable($scsKey, 'Process') }
Push-Location $scsRoot
try {
  $env:SCS_CLOUD_INPUT = $scsConfig
  $env:SCS_PREVIEW_INPUT = $null
  $env:SCS_CLOUD_RESTORE = if ($Restore) { 'true' } else { 'false' }
  [string[]]$scsTarget = @()
  if ($Restore) { $scsTarget += 'restore' }
  $env:CLOUDFLARE_ENV = $null
  $env:VITEST = $null
  $env:CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false'
  $env:CLOUDFLARE_INCLUDE_PROCESS_ENV = 'false'
  & $scsVp exec node scripts/cloud-config.mjs prepare $scsConfig @scsTarget
  if ($LASTEXITCODE -ne 0) { throw 'Cloud preparation failed; no deployment was attempted.' }
  if ($Action -eq 'Prepare') { return }
  & $scsVp build
  if ($LASTEXITCODE -ne 0) { throw 'Cloud build failed; no deployment was attempted.' }
  $scsVerify = if ($Action -eq 'Deploy') { 'verify-deploy' } else { 'verify' }
  $scsBuiltConfig = & $scsVp exec node scripts/cloud-config.mjs $scsVerify $scsConfig @scsTarget
  if ($LASTEXITCODE -ne 0) { throw 'Cloud output verification failed; no deployment was attempted.' }
  $scsBuiltConfig = ($scsBuiltConfig | Select-Object -Last 1).Trim()
  & $scsVp exec node scripts/check-production-build.mjs (Split-Path -Parent $scsBuiltConfig)
  if ($LASTEXITCODE -ne 0) { throw 'Production separation check failed; no deployment was attempted.' }
  if ($Action -eq 'Build') { return }
  $scsDeployArguments = @('exec', 'wrangler', 'deploy', '--config', $scsBuiltConfig)
  if ($Action -eq 'DryRun') { $scsDeployArguments += '--dry-run' }
  & $scsVp @scsDeployArguments
  if ($LASTEXITCODE -ne 0) { throw 'Wrangler did not complete successfully.' }
} finally {
  foreach ($scsKey in $scsEnvironment) { [Environment]::SetEnvironmentVariable($scsKey, $scsPrevious[$scsKey], 'Process') }
  Pop-Location
}

