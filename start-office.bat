@echo off
rem Starts BrainADZ HRMS on this Windows computer so others on the office Wi-Fi can use it.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org , install it, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing for the first time. This takes a few minutes...
  call npm install || goto :failed
)
if not exist client\dist\index.html (
  call npm run build || goto :failed
)
call npm start
pause
exit /b 0
:failed
echo Something went wrong. Scroll up to see the error.
pause
exit /b 1
