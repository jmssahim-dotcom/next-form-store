@echo off
cd /d "%~dp0"
if not exist .env (
  copy .env.example .env >nul
  echo Created .env from .env.example.
  echo Edit .env and add your Supabase, SSLCOMMERZ and WhatsApp values before testing live features.
)
if not exist node_modules (
  echo Installing project dependencies...
  call npm install
  if errorlevel 1 goto :error
)
echo Starting NEXT FORM local server...
call npm start
pause
goto :eof
:error
echo Setup failed. Check that Node.js and npm are installed.
pause
