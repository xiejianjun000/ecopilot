#!/bin/bash
# EcoPilot 网站一键安装脚本
# 用法: curl -sL https://ecopilot.example.com/setup.sh | bash

set -e

echo "╔═══════════════════════════════════════╗"
echo "║  EcoPilot 网站一键安装                ║"
echo "╚═══════════════════════════════════════╝"

# 1. 系统更新
apt-get update && apt-get upgrade -y

# 2. 安装依赖
apt-get install -y python3 python3-pip nginx curl git

# 3. Python依赖
pip3 install fastapi uvicorn[standard] pydantic PyJWT bcrypt email-validator python-multipart

# 4. 创建目录
mkdir -p /var/www/ecopilot-website
mkdir -p /etc/ecopilot

# 5. 复制配置
cp nginx.conf /etc/nginx/sites-available/ecopilot
ln -sf /etc/nginx/sites-available/ecopilot /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# 6. 创建 systemd 服务
cp ecopilot-website.service /etc/systemd/system/
systemctl daemon-reload

# 7. 防火墙
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# 8. 设置权限
chown -R www-data:www-data /var/www/ecopilot-website

echo ""
echo "安装完成！"
echo "下一步："
echo "  1. 上传网站文件到 /var/www/ecopilot-website/"
echo "  2. 配置 .env 文件"
echo "  3. 启动服务: systemctl start ecopilot-website"
echo "  4. 配置SSL: certbot --nginx -d your-domain.com"
