# SLDPRT thumbnail extractor

Modern SolidWorks files (2015+) use a proprietary, encrypted container — Drive's
auto-thumbnail returns nothing and there's no plaintext JPEG/PNG/DIB embedded
in the file for our edge function to extract.

This script runs locally on a Windows machine with SolidWorks (or eDrawings)
installed and uses the OS-level `IShellItemImageFactory` API — the same path
Explorer's Preview Pane (Alt+P) uses — to render thumbnails. SolidWorks's shell
extension (`sldwinshellextu.dll`) does the actual rendering.

## Requirements

- Windows 10/11, PowerShell 5.1+
- SolidWorks or eDrawings installed (provides the shell extension)
- Local copy of the project files (Drive Desktop sync recommended)
- Supabase service-role key

## One-time setup

1. Make sure your Drive Desktop is syncing the projects folder, e.g.
   `G:\My Drive\MAIN\_OPERATIONS\PROJECTS`.
2. Set the service-role key as an env var (don't commit it):
   ```powershell
   $env:SUPABASE_SERVICE_ROLE_KEY = '<paste from Supabase dashboard>'
   ```

## Run

```powershell
cd C:\Users\Damian\accounts-portal\tools
.\sldprt-thumbs.ps1 `
    -FolderPath     'G:\My Drive\MAIN\_OPERATIONS\PROJECTS' `
    -SupabaseUrl    'https://nvlezbqolzwixquusbfo.supabase.co' `
    -ServiceRoleKey $env:SUPABASE_SERVICE_ROLE_KEY
```

Output is one line per file: `[ok]`, `[skip]` (no local match) or `[fail]`.

## Schedule it (optional)

Task Scheduler → Create Basic Task → Daily at 02:00 → Action: Start a program

```
Program/script:  powershell.exe
Arguments:       -ExecutionPolicy Bypass -File "C:\Users\Damian\accounts-portal\tools\sldprt-thumbs.ps1" -FolderPath "G:\My Drive\MAIN\_OPERATIONS\PROJECTS" -SupabaseUrl "https://nvlezbqolzwixquusbfo.supabase.co" -ServiceRoleKey "<key>"
```

The script only processes rows where `thumbnail_url IS NULL`, so re-running is
cheap — only new/changed files get work.

## How it works (brief)

1. `GET /rest/v1/files?thumbnail_url=is.null&filename=ilike.%.sldprt` — list
   pending files (id, filename, drive_file_id).
2. For each, search the local folder tree by filename (case-insensitive).
3. P/Invoke `SHCreateItemFromParsingName` → `IShellItemImageFactory::GetImage`
   with `SIIGBF_BIGGERSIZEOK` to extract a 512×512 bitmap.
4. Encode JPEG q85.
5. `POST /storage/v1/object/contractor-hub-files/file-thumbnails/{id}.jpg`.
6. `PATCH /rest/v1/files?id=eq.{id}` with the public URL.

The frontend already renders `thumbnail_url` if present — once the row updates,
the next page load shows the thumbnail in the file list.

## Limitations

- **Filename match is global within the folder.** If two different projects
  have a file with the exact same name, only the first match wins. Use unique
  filenames or run it scoped to one project's subfolder.
- **Drive Desktop placeholders.** If a file is "online only," the shell call
  will trigger a download. If you don't want that, mark the folder
  "Always keep on this device."
- **Service-role key has full DB access.** Keep it out of git, scripts, and
  shared shells. Set as user-level env var or Windows Credential Manager.
