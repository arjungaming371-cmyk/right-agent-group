@echo off
cd /d "%~dp0"
title Right Agent Group - Startup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0START.ps1"
pause
