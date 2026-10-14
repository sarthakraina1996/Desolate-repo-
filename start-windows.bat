@echo off
rem Double-click this file to start Subscription Manager on Windows.
cd /d "%~dp0"
title Subscription Manager

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer.
  echo   Install the LTS version from https://nodejs.org - the page is opening now -
  echo   then double-click this file again.
  echo.
  start "" https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo.
  echo   First start: installing the app. This takes a minute...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   Installation failed - see the messages above.
    pause
    exit /b 1
  )
)

set OPEN_BROWSER=1
call npm start
echo.
echo   Subscription Manager has stopped.
pause
