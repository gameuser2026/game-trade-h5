@echo off
chcp 65001 >nul
cd /d %~dp0
title 币易商城-服务+公网穿透
echo ==========================================
echo   币易商城 启动脚本（服务 + 公网穿透）
echo ==========================================
echo.

set "NODE_EXE=C:\Users\Administrator\Desktop\node-full\node-v20.18.0-win-x64\node.exe"
set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

if not exist "%NODE_EXE%" (
  echo [错误] 找不到 Node：%NODE_EXE%
  pause
  exit /b 1
)

REM --- 启动公网穿透（最小化窗口，地址显示在窗口里并写入 公网地址.txt）---
echo [1/2] 启动公网穿透（cloudflared）...
start "公网穿透-地址看这里" /min "%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-tunnel.ps1"

REM --- 启动后端服务（前台运行，关掉本窗口即停止服务）---
echo [2/2] 启动后端服务...
echo.
echo ==========================================
echo   本地地址: http://localhost:3000
echo   公网地址: 约20秒后查看「公网穿透-地址看这里」
echo             最小化窗口，或打开项目里的 公网地址.txt
echo             （每次启动地址都会变）
echo.
echo   演示账号：
echo     管理员   13800000000 / admin123
echo     用户李娜 13900000002 / buyer123
echo ==========================================
echo.
start ""  http://localhost:3000
"%NODE_EXE%" server.js
pause
