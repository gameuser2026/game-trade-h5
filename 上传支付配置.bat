@echo off
chcp 65001 >nul
cd /d %~dp0
title 游易达 - 上传支付配置到 Fly.io

echo ==========================================
echo   上传 pay.config.js 到 Fly.io 容器
echo ==========================================
echo.

set /p APP_NAME="请输入你的 Fly app name: "

echo.
echo 即将上传 pay.config.js 到容器 /app/pay.config.js...
echo 如果还没修改 pay.config.js 的 notifyUrl 和 returnUrl，请先修改：
echo   notifyUrl = 'https://%APP_NAME%.fly.dev/api/pay/alipay/notify'
echo   returnUrl  = 'https://%APP_NAME%.fly.dev/'
echo.
pause

flyctl ssh sftp put ./pay.config.js /app/pay.config.js --app %APP_NAME%
if %errorlevel% neq 0 (
    echo [错误] 上传失败，请检查 app name 和登录状态
    pause
    exit /b 1
)

echo.
echo 重启应用使配置生效...
flyctl apps restart %APP_NAME%

echo.
echo ==========================================
echo   ✅ 支付配置已上传并重启
echo ==========================================
echo.
echo   验证支付配置:
echo     flyctl ssh console --app %APP_NAME%
echo     然后在容器内执行: node -e "console.log(require('./pay.config.js').alipay)"
echo.
echo   访问 https://%APP_NAME%.fly.dev 测试
echo ==========================================
pause
