<#
.SYNOPSIS
  Renders thumbnails for the Contractor Hub's SolidWorks files (.SLDPRT /
  .SLDASM) from the Google Drive for desktop mount and publishes them to
  Supabase Storage, keeping public.files.thumbnail_url current.

.DESCRIPTION
  What it does, each run:

    1. Walks every -FolderPath (the Drive for desktop mirror of the PROJECTS
       and DRAWINGS folders - finished projects move from one to the other)
       and reads every SolidWorks file's Drive ID from the NTFS stream
       Drive for desktop attaches to it (`<file>:user.drive.id`). That gives an
       exact match to public.files.drive_file_id - no more matching on bare
       filenames, which collide across projects ("spacer.SLDPRT").
    2. Loads every SolidWorks row from public.files.
    3. Renders a thumbnail for each row whose thumbnail_source_mtime is
       missing or older than the local file's last-write time (new row, or
       the part was re-saved), or all rows with -Force. Rows whose file is
       not on the mount are skipped and reported; a file that vanishes
       mid-run (moved in Drive) is skipped and re-resolved next run.
    4. Rendering uses the Windows Shell thumbnail handler that SolidWorks /
       eDrawings registers (IShellItemImageFactory) - the same picture
       Explorer's preview pane shows - inside a worker runspace with a
       per-file timeout so one bad file cannot stall the job.
    5. Uploads file-thumbnails/{files.id}.jpg (upsert) and PATCHes the row's
       thumbnail_url (with a ?v= cache-buster so re-renders show up),
       thumbnail_source_mtime and modified_at (= the file's mtime).
    6. If the shell handler cannot render a file (parts saved without a
       preview image), it asks the google-drive edge function's
       get_thumbnail action for Drive's own preview instead. Either way the
       row's thumbnail_source_mtime is stamped, so a file that cannot be
       rendered is not retried every run - only when it changes.

  It never touches public.projects: the hub picks the newest SolidWorks
  thumbnail per project itself, and projects.thumbnail_url is the manual
  upload from the project page (the previous job overwrote those).

  A named mutex prevents overlapping runs; everything is logged to
  -LogDir\sldprt-thumbs.log (rotated) as well as the console.

.PARAMETER FolderPath      One or more Drive for desktop folders holding the SolidWorks files
                           (array, or one string with folders separated by ';' for Task Scheduler).
.PARAMETER Limit           Render at most this many files this run (0 = no limit); for testing.
.PARAMETER SupabaseUrl     e.g. https://nvlezbqolzwixquusbfo.supabase.co
.PARAMETER ServiceRoleKey  Supabase service-role JWT (default: $env:SLDPRT_SERVICE_ROLE_KEY).
.PARAMETER Bucket          Storage bucket (default contractor-hub-files).
.PARAMETER ThumbSize       Thumbnail edge in pixels (default 512).
.PARAMETER PerFileTimeoutSec  Give up on a file after this long (default 90).
.PARAMETER LogDir          Log folder (default <script dir>\logs).
.PARAMETER Force           Re-render every file found locally.
.PARAMETER DryRun          Report what would be rendered; change nothing.

.EXAMPLE
  .\sldprt-thumbs.ps1 -FolderPath 'H:\Shared drives\MAIN\_OPERATIONS\PROJECTS' `
                      -SupabaseUrl 'https://nvlezbqolzwixquusbfo.supabase.co' -DryRun
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string[]] $FolderPath,
    [Parameter(Mandatory)] [string] $SupabaseUrl,
    [string] $ServiceRoleKey = $env:SLDPRT_SERVICE_ROLE_KEY,
    [string] $Bucket = 'contractor-hub-files',
    [int]    $ThumbSize = 512,
    [int]    $PerFileTimeoutSec = 90,
    [string] $LogDir = '',
    [int]    $Limit = 0,
    [switch] $Force,
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
$SupabaseUrl = $SupabaseUrl.TrimEnd('/')
$Extensions  = @('.sldprt', '.sldasm')
# `powershell -File` passes arguments as plain strings, so accept "A;B" as well as an array.
$FolderPath  = @($FolderPath | ForEach-Object { $_ -split ';' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
# $PSScriptRoot is not set while parameter defaults are evaluated under -File; resolve the log dir here.
if (-not $LogDir) { $LogDir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'logs' }

# ─── Logging ────────────────────────────────────────────────────────────────

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$script:LogFile = Join-Path $LogDir 'sldprt-thumbs.log'

function Rotate-Log {
    # Keep the log small: roll at 2 MB, keep 5 generations.
    if ((Test-Path -LiteralPath $script:LogFile) -and (Get-Item -LiteralPath $script:LogFile).Length -gt 2MB) {
        for ($i = 4; $i -ge 1; $i--) {
            $from = "$script:LogFile.$i"; $to = "$script:LogFile.$($i + 1)"
            if (Test-Path -LiteralPath $from) { Move-Item -LiteralPath $from -Destination $to -Force }
        }
        Move-Item -LiteralPath $script:LogFile -Destination "$script:LogFile.1" -Force
    }
}

function Log {
    param([string] $Message, [ValidateSet('INFO', 'OK', 'SKIP', 'WARN', 'FAIL')] [string] $Level = 'INFO')
    $line = '{0:yyyy-MM-dd HH:mm:ss} [{1,-4}] {2}' -f (Get-Date), $Level, $Message
    $colour = switch ($Level) { 'OK' { 'Green' } 'SKIP' { 'DarkGray' } 'WARN' { 'Yellow' } 'FAIL' { 'Red' } default { 'Cyan' } }
    Write-Host $line -ForegroundColor $colour
    Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8
}

Rotate-Log

# ─── Preconditions ──────────────────────────────────────────────────────────

if (-not $ServiceRoleKey) { throw 'ServiceRoleKey missing: pass -ServiceRoleKey or set SLDPRT_SERVICE_ROLE_KEY' }
foreach ($fp in $FolderPath) {
    if (-not (Test-Path -LiteralPath $fp)) { throw "FolderPath not found (is Google Drive for desktop running?): $fp" }
}

# One run at a time - the task fires every 30 min and a slow mount must not stack runs.
$mutex = New-Object System.Threading.Mutex($false, 'Global\AGA-SLDPRT-Thumbnails')
if (-not $mutex.WaitOne(0)) { Log 'Another run is still in progress - exiting.' 'WARN'; exit 0 }

$runStart = Get-Date
Log ("Run start  folders={0}  size={1}px  force={2}  dryRun={3}  limit={4}" -f ($FolderPath -join '; '), $ThumbSize, [bool]$Force, [bool]$DryRun, $Limit)

# ─── Shell thumbnail interop ────────────────────────────────────────────────
# IShellItemImageFactory::GetImage delegates to the preview handler registered
# for the extension (SolidWorks' sldwinshellextu.dll), so this needs SolidWorks
# or eDrawings installed on the machine running the job.

if (-not ([System.Management.Automation.PSTypeName]'AGA.ShellThumb').Type) {
    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace AGA {
    [StructLayout(LayoutKind.Sequential)] public struct SIZE { public int cx; public int cy; }

    [Flags] public enum SIIGBF { ResizeToFit = 0x00, BiggerSizeOk = 0x01, MemoryOnly = 0x02, IconOnly = 0x04, ThumbnailOnly = 0x08, InCacheOnly = 0x10 }

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IShellItem { }

    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IShellItemImageFactory {
        [PreserveSig] int GetImage([In] SIZE size, [In] SIIGBF flags, [Out] out IntPtr phbm);
    }

    public static class ShellThumb {
        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
        static extern void SHCreateItemFromParsingName([MarshalAs(UnmanagedType.LPWStr)] string path, IntPtr pbc, [In] ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);

        [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr hObject);

        /// Render the shell thumbnail of `path` to a JPEG at `outPath`. Throws on any failure.
        public static void RenderJpeg(string path, int size, string outPath, long quality) {
            Guid g = typeof(IShellItemImageFactory).GUID;
            IShellItem item;
            SHCreateItemFromParsingName(path, IntPtr.Zero, ref g, out item);
            var factory = (IShellItemImageFactory)item;
            IntPtr hbmp;
            // ThumbnailOnly: never accept the generic file icon as a "thumbnail".
            int hr = factory.GetImage(new SIZE { cx = size, cy = size }, SIIGBF.BiggerSizeOk | SIIGBF.ThumbnailOnly, out hbmp);
            if (hr != 0) throw new System.ComponentModel.Win32Exception(hr, "GetImage failed (0x" + hr.ToString("X8") + ")");
            try {
                using (var src = Bitmap.FromHbitmap(hbmp))
                using (var rgb = new Bitmap(src.Width, src.Height, PixelFormat.Format24bppRgb))
                using (var gfx = Graphics.FromImage(rgb)) {
                    gfx.Clear(Color.White);           // HBITMAPs may carry alpha; flatten on white for JPEG
                    gfx.DrawImageUnscaled(src, 0, 0);
                    ImageCodecInfo codec = null;
                    foreach (var c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") codec = c;
                    using (var p = new EncoderParameters(1)) {
                        p.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
                        rgb.Save(outPath, codec, p);
                    }
                }
            } finally {
                DeleteObject(hbmp);
            }
        }
    }
}
"@
}

# Render in a dedicated STA runspace so a hung preview handler only costs us
# the timeout, not the whole run. AGA.ShellThumb is app-domain wide, so the
# worker sees it without re-adding.
function Invoke-Render {
    param([string] $Path, [string] $OutPath, [int] $Size, [int] $TimeoutSec)
    $rs = [RunspaceFactory]::CreateRunspace()
    $rs.ApartmentState = 'STA'
    $rs.ThreadOptions  = 'ReuseThread'
    $rs.Open()
    $ps = [PowerShell]::Create()
    $ps.Runspace = $rs
    [void]$ps.AddScript({
        param($p, $s, $o)
        Add-Type -AssemblyName System.Drawing
        [AGA.ShellThumb]::RenderJpeg($p, $s, $o, [long]85)
    }).AddArgument($Path).AddArgument($Size).AddArgument($OutPath)
    $handle = $ps.BeginInvoke()
    try {
        if (-not $handle.AsyncWaitHandle.WaitOne($TimeoutSec * 1000)) {
            $ps.Stop()
            throw "timed out after ${TimeoutSec}s"
        }
        $ps.EndInvoke($handle) | Out-Null
        if ($ps.Streams.Error.Count) { throw $ps.Streams.Error[0].Exception }
    } finally {
        $ps.Dispose(); $rs.Dispose()
    }
    if (-not (Test-Path -LiteralPath $OutPath) -or (Get-Item -LiteralPath $OutPath).Length -lt 1KB) {
        throw 'render produced no image'
    }
}

# ─── Supabase helpers ───────────────────────────────────────────────────────

$script:AuthHeaders = @{ apikey = $ServiceRoleKey; Authorization = "Bearer $ServiceRoleKey" }

# Transient 5xx / network errors retry with backoff; 4xx fail fast.
function Invoke-WithRetry {
    param([Parameter(Mandatory)] [scriptblock] $Action, [string] $What = 'request', [int] $MaxAttempts = 3)
    $delay = 1
    for ($i = 1; $i -le $MaxAttempts; $i++) {
        try { return & $Action }
        catch {
            $resp   = $_.Exception.Response
            $status = if ($resp) { [int]$resp.StatusCode } else { 0 }
            if ($i -eq $MaxAttempts -or -not (($status -eq 0) -or ($status -ge 500))) { throw }
            Log ("retry {0}/{1} {2} (status={3}) in {4}s" -f $i, ($MaxAttempts - 1), $What, $status, $delay) 'WARN'
            Start-Sleep -Seconds $delay
            $delay *= 2
        }
    }
}

function Get-SolidWorksRows {
    # Every SolidWorks row, paged in case the table grows past PostgREST's page size.
    $rows = @(); $page = 1000; $from = 0
    while ($true) {
        # limit/offset rather than a Range header: Windows PowerShell's web client refuses to set Range directly.
        $url = "$SupabaseUrl/rest/v1/files?select=id,filename,project_id,drive_file_id,thumbnail_url,thumbnail_source_mtime,modified_at" +
               "&or=(filename.ilike.*.sldprt,filename.ilike.*.sldasm)&order=id&limit=$page&offset=$from"
        $headers = $script:AuthHeaders
        $chunk = Invoke-WithRetry -What 'list files' -Action { Invoke-RestMethod -Uri $url -Headers $headers -Method GET }
        $rows += @($chunk)
        if (@($chunk).Count -lt $page) { break }
        $from += $page
    }
    return $rows
}

function Publish-Thumbnail {
    param([string] $FileId, [string] $LocalJpeg, [datetime] $SourceMtimeUtc)
    $storagePath = "file-thumbnails/$FileId.jpg"
    $headers = $script:AuthHeaders.Clone()
    $headers['x-upsert']      = 'true'
    $headers['Cache-Control'] = '3600'
    Invoke-WithRetry -What 'storage upload' -Action {
        Invoke-RestMethod -Uri "$SupabaseUrl/storage/v1/object/$Bucket/$storagePath" -Headers $headers -Method POST `
                          -InFile $LocalJpeg -ContentType 'image/jpeg' | Out-Null
    }
    # Same object path every time, so bust caches with the render time.
    $publicUrl = "$SupabaseUrl/storage/v1/object/public/$Bucket/${storagePath}?v=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
    $patch = $script:AuthHeaders.Clone()
    $patch['Content-Type'] = 'application/json'
    $patch['Prefer']       = 'return=minimal'
    # modified_at is set explicitly to the file's own mtime: the files trigger bumps it to now() on any
    # update that leaves it untouched, which would make a re-render look like a newer part.
    $body = @{ thumbnail_url = $publicUrl; thumbnail_source_mtime = $SourceMtimeUtc.ToString('o'); modified_at = $SourceMtimeUtc.ToString('o') } | ConvertTo-Json -Compress
    Invoke-WithRetry -What 'patch files row' -Action {
        Invoke-RestMethod -Uri "$SupabaseUrl/rest/v1/files?id=eq.$FileId" -Headers $patch -Method PATCH -Body $body | Out-Null
    }
    return $publicUrl
}

