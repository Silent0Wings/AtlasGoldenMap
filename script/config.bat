@echo off
:: Golden Map Atlas - Generate atlas.config.ts interactively
::   config.bat
setlocal
cd /d "%~dp0.."
title Golden Map Atlas - config
set "RC=1"
where node >nul 2>&1
if errorlevel 1 (
    echo [x] Node.js not found. Install Node 18+ from https://nodejs.org
    goto :done
)
node core\cli.mjs config %*
set "RC=%ERRORLEVEL%"
:done
if "%~1"=="" pause
endlocal & exit /b %RC%
