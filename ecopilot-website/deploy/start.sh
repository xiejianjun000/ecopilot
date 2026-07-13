#!/bin/bash
# EcoPilot 网站本地开发启动脚本
# 用法: ./start.sh [--api-only] [--no-api]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
API_ONLY=false
NO_API=false

for arg in "$@"; do
  case $arg in
    --api-only) API_ONLY=true ;;
    --no-api) NO_API=true ;;
  esac
done

echo "═════════════════════════════════"
echo "  EcoPilot 网站开发环境"
echo "═════════════════════════════════"
echo ""

# 检查 Python
if command -v python3 &> /dev/null; then
  echo "[OK] Python: $(python3 --version)"
else
  echo "[ERROR] Python3 未安装"
  exit 1
fi

# 检查 Node（可选）
if command -v node &> /dev/null; then
  echo "[OK] Node: $(node --version)"
else
  echo "[WARN] Node.js 未安装（部分功能可能受限）"
fi

# 检查依赖
if [ -f "$SCRIPT_DIR/requirements.txt" ]; then
  pip3 install -q -r "$SCRIPT_DIR/requirements.txt" 2>/dev/null && echo "[OK] Python 依赖已安装" || echo "[WARN] Python 依赖安装有警告"
fi

echo ""
echo "──────────────────────────────────"

# 启动 API 服务
if [ "$NO_API" = false ]; then
  echo ""
  echo "[1/4] 启动网站后端 API (:8090)..."
  cd "$SCRIPT_DIR"
  python3 website_api.py &
  API_PID=$!
  echo "  PID: $API_PID"
  sleep 1

  echo "[2/4] 启动认证服务 (:8091)..."
  python3 auth_service.py &
  AUTH_PID=$!
  echo "  PID: $AUTH_PID"
  sleep 1

  echo "[3/4] 启动订阅服务 (:8092)..."
  python3 subscription_service.py &
  SUB_PID=$!
  echo "  PID: $SUB_PID"
  sleep 1

  # 健康检查
  echo ""
  if curl -s http://localhost:8090/health > /dev/null 2>&1; then
    echo "  [OK] API 服务运行正常 (:8090)"
  else
    echo "  [WARN] API 服务启动中..."
  fi
  if curl -s http://localhost:8091/health > /dev/null 2>&1; then
    echo "  [OK] 认证服务运行正常 (:8091)"
  else
    echo "  [WARN] 认证服务启动中..."
  fi
  if curl -s http://localhost:8092/health > /dev/null 2>&1; then
    echo "  [OK] 订阅服务运行正常 (:8092)"
  else
    echo "  [WARN] 订阅服务启动中..."
  fi
fi

if [ "$API_ONLY" = false ]; then
  echo ""
  echo "[4/4] 启动静态文件服务..."
  cd "$PROJECT_DIR"
  
  # 使用 Python http.server 作为简单静态服务
  if [ "$NO_API" = false ]; then
    PORT=3000
  else
    PORT=8090
  fi
  
  echo "  地址: http://localhost:$PORT"
  echo "  目录: $PROJECT_DIR"
  
  if command -v npx &> /dev/null; then
    npx -y serve -l $PORT "$PROJECT_DIR" &
  else
    python3 -m http.server $PORT &
  fi
  SERVER_PID=$!
fi

echo ""
echo "═════════════════════════════════"
echo "  启动完成!"
if [ "$API_ONLY" = false ]; then
  echo "  静态服务: http://localhost:${PORT:-3000}"
fi
if [ "$NO_API" = false ]; then
  echo "  API 服务:   http://localhost:8090"
  echo "  认证服务:   http://localhost:8091"
  echo "  订阅服务:   http://localhost:8092"
fi
echo "  按 Ctrl+C 停止所有服务"
echo "═════════════════════════════════"

# 清理函数
cleanup() {
  echo ""
  echo "正在停止服务..."
  [ -n "$API_PID" ] && kill $API_PID 2>/dev/null
  [ -n "$AUTH_PID" ] && kill $AUTH_PID 2>/dev/null
  [ -n "$SUB_PID" ] && kill $SUB_PID 2>/dev/null
  [ -n "$SERVER_PID" ] && kill $SERVER_PID 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

wait
