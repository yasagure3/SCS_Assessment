param([string]$Npm = 'npm', [switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
  if (-not $SkipInstall) {
    & $Npm ci --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  }
  New-Item -ItemType Directory -Force -Path 'fonts','licenses' | Out-Null
  $assets = @(
    @{
      Path = 'fonts/NotoSansCJKjp-Regular.otf'
      Url = 'https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf'
      Hash = '68A3FC98800B2A27B371F2FB79991DAF3633BD89309D4FFAA6946FD587F375B5'
    },
    @{
      Path = 'fonts/OFL.txt'
      Url = 'https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/LICENSE'
      Hash = '6A73F9541C2DE74158C0E7CF6B0A58EF774F5A780BF191F2D7EC9CC53EFE2BF2'
    }
  )
  foreach ($asset in $assets) {
    if (-not (Test-Path -LiteralPath $asset.Path)) {
      Invoke-WebRequest -Uri $asset.Url -OutFile $asset.Path
    }
    if ((Get-FileHash -LiteralPath $asset.Path -Algorithm SHA256).Hash -ne $asset.Hash) {
      throw "Checksum mismatch: $($asset.Path)"
    }
  }
  Copy-Item -LiteralPath 'node_modules/pdf-lib/LICENSE.md' -Destination 'licenses/pdf-lib-MIT.txt'
  Copy-Item -LiteralPath 'node_modules/@pdf-lib/fontkit/README.md' -Destination 'licenses/fontkit-README.md'
  Write-Output 'Pinned dependencies and font verified. Next: node build.mjs, node test.mjs, python verify.py.'
}
finally { Pop-Location }
