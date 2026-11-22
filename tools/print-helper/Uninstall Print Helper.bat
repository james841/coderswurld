@echo off
rem Stops the helper and removes it from Windows start-up.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*CoderswurldPrint.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Coderswurld Print Helper.lnk" 2>nul
echo Coderswurld Print Helper stopped and removed from start-up.
pause
