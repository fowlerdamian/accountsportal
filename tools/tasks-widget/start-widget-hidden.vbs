' Launches the Tasks widget with no visible PowerShell console window.
' Point your Startup-folder shortcut / scheduled task at THIS file.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
ps1 = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "launch-tasks-widget.ps1")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """", 0, False
