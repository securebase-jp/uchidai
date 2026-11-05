@echo off
rem Start Uchidai (Windows). Keep this file ASCII-only so the console code page cannot break it.
chcp 65001 >nul
cd /d "%~dp0"
"%~dp0runtime\node.exe" --disable-warning=ExperimentalWarning "%~dp0runtime\launcher.mjs"
if errorlevel 1 (
  echo.
  pause
)
