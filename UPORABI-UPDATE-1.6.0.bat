@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title FBX update 1.6.0

where node >nul 2>nul || (
  echo NAPAKA: Node.js ni namescen ali ni v PATH.
  pause
  exit /b 1
)

node apply-v1.6.0.cjs
if errorlevel 1 (
  echo.
  echo Update ni bil uporabljen.
  pause
  exit /b 1
)

echo.
echo Zdaj v projektni mapi zazeni:
echo   npm test
echo   2-zazeni.bat
echo.
pause
