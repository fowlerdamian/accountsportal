@echo off
rem AGA Label Station - run on the PC connected to the DYMO LabelWriter 550.
rem
rem Opens the staff portal print station in its own Chrome profile with
rem --kiosk-printing, which sends every print() straight to the WINDOWS DEFAULT
rem PRINTER with no dialog. Set "DYMO LabelWriter 550" as the default printer on
rem this PC first (Settings > Printers, untick "Let Windows manage my default").
rem Sign in once; the profile remembers the session. Put a shortcut to this file
rem in shell:startup so it comes back after a reboot.

set PROFILE=%LOCALAPPDATA%\AGA\label-station
set CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" set CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe

start "" "%CHROME%" --kiosk-printing --no-first-run --no-default-browser-check ^
  --user-data-dir="%PROFILE%" ^
  --app=https://app.automotivegroup.com.au/labels/station
