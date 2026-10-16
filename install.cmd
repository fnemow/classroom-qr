@echo off
echo Paste the extension ID shown in chrome://extensions or edge://extensions:
set /p "CQ_EXTENSION_ID=Extension ID: "
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -ExtensionId "%CQ_EXTENSION_ID%"
pause