function Request-DriveThumbnail {
    # Fallback: the google-drive edge function fetches Drive's own preview for the file
    # (or extracts the embedded one) and updates files.thumbnail_url itself.
    param([string] $FileId, [string] $DriveFileId)
    $headers = $script:AuthHeaders.Clone()
    $headers['Content-Type'] = 'application/json'
    $body = @{ action = 'get_thumbnail'; db_file_id = $FileId; drive_file_id = $DriveFileId } | ConvertTo-Json -Compress
    $resp = Invoke-WithRetry -What 'drive get_thumbnail' -Action {
        Invoke-RestMethod -Uri "$SupabaseUrl/functions/v1/google-drive" -Headers $headers -Method POST -Body $body -TimeoutSec 120
    }
    if (-not $resp.thumbnail_url) { throw "get_thumbnail returned no thumbnail ($($resp.error))" }
    return $resp.thumbnail_url
}

function Set-AttemptStamp {
    # Record that this version of the file was attempted, without touching thumbnail_url.
    param([string] $FileId, [datetime] $SourceMtimeUtc)
    $patch = $script:AuthHeaders.Clone()
    $patch['Content-Type'] = 'application/json'
    $patch['Prefer']       = 'return=minimal'
    $body = @{ thumbnail_source_mtime = $SourceMtimeUtc.ToString('o'); modified_at = $SourceMtimeUtc.ToString('o') } | ConvertTo-Json -Compress
    Invoke-WithRetry -What 'stamp files row' -Action {
        Invoke-RestMethod -Uri "$SupabaseUrl/rest/v1/files?id=eq.$FileId" -Headers $patch -Method PATCH -Body $body | Out-Null
    }
}

