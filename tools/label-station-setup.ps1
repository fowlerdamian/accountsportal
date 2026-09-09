# AGA Label Station — one-shot setup. RUN THIS ON THE DYMO PC (the one the
# LabelWriter is plugged into), in PowerShell, while signed in as the user who
# will run the station. Right-click PowerShell > Run, then paste this whole file.
#
# It: sets the DYMO LabelWriter 550 as the default printer and stops Windows
# re-managing it, writes the launcher to C:\AGA, adds a Startup shortcut so it
# comes back after a reboot, and opens the station. You then just sign in once.

$ErrorActionPreference = 'Stop'
$stationUrl = 'https://app.automotivegroup.com.au/labels/station'
$printerMatch = 'DYMO.*LabelWriter|LabelWriter 550'

Write-Host '1/5  Finding the DYMO printer...' -ForegroundColor Cyan
$printer = Get-Printer | Where-Object Name -match $printerMatch | Select-Object -First 1
if (-not $printer) {
  Write-Warning "No DYMO LabelWriter found on this PC. Install/connect it first, then re-run. Printers seen:"
  Get-Printer | Select-Object Name | Format-Table -AutoSize
  return
}
Write-Host "     Using: $($printer.Name)" -ForegroundColor Green

Write-Host '2/5  Making it the default printer (and stopping Windows changing it)...' -ForegroundColor Cyan
# Turn off "Let Windows manage my default printer"
New-ItemProperty -Path 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows' `
  -Name 'LegacyDefaultPrinterMode' -Value 1 -PropertyType DWord -Force | Out-Null
(Get-CimInstance Win32_Printer -Filter "Name='$($printer.Name -replace "'","''")'").InvokeMethod('SetDefaultPrinter', $null) | Out-Null
Write-Host "     Default printer set." -ForegroundColor Green

Write-Host '3/5  Locating Chrome...' -ForegroundColor Cyan
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Write-Warning 'Chrome not found. Install Google Chrome, then re-run.'; return }
Write-Host "     $chrome" -ForegroundColor Green

Write-Host '4/5  Writing launcher to C:\AGA\label-station.cmd...' -ForegroundColor Cyan
New-Item -ItemType Directory -Path 'C:\AGA' -Force | Out-Null
$cmd = @"
@echo off
rem AGA Label Station — kiosk Chrome for the DYMO LabelWriter. Auto-generated.
set PROFILE=%LOCALAPPDATA%\AGA\label-station
start "" "$chrome" --kiosk-printing --no-first-run --no-default-browser-check ^
  --user-data-dir="%PROFILE%" ^
  --app=$stationUrl
"@
Set-Content -Path 'C:\AGA\label-station.cmd' -Value $cmd -Encoding ASCII
Write-Host '     Written.' -ForegroundColor Green

Write-Host '5/5  Adding a Startup shortcut (comes back after reboot)...' -ForegroundColor Cyan
$startup = [Environment]::GetFolderPath('Startup')
$sc = (New-Object -ComObject WScript.Shell).CreateShortcut("$startup\AGA Label Station.lnk")
$sc.TargetPath = 'C:\AGA\label-station.cmd'
$sc.WindowStyle = 7   # minimized
$sc.Description = 'AGA DYMO label print station'
$sc.Save()
Write-Host '     Shortcut added.' -ForegroundColor Green

Write-Host ''
Write-Host 'Done. Launching the station now — sign in to the portal once when it opens.' -ForegroundColor Yellow
Start-Process 'C:\AGA\label-station.cmd'
