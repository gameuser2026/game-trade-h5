@echo off
chcp 65001 >nul
cd /d %~dp0
title 币易商城-服务+公网穿透
echo ==========================================
echo   币易商城 启动脚本（服务 + 公网穿透）
echo ==========================================
echo.

set "NODE_EXE=%~dp0node-full\node-v20.18.0-win-x64\node.exe"
set "CF_EXE=C:\Users\Administrator\Desktop\cf.exe"

if not exist "%NODE_EXE%" (
  echo [错误] 找不到 Node：%NODE_EXE%
  pause
  exit /b 1
)

REM --- 启动公网穿透（cloudflared，地址见 cf-启动.err.log）---
echo [1/2] 启动公网穿透（cloudflared）...
start "cloudflared" /min cmd /c ""%CF_EXE%" tunnel --url http://localhost:3000 > "%~dp0cf-启动.out.log" 2> "%~dp0cf-启动.err.log""

REM --- 启动后端服务 ---
echo [2/2] 启动后端服务...
echo.
echo ==========================================
echo   本地地址: http://localhost:3000
echo   公网地址: 约10秒后查看 cf-启动.err.log，
echo             搜 trycloudflare.com 即是（每次启动会变）
echo.
echo   演示账号：
echo     管理员   13800000000 / admin123
echo     用户李娜 13900000002 / buyer123
echo ==========================================
echo.
start ""  http://localhost:3000
"%NODE_EXE%" server.js
pause
