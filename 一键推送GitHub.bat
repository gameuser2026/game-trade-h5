@echo off
chcp 65001 >nul
echo =========================================
echo    币易 BiYiEx - 一键推送到 GitHub
echo =========================================
echo.

REM Git 便携版路径（已装在桌面）
set "GIT_PATH=C:\Users\Administrator\Desktop\git\cmd"
if not exist "%GIT_PATH%\git.exe" (
    echo [错误] 找不到 Git：%GIT_PATH%\git.exe
    echo 如果 Git 装在别的位置，请修改本脚本第 6 行的 GIT_PATH
    pause
    exit /b 1
)
set "PATH=%GIT_PATH%;%PATH%"

cd /d "%~dp0"

echo [1/3] 检查仓库状态...
git status --short
echo.

echo [2/3] 检查远程仓库...
git remote -v
echo.

echo [3/3] 开始推送...
git push origin main
echo.

if %ERRORLEVEL% EQU 0 (
    echo =========================================
    echo    ✅ 推送成功！
    echo    访问 https://github.com/gameuser2026/game-trade-h5
    echo =========================================
) else (
    echo =========================================
    echo    ❌ 推送失败
    echo    常见原因：
    echo    1. 网络封锁了 github.com（SSH 443端口）→ 换手机热点再试
    echo    2. SSH 密钥丢失 → 把此消息截图发给 AI 助手重新配置
    echo =========================================
)
echo.
pause
