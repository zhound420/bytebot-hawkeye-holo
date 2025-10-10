@echo off
REM Wrapper script to run PowerShell installer during Windows OOBE
REM This is called by dockur/windows CUSTOM environment variable

echo ============================================
echo   Bytebotd Pre-baked Image Installer
echo ============================================
echo.

powershell -ExecutionPolicy Bypass -File "C:\OEM\install-prebaked.ps1"

echo.
echo Installer finished with exit code: %ERRORLEVEL%
exit /b %ERRORLEVEL%
