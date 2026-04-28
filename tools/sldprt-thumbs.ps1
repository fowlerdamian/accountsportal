<#
.SYNOPSIS
  Extracts thumbnails from SolidWorks .SLDPRT/.SLDASM files using the Windows
  Shell preview handler (sldwinshellextu.dll) and uploads them to Supabase
  Storage, updating files.thumbnail_url.

.DESCRIPTION
  Uses IShellItemImageFactory::GetImage which delegates to whichever shell
  extension is registered for the file type - i.e. SolidWorks's preview handler
  if SolidWorks/eDrawings is installed. Produces the same thumbnail Explorer's
  Preview Pane (Alt+P) shows.

  Workflow:
    1. Query Supabase for files with NULL thumbnail_url and a SolidWorks
       extension.
    2. For each, search the local folder tree for a filename match.
    3. Extract a 512x512 thumbnail.
    4. PUT to Supabase Storage at file-thumbnails/{db_file_id}.jpg.
    5. PATCH files row with the public URL.

.PARAMETER FolderPath
  Local root to search for SolidWorks files. Typically the Google Drive
  Desktop-synced folder for the project files.

.PARAMETER SupabaseUrl
  e.g. https://nvlezbqolzwixquusbfo.supabase.co

.PARAMETER ServiceRoleKey
  Supabase service-role JWT. Required to bypass RLS on files table and
  upload to private storage. Treat as secret.

.PARAMETER Bucket
  Storage bucket name. Default: contractor-hub-files

.PARAMETER ThumbSize
  Pixel size of the thumbnail (square). Default 512.

.EXAMPLE
  .\sldprt-thumbs.ps1 -FolderPath 'G:\My Drive\MAIN\_OPERATIONS\PROJECTS' `
                      -SupabaseUrl 'https://nvlezbqolzwixquusbfo.supabase.co' `
                      -ServiceRoleKey $env:SUPABASE_SERVICE_ROLE_KEY
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $FolderPath,
    [Parameter(Mandatory)] [string] $SupabaseUrl,
    [Parameter(Mandatory)] [string] $ServiceRoleKey,
    [string] $Bucket    = 'contractor-hub-files',
    [int]    $ThumbSize = 512
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $FolderPath)) {
    throw "FolderPath not found: $FolderPath"
}

# -- Win32 P/Invoke for IShellItemImageFactory ------------------------------

Add-Type -AssemblyName System.Drawing

if (-not ([System.Management.Automation.PSTypeName]'AGA.Thumbs').Type) {
Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace AGA {
    [StructLayout(LayoutKind.Sequential)]
    public struct SIZE { public int cx; public int cy; }

    [Flags] public enum SIIGBF {
        ResizeToFit   = 0x00,
        BiggerSizeOk  = 0x01,
        MemoryOnly    = 0x02,
        IconOnly      = 0x04,
        ThumbnailOnly = 0x08,
        InCacheOnly   = 0x10
    }

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IShellItem { }

    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IShellItemImageFactory {
        [PreserveSig]
        int GetImage([In] SIZE size, [In] SIIGBF flags, [Out] out IntPtr phbm);
    }

    public static class Thumbs {
        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
        static extern void SHCreateItemFromParsingName(
            [MarshalAs(UnmanagedType.LPWStr)] string path,
            IntPtr pbc,
            [In] ref Guid riid,
            [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);

        [DllImport("gdi32.dll")]
        static extern bool DeleteObject(IntPtr hObject);

        public static Bitmap Get(string path, int size) {
            Guid g = typeof(IShellItemImageFactory).GUID;
            IShellItem item;
            SHCreateItemFromParsingName(path, IntPtr.Zero, ref g, out item);
            var fac = (IShellItemImageFactory)item;
            IntPtr hbmp;
            int hr = fac.GetImage(new SIZE { cx = size, cy = size },
                                   SIIGBF.BiggerSizeOk, out hbmp);
            if (hr != 0) throw new System.ComponentModel.Win32Exception(hr);
            try {
                var src = Bitmap.FromHbitmap(hbmp);
                // Copy off the HBITMAP-backed bitmap so we can free the handle
                var copy = new Bitmap(src);
                src.Dispose();
                return copy;
            } finally {
                DeleteObject(hbmp);
            }
        }
    }
}
"@ -ReferencedAssemblies System.Drawing
}

# -- Helpers -----------------------------------------------------------------

function Get-PendingFiles {
    $url = "$SupabaseUrl/rest/v1/files?select=id,filename,project_id,drive_file_id" +
           "&thumbnail_url=is.null" +
           "&or=(filename.ilike.*.sldprt,filename.ilike.*.sldasm)"
    $headers = @{
        apikey        = $ServiceRoleKey
        Authorization = "Bearer $ServiceRoleKey"
    }
    Invoke-RestMethod -Uri $url -Headers $headers -Method GET
}

function Save-Thumbnail {
    param([System.Drawing.Bitmap] $Bitmap, [string] $OutPath)
    # Encode as JPEG quality 85
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
             Where-Object { $_.MimeType -eq 'image/jpeg' }
    $params = New-Object System.Drawing.Imaging.EncoderParameters 1
    $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
        [System.Drawing.Imaging.Encoder]::Quality, [long]85)
    $Bitmap.Save($OutPath, $codec, $params)
}

