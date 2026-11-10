@echo off
rem Starts the BrainADZ Events server on this PC for the venue network.
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 22 or newer from https://nodejs.org first. & pause & exit /b 1)
if not exist node_modules call npm install
if not exist web\dist call npm run build
call npm start
pause
