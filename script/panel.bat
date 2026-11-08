@echo off
:: Golden Map Atlas - Control panel: a local page for setup, capture, check and approve
::   panel.bat   (double-click it once; the page opens in the browser)
setlocal
cd /d "%~dp0.."
title Golden Map Atlas - panel
set "RC=1"
where node >nul 2>&1
if errorlevel 1 (
    echo [x] Node.js not found. Install Node 18+ from https://nodejs.org
    goto :done
)
start "Golden Map Atlas" /min node core\control-server.mjs --open
set "RC=0"
:done
if "%RC%"=="1" pause
endlocal & exit /b %RC%
