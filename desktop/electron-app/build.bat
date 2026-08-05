@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ========================================
echo   EcoPilot Windows 生产打包
echo ========================================
echo.

:: ── 前置检查 ──
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 未检测到 Node.js
    pause && exit /b 1
)

:: ── 启用 pnpm ──
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] 启用 pnpm...
    corepack enable
    corepack prepare pnpm@11.7.0 --activate
)

:: ── 安装依赖 ──
echo [1/4] 安装依赖...
cd /d "%~dp0.."
call pnpm install
if %errorlevel% neq 0 (
    echo [ERROR] 依赖安装失败
    pause && exit /b 1
)

:: ── 生成图标 ──
echo [2/4] 生成应用图标...
cd /d "%~dp0"
call node scripts/generate-icons.mjs
if %errorlevel% neq 0 (
    echo [WARN] 图标生成失败，继续打包...
)

:: ── 构建前端 ──
echo [3/4] 构建前端...
cd /d "%~dp0.."
call pnpm --filter ecopilot-frontend build
if %errorlevel% neq 0 (
    echo [ERROR] 前端构建失败
    pause && exit /b 1
)

:: ── 打包 Windows 安装包 ──
echo [4/4] 打包 Windows 安装包...
cd /d "%~dp0"
call npx electron-builder --win --x64
if %errorlevel% neq 0 (
    echo [ERROR] 打包失败
    pause && exit /b 1
)

echo.
echo ========================================
echo   打包完成
echo   安装包: desktop\electron-app\dist\
echo ========================================
echo.

pause
endlocal
