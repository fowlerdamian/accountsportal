<#
.SYNOPSIS
  Wrapper invoked by Windows Task Scheduler. Decrypts the service-role
  key (DPAPI, user-scoped) and runs sldprt-thumbs.ps1 under Windows
  PowerShell 5.1 (System.Drawing requirement).
#>
$ErrorActionPreference = 'Stop'

$keyFile = Join-Path $PSScriptRoot '.sldprt-key.bin'
if (-not (Test-Path -LiteralPath $keyFile)) {
    Write-Error "Key file not found at $keyFile"
    exit 1
}

$secure = Get-Content -LiteralPath $keyFile -Raw | ConvertTo-SecureString
$key    = [System.Net.NetworkCredential]::new('', $secure).Password

& "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -ExecutionPolicy Bypass `
    -NoProfile `
    -File         (Join-Path $PSScriptRoot 'sldprt-thumbs.ps1') `
    -FolderPath     'H:\Shared drives\MAIN\_OPERATIONS\PROJECTS' `
    -SupabaseUrl    'https://nvlezbqolzwixquusbfo.supabase.co' `
    -ServiceRoleKey $key
