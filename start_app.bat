@echo off

:: =============================================================================
:: Self-Elevating Batch Script for PyClipboardHistory
:: =============================================================================

:: 1. Check for Administrator Privileges
:: ------------------------------------------------
net session >nul 2>&1
if %errorLevel% == 0 (
    :: Already has admin rights, proceed to start the app
    goto :start_app
) else (
    :: Does not have admin rights, re-launch self with elevation
    goto :elevate
)

:elevate
:: 2. Re-launch self with Admin rights using PowerShell
:: ------------------------------------------------
echo Requesting administrator privileges to run global hotkeys...

:: Use PowerShell to trigger the UAC prompt and re-run this same batch file
powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul

:: Exit the current non-admin instance
exit /b


:start_app
:: 3. Start the Python Application (with Admin rights)
:: ------------------------------------------------
echo Administrator access granted. Starting PyClipboardHistory...

:: Get the directory where this batch file is located
set "CURRENT_DIR=%~dp0"

:: Construct the absolute paths
set "PYTHONW_PATH=%CURRENT_DIR%.venv\Scripts\pythonw.exe"
set "MAIN_SCRIPT_PATH=%CURRENT_DIR%py_clipboard_history\main.py"

:: Check if paths are valid
if not exist "%PYTHONW_PATH%" (
    echo ERROR: pythonw.exe not found at "%PYTHONW_PATH%"
    pause
    exit /b 1
)
if not exist "%MAIN_SCRIPT_PATH%" (
    echo ERROR: main.py not found at "%MAIN_SCRIPT_PATH%"
    pause
    exit /b 1
)

:: Start the application in the background
start "PyClipboardHistory" /B "%PYTHONW_PATH%" "%MAIN_SCRIPT_PATH%"

echo Application started successfully in the background.

:: Optional: A brief pause to see the message before the window closes
timeout /t 2 >nul

exit /b