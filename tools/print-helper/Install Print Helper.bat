@echo off
rem Installs the Coderswurld Print Helper for this Windows user:
rem copies it to %LOCALAPPDATA%\CoderswurldPrint, starts it now,
rem and starts it automatically every time Windows starts.
setlocal
set "DEST=%LOCALAPPDATA%\CoderswurldPrint"
if not exist "%DEST%" mkdir "%DEST%"
copy /Y "%~dp0CoderswurldPrint.ps1" "%DEST%\CoderswurldPrint.ps1" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Coderswurld Print Helper.lnk');" ^
  "$s.TargetPath='powershell.exe';" ^
  "$s.Arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%DEST%\CoderswurldPrint.ps1\"';" ^
  "$s.WindowStyle=7; $s.Description='Coderswurld Print Helper'; $s.Save()"
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%DEST%\CoderswurldPrint.ps1"
echo.
echo Done. The Coderswurld Print Helper is running and will start with Windows.
echo Go back to Coderswurld, open Printer and scanner, and press "Check again".
echo.
pause
