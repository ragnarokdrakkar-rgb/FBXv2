@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules (
  echo Najprej zazeni 1-namesti.bat.
  pause
  exit /b 1
)
echo Poganjam teste ...
call npm test
if errorlevel 1 (
  echo.
  echo Testi niso uspeli. EXE ni bil zgrajen.
  pause
  exit /b 1
)
echo.
echo Gradim Windows installer in datoteke za samodejne posodobitve ...
call npm run dist:win
if errorlevel 1 (
  echo.
  echo Gradnja ni uspela.
  pause
  exit /b 1
)
echo.
echo KONCANO.
echo Installer je v mapi release.
explorer "%~dp0release"
pause
