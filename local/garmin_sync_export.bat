@echo off
rem Planovac uloh: stahne nova data z Garmin Connect a zapise export na Google Disk.
rem Vystup posledniho behu: sync_log.txt ve stejne slozce.
set PYTHONUTF8=1
cd /d "%~dp0"
echo ==== %date% %time% ==== > "%~dp0sync_log.txt"
C:\Python314\python.exe -m garmin_givemydata >> "%~dp0sync_log.txt" 2>&1
C:\Python314\python.exe "%~dp0garmin_export.py" >> "%~dp0sync_log.txt" 2>&1
exit /b %errorlevel%
