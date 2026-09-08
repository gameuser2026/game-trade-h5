@echo off
chcp 65001 >nul
cd /d %~dp0
title 游易达 - Fly.io 一键部署

echo ==========================================
echo   游易达 Fly.io 一键部署脚本
echo ==========================================
echo.

REM 检查 flyctl 是否可用
where flyctl >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未找到 flyctl，请先下载安装：
    echo.
    echo   方式 1（推荐，需 VPN 或海外网络）:
    echo     PowerShell 执行: iwr https://fly.io/install.ps1 -useb ^| iex
    echo.
    echo   方式 2（手动下载）:
    echo     浏览器打开 https://github.com/superfly/flyctl/releases/latest
    echo     下载 flyctl-windows-amd64.zip
    echo     解压后把 flyctl.exe 放到 %USERPROFILE%\flyctl-bin\
    echo     然后把 %USERPROFILE%\flyctl-bin 加到 PATH 环境变量
    echo.
    pause
    exit /b 1
)

echo [1/5] 检查 flyctl 版本...
flyctl version
echo.

echo [2/5] 检查登录状态...
flyctl auth whoami >nul 2>nul
if %errorlevel% neq 0 (
    echo 未登录，正在打开浏览器登录...
    flyctl auth login
)

echo.
echo [3/5] 开始部署（首次会询问 app name 和 region）...
echo   - app name 建议: game-trade-h5-你的姓名拼音（要全局唯一）
echo   - region 建议: hkg （香港，国内最快）
echo   - 数据库: N （项目用文件存储）
echo.
flyctl deploy --strategy=rolling

echo.
echo [4/5] 创建持久化卷（保存 data.json + 上传图片）...
echo   请输入你的 app name:
set /p APP_NAME="app name: "
flyctl volumes create game_data --size 1 --region hkg --app %APP_NAME%
flyctl volumes create game_uploads --size 1 --region hkg --app %APP_NAME%

echo.
echo [5/5] 重新部署让卷挂载生效...
flyctl deploy --strategy=rolling --app %APP_NAME%

echo.
echo ==========================================
echo   ✅ 部署完成！
echo ==========================================
echo.
echo   你的公网访问地址（在部署输出中查找）:
echo     https://%APP_NAME%.fly.dev
echo.
echo   下一步：把域名填回 pay.config.js 后上传到容器
echo     1. 编辑 pay.config.js，把 notifyUrl 和 returnUrl 改为:
echo        notifyUrl = 'https://%APP_NAME%.fly.dev/api/pay/alipay/notify'
echo        returnUrl  = 'https://%APP_NAME%.fly.dev/'
echo     2. 上传到容器:
echo        flyctl ssh sftp put ./pay.config.js /app/pay.config.js --app %APP_NAME%
echo     3. 重启应用:
echo        flyctl apps restart %APP_NAME%
echo.
echo   查看实时日志: flyctl logs --app %APP_NAME%
echo   SSH 进入容器: flyctl ssh console --app %APP_NAME%
echo ==========================================
pause
