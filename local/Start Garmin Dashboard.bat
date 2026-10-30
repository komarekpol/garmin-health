@echo off
title Garmin Health Dashboard
color 0A
set PYTHONUTF8=1
cd /d "%~dp0"

echo.
echo  ================================================
echo   GARMIN HEALTH DASHBOARD
echo  ================================================
echo.
echo  [1/3] Stahuji nova data z Garmin Connect...
echo        (jen nova data od posledniho syncu)
echo.

C:\Python314\python.exe -m garmin_givemydata

echo.
echo  [2/3] Export na Google Disk (Garmin Data\garmin-data.json)...
C:\Python314\python.exe "%~dp0garmin_export.py"

echo.
echo  [3/3] Spoustim lokalni server a oteviram dashboard...
echo.
echo  Toto okno nechej otevrene po dobu prace s dashboardem.
echo  Pro zavreni stiskni Ctrl+C nebo zavri okno.
echo.

C:\Python314\python.exe "%~dp0garmin_server.py"

pause
