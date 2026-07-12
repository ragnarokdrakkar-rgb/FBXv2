@echo off
setlocal
cd /d "%~dp0"
title Fuzijska biopsija - GitHub posodobitve

where node >nul 2>nul || (
  echo NAPAKA: Node.js ni namescen.
  pause
  exit /b 1
)

echo.
echo Vnesi JAVNI GitHub repozitorij, kjer bodo objavljeni Releases.
echo Primer: ragnarokdrakkar-rgb/fuzijska-biopsija-desktop
echo.
node scripts\configure-update-repo.cjs
if errorlevel 1 (
  echo.
  echo Nastavitev ni uspela.
  pause
  exit /b 1
)

echo.
echo KONCANO. Zdaj lahko zazenes 3-zgradi-exe.bat.
pause
