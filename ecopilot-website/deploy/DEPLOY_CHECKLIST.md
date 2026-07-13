# EcoPilot 网站部署检查清单

> 部署前逐项确认，确保生产环境稳定运行。

---

## 1. 服务器环境要求

| 项目 | 最低要求 | 推荐配置 |
|------|---------|---------|
| 操作系统 | Ubuntu 20.04 LTS | Ubuntu 22.04 LTS |
| CPU | 1 核 | 2 核 |
| 内存 | 2 GB | 4 GB |
| 磁盘 | 20 GB | 50 GB SSD |
| Python | 3.11+ | 3.11+ |
| Nginx | 1.18+ | 1.24+ |
| pip | 最新版 | 最新版 |

**检查命令：**

```bash
python3 --version          # Python 3.11.x
nginx -v                   # nginx version: nginx/1.x.x
pip3 --version             # pip 2x.x
systemctl --version        # systemd 支持
```

---

## 2. 域名和 SSL 证书

### 2.1 域名配置

- [ ] 域名 DNS A 记录指向服务器公网 IP
- [ ] 域名已备案（国内服务器需要）
- [ ] 确认 DNS 生效：`dig +short ecopilot.example.com`

### 2.2 SSL 证书

- [ ] SSL 证书文件已放置：`/etc/nginx/ssl/ecopilot.crt`
- [ ] SSL 私钥文件已放置：`/etc/nginx/ssl/ecopilot.key`
- [ ] 文件权限正确：`chmod 600 /etc/nginx/ssl/ecopilot.key`
- [ ] 证书有效期检查：

```bash
openssl x509 -in /etc/nginx/ssl/ecopilot.crt -noout -dates
```

- [ ] 如使用 Let's Encrypt，设置自动续期：

```bash
certbot certonly --nginx -d ecopilot.example.com
systemctl enable certbot.timer
```

---

## 3. 文件上传

- [ ] 创建目标目录：`sudo mkdir -p /var/www/ecopilot-website`
- [ ] 上传网站文件（排除 `.design` 和 `deploy/` 目录）：

```bash
rsync -avz --exclude='.design' --exclude='deploy/' --exclude='.DS_Store' \
    ./ user@server:/var/www/ecopilot-website/
```

- [ ] 上传 API 文件到 deploy 目录：

```bash
rsync -avz deploy/ user@server:/var/www/ecopilot-website/deploy/
```

- [ ] 设置文件权限：

```bash
sudo chown -R www-data:www-data /var/www/ecopilot-website
sudo chmod -R 755 /var/www/ecopilot-website
sudo chmod 600 /var/www/ecopilot-website/deploy/data/
```

---

## 4. Nginx 配置

- [ ] 复制配置文件：

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/ecopilot
sudo ln -sf /etc/nginx/sites-available/ecopilot /etc/nginx/sites-enabled/
```

- [ ] 删除默认站点（可选）：`sudo rm /etc/nginx/sites-enabled/default`
- [ ] 检查配置语法：

```bash
sudo nginx -t
# 期望输出: syntax is ok, test is successful
```

- [ ] 重载 Nginx：

```bash
sudo systemctl reload nginx
```

- [ ] 确认 Nginx 运行：

```bash
sudo systemctl status nginx
```

---

## 5. API 服务配置（systemd）

- [ ] 安装 Python 依赖：

```bash
cd /var/www/ecopilot-website/deploy
sudo -u www-data pip3 install -r requirements.txt
```

- [ ] 创建 data 目录：

```bash
sudo mkdir -p /var/www/ecopilot-website/deploy/data
sudo chown www-data:www-data /var/www/ecopilot-website/deploy/data
```

- [ ] 安装 systemd 服务：

```bash
sudo cp deploy/ecopilot-website.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ecopilot-website
sudo systemctl start ecopilot-website
```

- [ ] 确认 API 服务运行：

```bash
sudo systemctl status ecopilot-website
curl http://localhost:8090/health
# 期望: {"status":"ok","service":"ecopilot-website-api","version":"1.0.0"}
```

---

## 6. 防火墙配置

- [ ] 开放必要端口：

```bash
sudo ufw allow 80/tcp     # HTTP
sudo ufw allow 443/tcp    # HTTPS
sudo ufw allow 8002/tcp  # 主应用 API（如需）
sudo ufw allow 8090/tcp  # 网站 API（仅内网访问时可不开放）
```

- [ ] 确认防火墙状态：

```bash
sudo ufw status
```

- [ ] 如 8090 仅内网使用，添加 Nginx 层限制：

```nginx
# 在 nginx.conf 的 /contact location 中
allow 127.0.0.1;
deny all;
```

---

## 7. 部署后验证清单

### 7.1 页面访问

- [ ] 首页加载正常：`curl -s -o /dev/null -w "%{http_code}" https://ecopilot.example.com` 返回 200
- [ ] HTTP 自动跳转 HTTPS（301）
- [ ] 所有子页面可访问（/pages/xxx.html）
- [ ] 图片/CSS/JS 资源正常加载（F12 Network 无 404）