# ─── Local index: Drive ID → file ───────────────────────────────────────────

function Get-DriveId {
    param([string] $Path)
    # Drive for desktop stores the Drive item ID in an NTFS alternate data stream.
    try { return (Get-Content -LiteralPath "${Path}:user.drive.id" -Raw -ErrorAction Stop).Trim() } catch { return $null }
}

$local = @()
foreach ($fp in $FolderPath) {
    $found = @(Get-ChildItem -LiteralPath $fp -Recurse -File -ErrorAction SilentlyContinue |
               Where-Object { $Extensions -contains $_.Extension.ToLowerInvariant() })
    Log ("Indexed {0}: {1} SolidWorks files" -f $fp, $found.Count)
    $local += $found
}

$byDriveId = @{}   # drive id  -> FileInfo
$byName    = @{}   # lowercase name -> [FileInfo[]]  (fallback only)
$noId = 0
foreach ($f in $local) {
    $id = Get-DriveId $f.FullName
    if ($id) { $byDriveId[$id] = $f } else { $noId++ }
    $k = $f.Name.ToLowerInvariant()
    if (-not $byName.ContainsKey($k)) { $byName[$k] = @() }
    $byName[$k] += $f
}
Log ("Local: {0} SolidWorks files, {1} with Drive IDs, {2} without" -f @($local).Count, $byDriveId.Count, $noId)

