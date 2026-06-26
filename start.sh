#!/bin/bash
# EcoPilot Desktop 一键启动脚本
# 用法: bash start.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "╔══════════════════════════════════════╗"
echo "║      EcoPilot 生态环境AI管家          ║"
echo "║      桌面端启动脚本                    ║"
echo "╚══════════════════════════════════════╝"
echo ""

# 检查 Node.js
if ! command -v node &>/dev/null; then
    echo "❌ 需要 Node.js >= 20"
    exit 1
fi
echo "✅ Node.js $(node --version)"

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install --registry=https://registry.npmmirror.com
fi

echo ""
echo "🌐 启动方式选择:"
echo "  1) 浏览器模式 (仅前端，http://localhost:5174)"
echo "  2) Electron 桌面模式 (需要 Electron)"
echo ""
read -rp "请选择 [1/2]: " mode

if [ "$mode" = "2" ]; then
    echo "🚀 启动 Electron 桌面端..."
    npm run dev
else
    echo "🚀 启动 Vite 开发服务器..."
    echo "   访问: http://localhost:5174"
    npx vite --host 127.0.0.1 --port 5174
fi
