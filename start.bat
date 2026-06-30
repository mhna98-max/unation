@echo off
cd /d "%~dp0"
title UNATION

node --version >nul 2>nul
if errorlevel 1 (
    echo.
    echo  [ERROR] Node.js was not found on this computer.
    echo.
    echo  Please install Node.js (LTS version) from:
    echo  https://nodejs.org
    echo.
    echo  After installing, RESTART your computer, then run this file again.
    echo.
    echo  If you already installed Node.js and still see this message,
    echo  try opening Command Prompt manually and typing: node --version
    echo.
    pause
    exit /b 1
)

node "%~dp0launcher.js"

echo.
echo  ============================================
echo  Window will stay open. Press any key to close.
echo  (If a problem occurred, check launcher-log.txt
echo   in this same folder for details.)
echo  ============================================
pause >nul