# ─── Decide what to render ──────────────────────────────────────────────────

$rows = Get-SolidWorksRows
Log ("Database: {0} SolidWorks rows" -f @($rows).Count)

$work = @(); $upToDate = 0; $missing = 0; $ambiguous = 0
foreach ($row in $rows) {
    $file = $null; $how = 'drive id'
    if ($row.drive_file_id -and $byDriveId.ContainsKey($row.drive_file_id)) {
        $file = $byDriveId[$row.drive_file_id]
    } else {
        # Fallback for rows whose Drive ID is not on the mount (yet): a unique filename match.
        $k = $row.filename.ToLowerInvariant()
        $cands = if ($byName.ContainsKey($k)) { @($byName[$k]) } else { @() }
        if ($cands.Count -eq 1) { $file = $cands[0]; $how = 'filename' }
        elseif ($cands.Count -gt 1) { $ambiguous++; Log ("ambiguous: {0} matches {1} local files and its Drive ID is not on the mount" -f $row.filename, $cands.Count) 'SKIP'; continue }
    }
    if (-not $file) { $missing++; Log ("not on mount: {0} (drive {1})" -f $row.filename, $row.drive_file_id) 'SKIP'; continue }

    $mtime = $file.LastWriteTimeUtc
    # Stale = never attempted for this version of the file. A failed attempt stamps
    # thumbnail_source_mtime too, so it is retried only once the file changes.
    $stale = $true
    if (-not $Force -and $row.thumbnail_source_mtime) {
        $attempted = ([datetime]$row.thumbnail_source_mtime).ToUniversalTime()
        $stale = ($mtime - $attempted).TotalSeconds -gt 2
    }
    if (-not $stale) { $upToDate++; continue }
    $work += [pscustomobject]@{ Row = $row; File = $file; How = $how; Mtime = $mtime }
}
Log ("Plan: {0} to render, {1} up to date, {2} not on mount, {3} ambiguous" -f $work.Count, $upToDate, $missing, $ambiguous)

