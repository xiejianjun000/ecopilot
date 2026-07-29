#!/bin/bash
# EcoSkill CLI 安装脚本 (生产地址: curl -fsSL https://ecoskill.cn/install.sh | bash)
# 目前使用本地版本，域上线后替换

set -e
ECOSKILL_DIR="$HOME/.ecoskill"
mkdir -p "$ECOSKILL_DIR"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/cli.py" "$ECOSKILL_DIR/ecoskill"
cp "$SCRIPT_DIR/skills.json" "$ECOSKILL_DIR/skills.json"
chmod +x "$ECOSKILL_DIR/ecoskill"

# 创建全局 alias
if ! grep -q "ecoskill" "$HOME/.zshrc" 2>/dev/null; then
    echo 'alias ecoskill="python3 $HOME/.ecoskill/ecoskill"' >> "$HOME/.zshrc"
fi

echo "✅ EcoSkill CLI 已安装到 $ECOSKILL_DIR/ecoskill"
echo "   使用: ecoskill search <关键词>"
echo "   安装技能: ecoskill install <id>"
