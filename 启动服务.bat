@echo off
chcp 65001 >nul
cd /d %~dp0
title 币易商城-商品交易平台
echo ==========================================
echo   币易商城 自营商品交易平台
echo ==========================================
echo.
echo   正在启动服务，启动后将自动打开浏览器...
echo   如未打开，请手动访问 http://localhost:3000
echo.
echo   演示账号：
echo     管理员   13800000000 / admin123
echo     用户李娜 13900000002 / buyer123
echo.
echo   收款码上传：管理员登录 → 我的 → 平台管理后台 → 收款码
echo.
echo   关闭此窗口即停止服务
echo ==========================================
start ""  http://localhost:3000
"C:\Users\Administrator\Desktop\node-full\node-v20.18.0-win-x64\node.exe" server.js
pause
