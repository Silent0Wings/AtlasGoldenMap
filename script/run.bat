@echo off
:: Golden Map Atlas - Capture / build / check / open the atlas (menu when run without a mode)
::   run.bat [atlas^|capture^|build^|check^|crawl^|open^|report^|clean] [-- playwright args]
setlocal
cd /d "%~dp0.."
title Golden Map Atlas - run
set "RC=1"
where node >nul 2>&1
if errorlevel 1 (
    echo [x] Node.js not found. Install Node 18+ from https://nodejs.org
    goto :done
)
node core\cli.mjs run %*
set "RC=%ERRORLEVEL%"
:done
if "%~1"=="" pause
endlocal & exit /b %RC%
