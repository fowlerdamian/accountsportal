# ─────────────────────────────────────────────────────────────────────────────
# Staff-portal Tasks desktop widget.
#
# Opens the chrome-free /tasks/widget route in a borderless Microsoft Edge
# "app window", then pins it always-on-top so it floats over other windows like
# a desktop gadget. A dedicated --user-data-dir keeps it as its own Edge
# instance (so we own the window handle) AND persists the Supabase login — you
# sign in once and stay signed in.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File launch-tasks-widget.ps1
#   ...optional overrides:
#     -Url   https://app.automotivegroup.com.au/tasks/widget
#     -Width 380  -Height 680  -X 0  -Y 80   (X/Y default = top-right corner)
#     -NoTopMost                              (don't pin always-on-top)
# ─────────────────────────────────────────────────────────────────────────────
[CmdletBinding()]
param(
  [string]$Url    = "https://app.automotivegroup.com.au/tasks/widget",
  [int]$Width     = 380,
  [int]$Height    = 680,
  [Nullable[int]]$X = $null,
  [Nullable[int]]$Y = 80,
  [switch]$NoTopMost
)

$ErrorActionPreference = "Stop"

# ── Locate Edge ──────────────────────────────────────────────────────────────
$edge = @(
  "$Env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${Env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw "Microsoft Edge (msedge.exe) not found." }

# ── Default position: top-right corner of the primary screen ─────────────────
Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
if ($null -eq $X) { $X = $screen.Right - $Width - 8 }
if ($null -eq $Y) { $Y = 80 }

# Dedicated profile dir → separate Edge instance + persistent login session.
$profileDir = Join-Path $Env:LOCALAPPDATA "TasksWidget\EdgeProfile"
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

$args = @(
  "--app=$Url",
  "--user-data-dir=$profileDir",
  "--window-size=$Width,$Height",
  "--window-position=$X,$Y",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-features=msEdgeWelcomePage"
)

$proc = Start-Process -FilePath $edge -ArgumentList $args -PassThru

if ($NoTopMost) { return }

# ── Pin always-on-top (Win32 SetWindowPos → HWND_TOPMOST) ────────────────────
if (-not ("WidgetWin" -as [type])) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WidgetWin {
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
    int X, int Y, int cx, int cy, uint uFlags);
}
"@
}
$HWND_TOPMOST   = [IntPtr](-1)
$SWP_NOMOVE     = 0x0002
$SWP_NOSIZE     = 0x0001
$SWP_SHOWWINDOW = 0x0040

# Edge needs a moment to create its top-level window. Poll MainWindowHandle.
$handle = [IntPtr]::Zero
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 250
  $proc.Refresh()
  if ($proc.MainWindowHandle -ne [IntPtr]::Zero) { $handle = $proc.MainWindowHandle; break }
}
if ($handle -ne [IntPtr]::Zero) {
  [void][WidgetWin]::SetWindowPos($handle, $HWND_TOPMOST, 0, 0, 0, 0,
    ($SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_SHOWWINDOW))
  Write-Host "Tasks widget pinned (HWND $handle)."
} else {
  Write-Warning "Widget launched but window handle not found — not pinned. Edge may have reused an existing instance."
}
