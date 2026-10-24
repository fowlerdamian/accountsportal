<#
.SYNOPSIS
  Task Scheduler wrapper for the R&D Drawings queue worker. Decrypts the
  service-role key (DPAPI, user-scoped; same key file as the SLDPRT
  thumbnails task) and runs tools\step2drawing\worker.py in the
  step-drawings venv. The worker loops forever; the task's IgnoreNew policy
  plus a 5-minute repetition restarts it if it ever exits.
#>
$ErrorActionPreference = 'Stop'

$keyFile = Join-Path $PSScriptRoot '.sldprt-key.bin'
$python  = Join-Path $env:USERPROFILE 'Projects\step-drawings\.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $keyFile)) { Write-Error "Key file not found at $keyFile"; exit 1 }
if (-not (Test-Path -LiteralPath $python))  { Write-Error "Python venv not found at $python"; exit 1 }

$secure = Get-Content -LiteralPath $keyFile -Raw | ConvertTo-SecureString
# Pass the key via environment, not argv (argv is visible to other processes).
$env:STEP_WORKER_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new('', $secure).Password
$env:PYTHONIOENCODING = 'utf-8'

& $python -u (Join-Path $PSScriptRoot 'step2drawing\worker.py')
$env:STEP_WORKER_SERVICE_ROLE_KEY = $null