# ─── Render + publish ───────────────────────────────────────────────────────

$tempDir = Join-Path $env:TEMP 'sldprt-thumbs'
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

if ($Limit -gt 0 -and $work.Count -gt $Limit) { Log ("Limit: rendering the first {0} of {1}" -f $Limit, $work.Count) 'WARN'; $work = @($work | Select-Object -First $Limit) }

$ok = 0; $fallback = 0; $failed = 0; $vanished = 0
foreach ($item in $work) {
    $row = $item.Row; $file = $item.File
    $why = if (-not $row.thumbnail_url) { 'new' } elseif ($Force) { 'forced' } elseif (-not $row.thumbnail_source_mtime) { 'untracked' } else { 'changed' }
    if ($DryRun) { Log ("would render [{0}, {1}] {2}" -f $why, $item.How, $file.FullName) 'INFO'; continue }

    # Drive keeps moving things while we work; a file that is gone now is resolved by ID next run.
    if (-not (Test-Path -LiteralPath $file.FullName)) { Log ("moved since indexing: {0}" -f $file.FullName) 'SKIP'; $vanished++; continue }

    $out = Join-Path $tempDir "$($row.id).jpg"
    try {
        try {
            Invoke-Render -Path $file.FullName -OutPath $out -Size $ThumbSize -TimeoutSec $PerFileTimeoutSec
            Publish-Thumbnail -FileId $row.id -LocalJpeg $out -SourceMtimeUtc $item.Mtime | Out-Null
            Log ("[{0}, {1}] {2}" -f $why, $item.How, $file.Name) 'OK'
            $ok++
        } catch {
            $renderErr = $_.Exception.Message
            if (-not $row.drive_file_id) { throw }
            # No shell preview (e.g. saved without one): take Drive's own preview instead.
            Request-DriveThumbnail -FileId $row.id -DriveFileId $row.drive_file_id | Out-Null
            Set-AttemptStamp -FileId $row.id -SourceMtimeUtc $item.Mtime
            Log ("[{0}, {1}] {2} - shell render failed ({3}); used Drive preview" -f $why, $item.How, $file.Name, $renderErr) 'WARN'
            $fallback++
        }
    } catch {
        Log ("{0} - {1}" -f $file.FullName, $_.Exception.Message) 'FAIL'
        # Stamp so this version is not retried every 30 minutes; a re-save clears the way.
        try { Set-AttemptStamp -FileId $row.id -SourceMtimeUtc $item.Mtime } catch { Log ("could not stamp {0}: {1}" -f $row.id, $_.Exception.Message) 'WARN' }
        $failed++
    } finally {
        if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force -ErrorAction SilentlyContinue }
    }
}

$mutex.ReleaseMutex() | Out-Null
$elapsed = [int]((Get-Date) - $runStart).TotalSeconds
Log ("Run end  rendered={0} drivePreview={1} failed={2} moved={3} upToDate={4} notOnMount={5} ambiguous={6} in {7}s" -f $ok, $fallback, $failed, $vanished, $upToDate, $missing, $ambiguous, $elapsed) $(if ($failed) { 'WARN' } else { 'INFO' })
exit 0
