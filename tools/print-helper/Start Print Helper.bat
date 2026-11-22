@echo off
rem Starts the Coderswurld Print Helper in the background.
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0CoderswurldPrint.ps1"
echo Coderswurld Print Helper started. You can close this window.
timeout /t 3 >nul
