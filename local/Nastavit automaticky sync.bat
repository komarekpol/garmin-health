@echo off
rem Jednou spust (dvojklik): zalozi v Planovaci uloh automaticky sync + export na Disk 3x denne.
rem Kdyz je PC v tu dobu vypnute / uspane, uloha dobehne hned po zapnuti. Bezi jen kdyz jsi prihlaseny.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0nastavit_sync.ps1"
echo.
echo Prvni sync ted spoustim rucne (1-3 minuty)...
call "%~dp0garmin_sync_export.bat"
type "%~dp0sync_log.txt"
pause
