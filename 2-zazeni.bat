@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules (
  echo Najprej zazeni 1-namesti.bat.
  pause
  exit /b 1
)
call npm start
