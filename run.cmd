@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\pythonw.exe" (
  echo Python environment missing. Follow README.md setup instructions.
  pause
  exit /b 1
)
start "" ".venv\Scripts\pythonw.exe" -m korail_macro
