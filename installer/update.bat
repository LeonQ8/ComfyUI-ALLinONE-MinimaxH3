@echo off
setlocal
cd /d "%~dp0"
title One Node MiniMax H3 updater
for /f %%e in ('echo prompt $E^| cmd') do set "ESC=%%e"
echo.
echo %ESC%[96mOne Node MiniMax H3 updater%ESC%[0m
echo %ESC%[90mInstall folder: %CD%%ESC%[0m
echo.
if not "%~1"=="" if exist "%~1\stack.json" goto :local
set "REF=%~1"
if "%REF%"=="" set "REF=main"
echo %ESC%[96mChecking for a newer tested stack (%REF%)%ESC%[0m
python_embeded\python.exe -I installer\run.py self-update --root "%CD%" --ref "%REF%" || goto :fail
goto :update
:local
echo %ESC%[96mCopying the installer files from %~1%ESC%[0m
python_embeded\python.exe -I installer\run.py self-update --root "%CD%" --from-dir "%~1" || goto :fail
:update
echo.
python_embeded\python.exe -I installer\run.py update --root "%CD%" %2 || goto :fail
echo.
echo %ESC%[92mUpdate finished.%ESC%[0m
pause
exit /b 0
:fail
echo.
echo %ESC%[91mUpdate failed.%ESC%[0m Steps before the error are kept, and replaced code is in the backups folder.
pause
exit /b 1
