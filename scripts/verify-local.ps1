param([int]$Port = 5181, [string]$Channel = '', [ValidateSet('all','browser')][string]$Scope = 'all')
$ErrorActionPreference = 'Stop'
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Invalid local port' }
$scsVp = Join-Path $PSScriptRoot 'vp.ps1'
function Invoke-ScsVp {
  param([string[]]$Arguments)
  & $scsVp @Arguments
  if ($LASTEXITCODE -ne 0) { throw ('Verification failed: vp ' + ($Arguments -join ' ')) }
}
if ($Scope -eq 'all') {
Invoke-ScsVp -Arguments @('install', '--frozen-lockfile')
Invoke-ScsVp -Arguments @('check')
Invoke-ScsVp -Arguments @('build')
Invoke-ScsVp -Arguments @('test', '--run')
Invoke-ScsVp -Arguments @('exec', 'vitest', 'run', '-c', 'vitest.workers.config.ts')
Invoke-ScsVp -Arguments @('exec', 'wrangler', 'd1', 'migrations', 'apply', 'scs-assessment-db', '--local')
}
$env:E2E_PORT = [string]$Port
$env:E2E_CHANNEL = $Channel
Invoke-ScsVp -Arguments @('exec', 'playwright', 'test', 'tests/e2e/smoke.spec.ts')
Invoke-ScsVp -Arguments @('exec', 'node', 'scripts/check-port-conflict.mjs')
