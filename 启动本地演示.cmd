@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.12 or later, then try again.
  pause
  exit /b 1
)
node.exe "%~dp0scripts\start-local.mjs"
if errorlevel 1 pause
