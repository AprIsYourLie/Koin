@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

powershell.exe -NoProfile -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 1; if ($response.StatusCode -eq 200) { exit 0 } } catch { exit 1 }"
if not errorlevel 1 goto open_koin

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Koin 无法启动：没有找到 Node.js。
  echo 请先安装 Node.js 22.13 或更高版本，然后重新双击此文件。
  pause
  exit /b 1
)

start "Koin 本地服务" /min cmd.exe /k "cd /d ""%~dp0"" && npm.cmd run dev"

echo 正在启动 Koin，请稍候...
set /a attempts=0
:wait_for_koin
set /a attempts+=1
powershell.exe -NoProfile -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 1; if ($response.StatusCode -eq 200) { exit 0 } } catch { exit 1 }"
if not errorlevel 1 goto open_koin
if %attempts% geq 15 goto failed
timeout /t 1 /nobreak >nul
goto wait_for_koin

:open_koin
start "" "http://localhost:3000"
exit /b 0

:failed
echo Koin 启动超时，请查看“Koin 本地服务”窗口中的提示。
pause
exit /b 1
