#!/usr/bin/env bash
# EcoPilot 一键启动脚本
# 自动安装依赖、启动后端+前端、打开浏览器

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 解析参数
MODE=""
CHROME=""
for arg in "$@"; do
  case $arg in
    --dev|-d) MODE="--dev" ;;
    --chrome) CHROME="--browser chrome" ;;
    --edge) CHROME="--browser edge" ;;
  esac
done

echo "🚀 EcoPilot 启动中..."
node main.js $MODE $CHROME
