#!/bin/bash
# EcoPilot 生产入口 — 并行启动后端 + 前端
set -e

echo "╔═══════════════════════════════════════════╗"
echo "║  EcoPilot — 企业生态环境合规AI管家       ║"
echo "╚═══════════════════════════════════════════╝"

# 检查必需环境变量
if [ -z "$DEEPSEEK_API_KEY" ] || [ -z "$KIMI_API_KEY" ]; then
    echo "⚠️  警告: DEEPSEEK_API_KEY 或 KIMI_API_KEY 未设置"
    echo "   请配置 ~/.ecopilot-home/.env 或通过环境变量传入"
fi

# 启动 FastAPI 后端
echo "[EcoPilot] 启动后端 (port 8002)..."
cd /app/server
python3 chat_api.py --port 8002 --host 0.0.0.0 &
BACKEND_PID=$!

# 等待后端就绪
echo "[EcoPilot] 等待后端就绪..."
for i in $(seq 1 30); do
    if curl -s http://127.0.0.1:8002/api/chat/health > /dev/null 2>&1; then
        echo "[EcoPilot] 后端就绪 (${i}s)"
        break
    fi
    sleep 1
done

# 启动 Next.js 前端
echo "[EcoPilot] 启动前端 (port 3000)..."
cd /app/frontend
node_modules/.bin/next start -p 3000 &
FRONTEND_PID=$!

echo "[EcoPilot] 服务已启动 — http://localhost:3000"

# 优雅退出
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" SIGTERM SIGINT
wait
