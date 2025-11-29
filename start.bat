@echo off
title TrailWright QA

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo Node.js is not installed.
    echo.
    echo Please download and install Node.js from:
    echo   https://nodejs.org/
    echo.
    echo Choose the LTS version, then run this script again.
    echo.
    pause
    exit /b 1
)

echo.
echo TrailWright QA - Starting...
echo.

:: Check if dependencies are installed
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo Failed to install dependencies.
        pause
        exit /b 1
    )
)

:: Check if server/client dependencies are installed
if not exist "server\node_modules" (
    echo Running first-time setup...
    call npm run setup
    if %errorlevel% neq 0 (
        echo Failed to run setup.
        pause
        exit /b 1
    )
)

:: Check if Playwright browsers are installed
if not exist "%USERPROFILE%\.cache\ms-playwright" (
    echo Installing Playwright browsers...
    cd server
    call npx playwright install chromium
    cd ..
)

echo.
echo Starting TrailWright QA...
echo.
echo Once started, open http://localhost:3000 in your browser.
echo Press Ctrl+C to stop.
echo.

call npm run dev
