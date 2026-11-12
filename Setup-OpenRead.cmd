@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0plus-bridge\install-shortcuts.ps1"
if errorlevel 1 (
    echo Could not create OpenRead shortcuts. See the error above.
    pause
    exit /b 1
)
call "%~dp0Start-OpenRead.cmd"
