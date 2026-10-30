# Založí v Plánovači úloh automatický sync z Garmin Connect + export na Google Disk.
# Spouští se z „Nastavit automaticky sync.bat“. Lze pustit znovu (úlohu přepíše).
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$bat  = Join-Path $here 'garmin_sync_export.bat'
$act  = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$bat`"`"" -WorkingDirectory $here
$trg  = @('07:40', '12:40', '21:40') | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ }
# StartWhenAvailable: když je PC v čas úlohy vypnuté nebo uspané, úloha doběhne hned po zapnutí
$set  = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskPath '\Garmin Health\' -TaskName 'Sync a export' -Action $act -Trigger $trg -Settings $set -Force | Out-Null
Write-Host 'OK: uloha \Garmin Health\Sync a export (denne 07:40, 12:40, 21:40)'
