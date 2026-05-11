@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe sur ce PC.
  echo Installe Node.js puis relance ce fichier.
  pause
  exit /b 1
)

echo Lancement du serveur NBA overlay...
start "NBA Overlay Server" cmd /k node server.js

timeout /t 2 /nobreak >nul

start "" "http://127.0.0.1:4173/admin.html"

echo.
echo Admin   : http://127.0.0.1:4173/admin.html
echo Wheel   : http://127.0.0.1:4173/index.html?mode=streamer
echo Draft   : http://127.0.0.1:4173/draft.html?mode=streamer
echo OBS     : utilise ensuite les liens display depuis l'admin
echo.
echo Garde la fenetre "NBA Overlay Server" ouverte pendant le live.
pause