### 7.2 API 验证

- [ ] 健康检查：`curl https://ecopilot.example.com/api/health` 返回 200
- [ ] 联系表单 POST 测试（使用 Postman 或 curl）
- [ ] 访客统计 GET 测试

### 7.3 HTTPS 验证

- [ ] SSL 证书有效（浏览器无警告）
- [ ] TLS 版本 >= 1.2
- [ ] HSTS 头已设置

### 7.4 性能验证

- [ ] Gzip 压缩已启用：`curl -sI -H "Accept-Encoding: gzip" https://ecopilot.example.com | grep Content-Encoding`
- [ ] 静态资源缓存头正确（Cache-Control: public, immutable）
- [ ] HTML 页面无缓存（Cache-Control: no-cache）
- [ ] 首页加载时间 < 3 秒

### 7.5 安全验证

- [ ] `.design` 文件返回 404
- [ ] 安全头已设置（X-Frame-Options, X-Content-Type-Options, X-XSS-Protection）
- [ ] 目录列表已禁用（访问 /assets/ 不展示文件列表）

---

## 8. 常见问题排查

### API 服务无法启动

```bash
# 查看日志
sudo journalctl -u ecopilot-website -f --no-pager

# 常见原因：
# 1. Python 依赖缺失 → pip3 install -r requirements.txt
# 2. 端口 8090 被占用 → ss -tlnp | grep 8090
# 3. data 目录权限 → chown www-data:www-data data/
```

### Nginx 502 Bad Gateway

```bash
# 确认后端服务运行
sudo systemctl status ecopilot-website
curl http://localhost:8090/health

# 检查 Nginx 代理配置
sudo nginx -t
```

### SSL 证书问题

```bash
# 检查证书有效期
openssl x509 -in /etc/nginx/ssl/ecopilot.crt -noout -dates

# 检查证书链
openssl s_client -connect ecopilot.example.com:443 -servername ecopilot.example.com </dev/null
```

### 静态资源 404

```bash
# 确认文件存在
ls -la /var/www/ecopilot-website/pages/
ls -la /var/www/ecopilot-website/assets/

# 确认 Nginx root 配置指向正确目录
grep "root" /etc/nginx/sites-enabled/ecopilot
```

### 回滚操作

```bash
# 使用 deploy.sh 回滚到上一版本
./deploy.sh rollback

# 手动回滚：从备份恢复
sudo cp -r /var/www/ecopilot-website-backup/* /var/www/ecopilot-website/
sudo systemctl reload nginx
```

---

## 部署记录模板

| 项目 | 值 |
|------|-----|
| 部署日期 | __________ |
| 服务器 IP | __________ |
| 域名 | __________ |
| 部署人 | __________ |
| 环境 | staging / production |
| Nginx 版本 | __________ |
| Python 版本 | __________ |
| SSL 到期日 | __________ |
| 备注 | __________ |
