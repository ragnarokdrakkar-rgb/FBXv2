@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Fuzijska biopsija - ciscenje namestitve

echo Zapiram Electron procese ...
taskkill /F /IM electron.exe >nul 2>nul

echo Odstranjujem node_modules ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='SilentlyContinue';" ^
  "for($i=1;$i -le 5;$i++){" ^
  "  try { if(Test-Path -LiteralPath 'node_modules'){Remove-Item -LiteralPath 'node_modules' -Recurse -Force -ErrorAction Stop}; exit 0 }" ^
  "  catch { Start-Sleep -Seconds 2 }" ^
  "}; exit 1"

if exist node_modules (
  echo NAPAKA: node_modules je se vedno zaklenjen.
  echo Zapri VS Code, Raziskovalec in terminale, nato zazeni kot skrbnik.
  pause
  exit /b 1
)

echo Preverjam npm cache ...
call npm cache verify

echo.
echo Ciscenje je koncano. Zdaj zazeni 1-namesti.bat.
pause
