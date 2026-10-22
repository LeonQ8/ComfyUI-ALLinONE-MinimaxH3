@echo off
setlocal
cd /d "%~dp0"
title One Node MiniMax H3 installer
for /f %%e in ('echo prompt $E^| cmd') do set "ESC=%%e"
echo.
echo %ESC%[96mOne Node MiniMax H3 installer (beta)%ESC%[0m
echo %ESC%[90mInstall folder: %CD%%ESC%[0m
echo %ESC%[90mDownloads Python, ComfyUI, 13 node packs and PyTorch, about 6 GB in total. Models are not included.%ESC%[0m
echo.
if exist "python_embeded\python.exe" (
  echo %ESC%[93mThis folder already has an install. Run update.bat instead.%ESC%[0m
  pause
  exit /b 1
)
if not "%~1"=="" if exist "%~1\stack.json" goto :local
echo %ESC%[96mDownloading the installer files from GitHub%ESC%[0m
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/LeonQ8/ComfyUI-ALLinONE-MinimaxH3/archive/refs/heads/main.zip' -OutFile 'h3src.zip'; Expand-Archive 'h3src.zip' -DestinationPath 'h3src' -Force; $src = Join-Path (Get-ChildItem 'h3src')[0].FullName 'installer'; if (-not (Test-Path (Join-Path $src 'stack.json'))) { throw 'The downloaded files do not contain the installer.' }; Copy-Item -Recurse -Force $src '.\installer' } catch { Write-Host ('  ' + $_.Exception.Message) -ForegroundColor Red; exit 1 } finally { Remove-Item -Recurse -Force 'h3src','h3src.zip' -ErrorAction SilentlyContinue }" || goto :fail
goto :bootstrap
:local
echo %ESC%[96mCopying the installer files from %~1%ESC%[0m
xcopy "%~1" "installer" /e /i /y /q >nul || goto :fail
:bootstrap
echo %ESC%[92m  Installer files ready%ESC%[0m
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "installer\bootstrap.ps1" -Root "%CD%" || goto :fail
copy /y "installer\update.bat" "update.bat" >nul
echo.
python_embeded\python.exe -I installer\run.py install --root "%CD%" || goto :resume
echo.
echo %ESC%[92mInstall finished.%ESC%[0m Start ComfyUI with Run-MiniMax-ALLinONE.bat. Get updates with update.bat.
pause
exit /b 0
:resume
echo.
echo %ESC%[91mInstall stopped.%ESC%[0m Read the messages above. Run update.bat to continue from where it stopped.
pause
exit /b 1
:fail
echo.
echo %ESC%[91mInstall failed.%ESC%[0m Read the messages above. You can delete this folder and try again.
echo Please report it at https://github.com/LeonQ8/ComfyUI-ALLinONE-MinimaxH3/issues
pause
exit /b 1
