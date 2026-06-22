<#
.SYNOPSIS
  Wrapper invoked by Windows Task Scheduler. Decrypts the Supabase service-role
  key (DPAPI, user-scoped) and runs due-date-reminder.mjs, which nudges staff
  to set due dates on their open tasks (and auto-closes the nudge once done).
#>
$ErrorActionPreference = 'Stop'

# Reuse the same encrypted key as the reship / sldprt tools.
$keyFile = Join-Path $PSScriptRoot '.due-date-reminder-key.bin'
if (-not (Test-Path -LiteralPath $keyFile)) {
    $keyFile = Join-Path $PSScriptRoot '.reship-followup-key.bin'
}
if (-not (Test-Path -LiteralPath $keyFile)) {
    $keyFile = Join-Path $PSScriptRoot '.sldprt-key.bin'
}
if (-not (Test-Path -LiteralPath $keyFile)) {
    Write-Error "No key file found (.due-date-reminder-key.bin, .reship-followup-key.bin or .sldprt-key.bin) in $PSScriptRoot"
    exit 1
}

$secure = Get-Content -LiteralPath $keyFile -Raw | ConvertTo-SecureString
$key    = [System.Net.NetworkCredential]::new('', $secure).Password

$repoRoot = Split-Path -Parent $PSScriptRoot

$env:SUPABASE_URL              = 'https://nvlezbqolzwixquusbfo.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = $key

Push-Location $repoRoot
try {
    & node (Join-Path $PSScriptRoot 'due-date-reminder.mjs') @args
    exit $LASTEXITCODE
}
finally {
    Pop-Location
    Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
}
