#!/bin/bash
# ══════════════════════════════════════════════════════════════
# EcoPilot 网站部署脚本
# 用法:
#   ./deploy.sh                    # 部署（交互确认）
#   ./deploy.sh staging            # 部署到 staging
#   ./deploy.sh production         # 部署到 production
#   ./deploy.sh rollback           # 回滚到上一版本
# ══════════════════════════════════════════════════════════════

set -e

# ── 配置 ──
DOMAIN="ecopilot.example.com"
REMOTE_DIR="/var/www/ecopilot-website"
BACKUP_DIR="/var/www/ecopilot-website-backup"
REMOTE_HOST="your-server-ip"
SSL_CERT="/etc/nginx/ssl/ecopilot.crt"
SSL_KEY="/etc/nginx/ssl/ecopilot.key"

ENV=${1:-staging}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── 颜色 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

ok()   { echo -e "  ${GREEN}[OK]${NC} $1"; }
warn() { echo -e "  ${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "  ${RED}[ERROR]${NC} $1"; }
info() { echo -e "  ${CYAN}[INFO]${NC} $1"; }

# ── 回滚功能 ──
if [ "$ENV" = "rollback" ]; then
  echo -e "${YELLOW}═══════════════════════════════════════${NC}"
  echo -e "${YELLOW}  EcoPilot 网站回滚${NC}"
  echo -e "${YELLOW}═══════════════════════════════════════${NC}"
  echo ""

  if ssh ${REMOTE_HOST} "[ ! -d ${BACKUP_DIR} ]"; then
    err "备份目录 ${BACKUP_DIR} 不存在，无法回滚"
    exit 1
  fi

  echo -e "回滚将用 ${BACKUP_DIR} 的内容覆盖 ${REMOTE_DIR}"
  read -p "确认回滚? (y/N): " confirm
  if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    info "已取消回滚"
    exit 0
  fi

  echo ""
  info "执行回滚..."
  ssh ${REMOTE_HOST} "rsync -a --delete ${BACKUP_DIR}/ ${REMOTE_DIR}/"
  ssh ${REMOTE_HOST} "nginx -t && systemctl reload nginx && systemctl restart ecopilot-website"
  sleep 2

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}")
  if [ "$HTTP_CODE" = "200" ]; then
    ok "回滚成功! HTTPS ${HTTP_CODE}"
  else
    warn "回滚后状态异常, HTTP ${HTTP_CODE}"
  fi

  echo ""
  ok "回滚完成。访问: https://${DOMAIN}"
  exit 0
fi

# ── 主部署流程 ──
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${BLUE}  EcoPilot 网站部署${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo ""
info "环境: ${ENV}"
info "域名: ${DOMAIN}"
info "服务器: ${REMOTE_HOST}"
info "目录: ${REMOTE_DIR}"
echo ""

# 部署前确认
read -p "确认部署到 ${ENV} 环境? (y/N): " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  info "已取消部署"
  exit 0
fi

echo ""

# ── 预检查 ──
info "预检查..."

# 检查本地文件
if [ ! -f "$SCRIPT_DIR/nginx.conf" ]; then
  err "nginx.conf 不存在"
  exit 1
fi
ok "nginx.conf 存在"

if [ ! -f "$SCRIPT_DIR/website_api.py" ]; then
  err "website_api.py 不存在"
  exit 1
fi
ok "website_api.py 存在"

if [ ! -f "$SCRIPT_DIR/requirements.txt" ]; then
  warn "requirements.txt 不存在（跳过依赖安装）"
else
  ok "requirements.txt 存在"
fi

echo ""

# ── Step 1: 备份当前版本 ──
echo -e "${CYAN}[1/6]${NC} 备份当前版本..."
ssh ${REMOTE_HOST} "if [ -d ${REMOTE_DIR} ]; then rm -rf ${BACKUP_DIR} && cp -a ${REMOTE_DIR} ${BACKUP_DIR}; echo 'backup done'; else echo 'no existing deployment'; fi"
ok "备份完成 (${BACKUP_DIR})"

# ── Step 2: 同步文件 ──
echo -e "${CYAN}[2/6]${NC} 同步文件到服务器..."
rsync -avz --exclude='.design' \
    --exclude='.DS_Store' \
    --exclude='node_modules/' \
    --exclude='.git/' \
    "$SCRIPT_DIR/../" ${REMOTE_HOST}:${REMOTE_DIR}/
ok "文件同步完成"

# 同步 deploy 目录（API + 配置）
rsync -avz --exclude='.design' \
    --exclude='.DS_Store' \
    "$SCRIPT_DIR/" ${REMOTE_HOST}:${REMOTE_DIR}/deploy/
ok "deploy 目录同步完成"

# ── Step 3: SSL 证书检查 ──
echo -e "${CYAN}[3/6]${NC} SSL 证书检查..."
SSL_STATUS=$(ssh ${REMOTE_HOST} "
  if [ -f ${SSL_CERT} ] && [ -f ${SSL_KEY} ]; then
    EXPIRY=\$(openssl x509 -in ${SSL_CERT} -noout -enddate 2>/dev/null | cut -d= -f2)
    if [ -n \"\$EXPIRY\" ]; then
      echo \"valid:\$EXPIRY\"
    else
      echo 'invalid'
    fi
  else
    echo 'missing'
  fi
" 2>/dev/null)

case "$SSL_STATUS" in
  valid:*)
    EXPIRY_DATE="${SSL_STATUS#valid:}"
    ok "SSL 证书有效 (到期: ${EXPIRY_DATE})"
    ;;
  invalid)
    warn "SSL 证书文件存在但已损坏，请检查"
    ;;
  missing)
    warn "SSL 证书文件不存在 (${SSL_CERT})"
    warn "HTTPS 将无法工作，请先配置 SSL 证书"
    ;;
  *)
    warn "无法检查 SSL 证书状态"
    ;;
