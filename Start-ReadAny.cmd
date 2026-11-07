@echo off
setlocal
cd /d "%~dp0"
if not exist "runtime\app.exe" (
    echo ReadAny is not installed in runtime. See docs/local-deployment.md.
    pause
    exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0plus-bridge\launch.ps1"
if errorlevel 1 (
    echo ReadAny could not start. See the error above or docs/plus-connection.md.
    pause
    exit /b 1
)
