@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ========================================
echo   EcoPilot Desktop 一键安装启动
echo ========================================
echo.

:: ── 前置检查 ──
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 未检测到 Node.js，请从 https://nodejs.org 安装 LTS 版本
    pause
    exit /b 1
)

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 未检测到 Python，请从 https://www.python.org 安装 3.11+
    pause
    exit /b 1
)

:: ── 启用 pnpm ──
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] 正在启用 pnpm...
    corepack enable
    corepack prepare pnpm@11.7.0 --activate
)

:: ── 安装依赖 ──
echo [1/3] 安装项目依赖...
cd /d "%~dp0.."

:: 首次安装需要批准 electron/sharp/core-js 的构建脚本，否则依赖不完整
echo   批准构建脚本...
call pnpm config set onlyBuiltDependencies "electron" "sharp" "core-js" --location=project 2>nul

call pnpm install
if %errorlevel% neq 0 (
    echo [ERROR] pnpm install 失败，请检查网络或切换到镜像源
    pause
    exit /b 1
)

:: ── 启动 Electron ──
echo.
echo [3/3] 启动 EcoPilot Desktop...
echo.
cd /d "%~dp0.."
call pnpm exec electron electron-app/main.js -- --dev

endlocal
