@echo off
setlocal
cd /d "%~dp0"
if not exist "runtime\app.exe" (
    echo ReadAny is not installed in runtime. See docs/local-deployment.md.
    pause
    exit /b 1
)
start "" /d "%~dp0runtime" "%~dp0runtime\app.exe"
