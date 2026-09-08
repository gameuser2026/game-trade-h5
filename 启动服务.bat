@echo off
chcp 65001 >nul
cd /d %~dp0
title 游易达-游戏担保交易平台
echo ==========================================
echo   游易达 游戏账号道具担保交易平台
echo ==========================================
echo.
echo   正在启动服务，启动后将自动打开浏览器...
echo   如未打开，请手动访问 http://localhost:3000
echo.
echo   演示账号：
echo     管理员 13800000000 / admin123
echo     卖  家 13900000001 / seller123
echo     买  家 13900000002 / buyer123
echo.
echo   【接入真实支付】
echo     编辑 pay.config.js 填入支付宝/微信商户信息，
echo     重启服务后自动启用真实支付（当前未配置走演示模式）。
echo.
echo   关闭此窗口即停止服务
echo ==========================================
start ""  http://localhost:3000
node.exe server.js
pause

