@echo off
setlocal
cd /d "%~dp0"
echo PATCH - Fresh Windows Setup
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL_PATCH.ps1"
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" (
  echo PATCH setup did not complete successfully. Review the error above.
) else (
  echo PATCH setup finished successfully.
)
pause
exit /b %EXITCODE%
