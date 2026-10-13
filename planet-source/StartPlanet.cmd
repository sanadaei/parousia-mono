@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install it from https://nodejs.org/
  echo Then open StartPlanet.cmd again. No Rust or npm install is required.
  pause
  exit /b 1
)
node --max-old-space-size=256 scripts\start-planet.mjs
if errorlevel 1 pause