function Upload-ToStorage {
    param([string] $LocalPath, [string] $StoragePath)
    $url = "$SupabaseUrl/storage/v1/object/$Bucket/$StoragePath"
    $headers = @{
        Authorization  = "Bearer $ServiceRoleKey"
        apikey         = $ServiceRoleKey
        'x-upsert'     = 'true'
        'Content-Type' = 'image/jpeg'
    }
    Invoke-RestMethod -Uri $url -Headers $headers -Method POST `
                      -InFile $LocalPath -ContentType 'image/jpeg' | Out-Null
    return "$SupabaseUrl/storage/v1/object/public/$Bucket/$StoragePath"
}

function Update-FileRow {
    param([string] $FileId, [string] $ThumbUrl)
    $url = "$SupabaseUrl/rest/v1/files?id=eq.$FileId"
    $headers = @{
        apikey         = $ServiceRoleKey
        Authorization  = "Bearer $ServiceRoleKey"
        'Content-Type' = 'application/json'
        Prefer         = 'return=minimal'
    }
    $body = @{ thumbnail_url = $ThumbUrl } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri $url -Headers $headers -Method PATCH -Body $body | Out-Null
}

# -- Main --------------------------------------------------------------------

Write-Host "Searching $FolderPath for SolidWorks files..." -ForegroundColor Cyan
$localFiles = Get-ChildItem -LiteralPath $FolderPath -Recurse -File `
              -Include '*.sldprt','*.sldasm' -ErrorAction SilentlyContinue

# Build a name->path map (case-insensitive). Multiple matches resolved by first.
$byName = @{}
foreach ($f in $localFiles) {
    if (-not $byName.ContainsKey($f.Name.ToLowerInvariant())) {
        $byName[$f.Name.ToLowerInvariant()] = $f.FullName
    }
}
Write-Host "Found $($localFiles.Count) local SolidWorks files." -ForegroundColor Cyan

Write-Host "Querying Supabase for files needing thumbnails..." -ForegroundColor Cyan
$pending = Get-PendingFiles
Write-Host "$($pending.Count) files need thumbnails." -ForegroundColor Cyan

$tempDir = Join-Path $env:TEMP "sldprt-thumbs"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

$ok = 0; $missing = 0; $failed = 0
foreach ($row in $pending) {
    $key = $row.filename.ToLowerInvariant()
    if (-not $byName.ContainsKey($key)) {
        Write-Host "  [skip] $($row.filename) - not found locally" -ForegroundColor DarkGray
        $missing++
        continue
    }
    $localPath = $byName[$key]
    $outPath   = Join-Path $tempDir "$($row.id).jpg"

    try {
        $bmp = [AGA.Thumbs]::Get($localPath, $ThumbSize)
        try {
            Save-Thumbnail -Bitmap $bmp -OutPath $outPath
        } finally {
            $bmp.Dispose()
        }
        $publicUrl = Upload-ToStorage -LocalPath $outPath `
                                      -StoragePath "file-thumbnails/$($row.id).jpg"
        Update-FileRow -FileId $row.id -ThumbUrl $publicUrl
        Write-Host "  [ok]   $($row.filename)" -ForegroundColor Green
        $ok++
    } catch {
        Write-Host "  [fail] $($row.filename) - $($_.Exception.Message)" -ForegroundColor Red
        $failed++
    } finally {
        if (Test-Path -LiteralPath $outPath) { Remove-Item -LiteralPath $outPath -Force }
    }
}

Write-Host ""
Write-Host "Done. ok=$ok missing=$missing failed=$failed" -ForegroundColor Cyan
