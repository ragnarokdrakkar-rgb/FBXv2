@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Fuzijska biopsija - namestitev odvisnosti

where node >nul 2>nul || (
  echo NAPAKA: Node.js ni namescen.
  echo Namesti Node.js 24 LTS in nato ponovno zazeni to datoteko.
  pause
  exit /b 1
)

where npm >nul 2>nul || (
  echo NAPAKA: npm ni na voljo.
  echo Ponovno namesti Node.js 24 LTS.
  pause
  exit /b 1
)

echo.
echo Uporabljen npm register:
call npm config get registry

echo.
echo Zapiram morebitne stare Electron procese ...
taskkill /F /IM electron.exe >nul 2>nul

if exist node_modules (
  echo Odstranjujem nepopoln node_modules ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference='SilentlyContinue';" ^
    "for($i=1;$i -le 5;$i++){" ^
    "  try { Remove-Item -LiteralPath 'node_modules' -Recurse -Force -ErrorAction Stop; exit 0 }" ^
    "  catch { Start-Sleep -Seconds 2 }" ^
    "}; exit 1"
  if exist node_modules (
    echo.
    echo NAPAKA: mape node_modules ni bilo mogoce odstraniti.
    echo Zapri VS Code, Raziskovalec v tej mapi in vse Electron aplikacije,
    echo nato ponovno zazeni 1-namesti.bat kot skrbnik.
    pause
    exit /b 1
  )
)

echo.
echo Preverjam npm predpomnilnik ...
call npm cache verify

echo.
echo Namescam odvisnosti iz javnega npm registra ...
call npm install --include=dev --registry=https://registry.npmjs.org/ --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
if errorlevel 1 (
  echo.
  echo Namescanje ni uspelo.
  echo.
  echo Preveri povezavo z ukazom:
  echo   npm ping --registry=https://registry.npmjs.org/
  echo.
  echo Ce uporabljas sluzbeni proxy, bo morda potrebna nastavitev IT oddelka.
  pause
  exit /b 1
)

echo.
echo Zagon testov ...
call npm test
if errorlevel 1 (
  echo.
  echo Odvisnosti so namescene, vendar testi niso uspeli.
  pause
  exit /b 1
)

echo.
echo KONCANO. Zdaj zazeni 2-zazeni.bat.
pause
