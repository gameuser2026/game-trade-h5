@echo off
chcp 65001 >nul
cd /d %~dp0
title 游易达-服务+内网穿透
echo ==========================================
echo   游易达 启动脚本（服务 + 内网穿透）
echo ==========================================
echo.

REM --- 启动内网穿透（localtunnel，随机子域名，启动后查看弹窗显示的公网地址）---
echo [1/2] 启动内网穿透 localtunnel...
start "localtunnel" /min "%~dp0node-full\node-v20.18.0-win-x64\node.exe" "%~dp0node-full\node-v20.18.0-win-x64\node_modules\localtunnel\bin\lt.js" --port 3000

REM --- 启动后端服务 ---
echo [2/2] 启动后端服务...
echo.
echo ==========================================
echo   本地地址:   http://localhost:3000
echo   公网穿透:   请看 localtunnel 弹窗显示的 https://xxxx.loca.lt
echo.
echo   回调地址格式（填入支付宝/微信商户平台）：
echo     支付宝: https://xxxx.loca.lt/api/pay/alipay/notify
echo     微  信: https://xxxx.loca.lt/api/pay/wechat/notify
echo   （将 xxxx 替换为 localtunnel 弹窗显示的实际子域名）
echo.
echo   演示账号：
echo     管理员 13800000000 / admin123
echo     卖  家 13900000001 / seller123
echo     买  家 13900000002 / buyer123
echo.
echo   提示：首次访问公网地址如出现 loca.lt 安全页，
echo         按提示输入 IP 点 Continue 即可。
echo ==========================================
start ""  http://localhost:3000
node.exe server.js
pause
