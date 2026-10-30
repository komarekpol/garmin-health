@echo off
title Garmin Health Dashboard
color 0A
set PYTHONUTF8=1
cd /d "%~dp0"

echo.
echo  ================================================
echo   GARMIN HEALTH DASHBOARD - offline rezim
echo   (hlavni dashboard bezi v cloudu, PC neni potreba)
echo  ================================================
echo.
echo  [1/2] Stahuji nova data z Garmin Connect...
echo        (jen nova data od posledniho syncu)
echo.

C:\Python314\python.exe -m garmin_givemydata


echo.
echo  [2/2] Spoustim lokalni server a oteviram dashboard...
echo.
echo  Toto okno nechej otevrene po dobu prace s dashboardem.
echo  Pro zavreni stiskni Ctrl+C nebo zavri okno.
echo.

C:\Python314\python.exe "%~dp0garmin_server.py"

pause