esac

# ── Step 4: 安装依赖 + 设置权限 ──
echo -e "${CYAN}[4/6]${NC} 安装依赖 + 设置权限..."
ssh ${REMOTE_HOST} "
  chown -R www-data:www-data ${REMOTE_DIR}
  chmod -R 755 ${REMOTE_DIR}
  mkdir -p ${REMOTE_DIR}/deploy/data
  chown www-data:www-data ${REMOTE_DIR}/deploy/data
  if [ -f ${REMOTE_DIR}/deploy/requirements.txt ]; then
    sudo -u www-data pip3 install -q -r ${REMOTE_DIR}/deploy/requirements.txt 2>/dev/null && echo 'deps_ok' || echo 'deps_warn'
  fi
" 2>/dev/null | while read line; do
  if [ "$line" = "deps_ok" ]; then ok "Python 依赖已安装"; fi
  if [ "$line" = "deps_warn" ]; then warn "Python 依赖安装有警告"; fi
done
ok "权限设置完成"

# ── Step 5: Nginx + API 服务 ──
echo -e "${CYAN}[5/6]${NC} 配置 Nginx + 重启服务..."

# 安装/更新 Nginx 配置
ssh ${REMOTE_HOST} "
  cp ${REMOTE_DIR}/deploy/nginx.conf /etc/nginx/sites-available/ecopilot
  ln -sf /etc/nginx/sites-available/ecopilot /etc/nginx/sites-enabled/ecopilot
  nginx -t 2>&1
" | while read line; do
  if echo "$line" | grep -q "test is successful"; then
    ok "Nginx 配置检查通过"
  elif echo "$line" | grep -q "error"; then
    err "Nginx 配置错误: $line"
    exit 1
  fi
done

# 安装/更新 systemd 服务
ssh ${REMOTE_HOST} "
  cp ${REMOTE_DIR}/deploy/ecopilot-website.service /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable ecopilot-website 2>/dev/null
  systemctl reload nginx
  systemctl restart ecopilot-website
"
ok "服务已重启"

# ── Step 6: 健康检查 ──
echo -e "${CYAN}[6/6]${NC} 健康检查..."
sleep 3

# API 健康
API_OK=false
if curl -s --connect-timeout 5 "http://${REMOTE_HOST}:8090/health" > /dev/null 2>&1; then
  ok "API 服务 (8090) 运行正常"
  API_OK=true
else
  warn "API 服务 (8090) 无响应"
fi

# HTTPS 页面
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 "https://${DOMAIN}" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  ok "网站 HTTPS ${HTTP_CODE}"
elif [ "$HTTP_CODE" = "301" ] || [ "$HTTP_CODE" = "302" ]; then
  ok "HTTPS 重定向 ${HTTP_CODE}"
else
  warn "HTTPS 响应 ${HTTP_CODE}（如未配 SSL 可忽略）"
fi

# Gzip 检查
if curl -sI -H "Accept-Encoding: gzip" "https://${DOMAIN}" 2>/dev/null | grep -q "Content-Encoding: gzip"; then
  ok "Gzip 压缩已启用"
else
  warn "Gzip 压缩未检测到"
fi

# .design 文件禁止访问
DESIGN_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}/pages/test.design" 2>/dev/null || echo "000")
if [ "$DESIGN_CODE" = "404" ] || [ "$DESIGN_CODE" = "403" ]; then
  ok ".design 文件已禁止访问 (${DESIGN_CODE})"
else
  warn ".design 文件可能仍可访问 (${DESIGN_CODE})"
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}  部署完成!${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo ""
echo -e "  网站: ${CYAN}https://${DOMAIN}${NC}"
echo -e "  API:  ${CYAN}http://${REMOTE_HOST}:8090${NC}"
echo -e "  环境: ${CYAN}${ENV}${NC}"
echo ""
if [ "$API_OK" = false ]; then
  warn "API 服务未响应，请检查: ssh ${REMOTE_HOST} 'systemctl status ecopilot-website'"
fi
echo -e "  回滚: ${CYAN}./deploy.sh rollback${NC}"
echo ""
