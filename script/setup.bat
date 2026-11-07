@echo off
:: Golden Map Atlas - Install dependencies and create atlas.config.ts
::   setup.bat
setlocal
cd /d "%~dp0.."
title Golden Map Atlas - setup
set "RC=1"
where node >nul 2>&1
if errorlevel 1 (
    echo [x] Node.js not found. Install Node 18+ from https://nodejs.org
    goto :done
)
node core\cli.mjs setup %*
set "RC=%ERRORLEVEL%"
:done
if "%~1"=="" pause
endlocal & exit /b %RC%
