@echo off
chcp 65001 >nul
cd /d %~dp0
title 配置真实支付
echo ==========================================
echo   真实支付配置向导
echo ==========================================
echo.
echo   本向导将帮助您配置支付宝/微信支付。
echo   请提前准备好以下信息：
echo.
echo   1. 公网穿透地址（cpolar/natapp/ngrok）
echo   2. 支付宝沙箱 APPID、应用私钥、支付宝公钥
echo   3. 微信支付商户号、APIv3密钥等（可选）
echo.
echo   密钥对已生成在 keys/ 目录中
echo   按任意键开始配置...
pause >nul
node.exe setup-pay.js
echo.
echo   配置完成！请双击「启动服务.bat」重启服务。
pause
