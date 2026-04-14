@echo off
REM Double-click this file to run the voting app on your PC (development mode).
cd /d "%~dp0"
set NODE_ENV=development
set PORT=3000
echo Starting server... Press Ctrl+C to stop.
echo Open: http://127.0.0.1:3000/
echo.
node server.js
pause
