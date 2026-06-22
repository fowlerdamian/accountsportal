# Tasks Desktop Widget

A pinned, always-on-top desktop gadget showing **your open staff-portal tasks**
(`staff_tasks` where `assigned_to = you`, status not done). It live-updates over
the same Supabase realtime channel as the full Tasks app, and you can cycle a
task's stage/quadrant right from the widget.

## How it works
- **`/tasks/widget`** — a chrome-free route in the portal (`src/apps/Tasks/pages/TaskWidget.tsx`)
  that renders just the task list, reusing the real auth session + `TaskTile`.
- **`launch-tasks-widget.ps1`** — opens that route in a borderless Microsoft Edge
  *app window* (no tabs/address bar) and pins it always-on-top via `SetWindowPos`.
  A dedicated Edge profile under `%LOCALAPPDATA%\TasksWidget` keeps it a separate
  instance (needed to own the window handle) and **persists your login** — sign in once.

## Run it
```powershell
powershell -ExecutionPolicy Bypass -File .\launch-tasks-widget.ps1
```
First run opens the portal login inside the widget — sign in, and it stays signed in.

Options: `-Width 380 -Height 680 -X 0 -Y 80` (X/Y default to the top-right corner),
`-Url <url>`, `-NoTopMost` (don't pin).

## Start automatically on login (no console flash)
Put a shortcut to **`start-widget-hidden.vbs`** in your Startup folder:
```powershell
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut("$([Environment]::GetFolderPath('Startup'))\Tasks Widget.lnk")
$lnk.TargetPath = "$PWD\start-widget-hidden.vbs"
$lnk.Save()
```
(Run that from this folder.) Remove the `.lnk` to stop auto-starting.

## Notes
- Requires Microsoft Edge (ships with Windows 11).
- To move it: drag the **"My Tasks"** header strip. To resize: drag the window edges.
- If it ever fails to pin ("window handle not found"), close all windows of the
  `TasksWidget` Edge profile and relaunch — it must be the only instance of that profile.
