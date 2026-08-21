@echo off
REM Zeltro GUI - Windows installer.
REM
REM Just double-click it. It asks for administrator rights itself (needed to
REM install the OpenSSH server and a Windows optional feature).
REM
REM Deliberately thin: it elevates, then hands off to install-windows.ps1,
REM which does the real work. Batch is a poor language for ACLs, JSON and
REM service management, and the PowerShell script is maintained in the repo
REM where it can be read and edited like normal code.
REM
REM Works standalone - if the .ps1 is not next to it, it is fetched from
REM GitHub, so this one file is all you need on a fresh machine.

setlocal
set "RAW=https://raw.githubusercontent.com/CaneBayComputers/zeltro-gui/dev/scripts/install-windows.ps1"

REM --- elevate if needed ---------------------------------------------------
net session >nul 2>&1
if %errorlevel% equ 0 goto :elevated
echo.
echo   Requesting administrator rights...
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b

:elevated
REM Elevation resets the working directory to system32, so always use the
REM script's own folder rather than whatever the shell happens to be in.
set "PS1=%~dp0install-windows.ps1"
if exist "%PS1%" goto :run

echo   Fetching the installer script...
set "PS1=%TEMP%\install-windows.ps1"
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest '%RAW%' -OutFile '%TEMP%\install-windows.ps1'"
if not exist "%PS1%" (
    echo   Could not download the installer. Check the internet connection.
    pause
    exit /b 1
)

:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
endlocal
