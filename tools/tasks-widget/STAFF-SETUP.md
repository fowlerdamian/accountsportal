# Tasks Widget — Staff Setup Guide

Keep your portal tasks floating on your desktop, always on top of other windows.
It shows **your** open tasks (assigned to you, not done), updates live, and a
red/flashing due date warns you when something's due today or overdue.

**You need:** Windows 10/11 with Microsoft Edge (already installed on Windows 11),
and your staff-portal login.

---

## Recommended: always-on-top widget (auto-starts when you log in)

You only do this once.

1. **Get the `TasksWidget` folder.** Copy it from the shared drive
   (*Staff Drive → IT → TasksWidget*) to somewhere on your PC, e.g. `C:\TasksWidget`.
   It contains two files: `launch-tasks-widget.ps1` and `start-widget-hidden.vbs`.
   *(If you can't find it, ask IT — or see "For IT" at the bottom.)*

2. **Start it.** Open that folder, right-click **`launch-tasks-widget.ps1`** →
   **Run with PowerShell**. A small window appears in the top-right of your screen.

3. **Sign in once.** The first time, the widget shows the portal login — sign in
   with your normal staff account. It stays signed in from then on.

4. **Make it start automatically every time you log in.** Open PowerShell, paste
   this, and press Enter (adjust the path if you didn't use `C:\TasksWidget`):

   ```powershell
   $ws  = New-Object -ComObject WScript.Shell
   $lnk = $ws.CreateShortcut("$([Environment]::GetFolderPath('Startup'))\Tasks Widget.lnk")
   $lnk.TargetPath = "C:\TasksWidget\start-widget-hidden.vbs"
   $lnk.Save()
   ```

   That's it — the widget now opens by itself each time you sign in to Windows.

### Using it
- **Move it:** drag the **"My Tasks"** strip at the top.
- **Resize it:** drag the window edges.
- **Close it:** click the window's X (it'll come back at next login). To stop it
  auto-starting, delete the **Tasks Widget** shortcut from your Startup folder
  (press `Win+R`, type `shell:startup`, Enter, delete it there).

### If it won't stay on top
Close every `TasksWidget` window, then run `launch-tasks-widget.ps1` again — it
needs to be the only window using that widget profile.

---

## Quick alternative (no scripts — pins to taskbar, but not always-on-top)

If you just want a clean dedicated window you can pin and click open:

1. In Microsoft Edge, go to **`https://app.automotivegroup.com.au/tasks/widget`**
   and sign in.
2. Click the **`···`** menu (top-right) → **Apps** → **Install this site as an app**
   → name it *Tasks* → **Install**.
3. Tick **Start automatically when I sign in** when Edge offers it (or pin the app
   to your taskbar).

This gives its own little window, but it won't float over full-screen apps the way
the always-on-top version does.

---

## For IT — assembling the `TasksWidget` folder
The two files live in the repo at `tools/tasks-widget/`
(`launch-tasks-widget.ps1`, `start-widget-hidden.vbs`). Drop that folder on the
shared drive for staff to copy. The launcher is self-contained — it points at
`https://app.automotivegroup.com.au/tasks/widget`, opens it as a borderless Edge
app window in a dedicated `%LOCALAPPDATA%\TasksWidget` profile (persists login),
and pins it always-on-top via `SetWindowPos`. Optional flags:
`-Width 380 -Height 680 -X 0 -Y 80`, `-Url <url>`, `-NoTopMost`.
