# EcoPilot 生产部署 Dockerfile
# 基于 Hermes Agent AI 框架 + FastAPI 后端 + Next.js 前端
# 构建: docker build -f deploy/Dockerfile -t ecopilot:latest .

# ═══ Stage 1: 前端构建 ═══
FROM node:20-slim AS frontend-builder
WORKDIR /app
COPY desktop/frontend/package.json desktop/frontend/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod=false
COPY desktop/frontend/ ./
RUN pnpm build

# ═══ Stage 2: 后端 + 运行环境 ═══
FROM python:3.11-slim
LABEL org.opencontainers.image.title="EcoPilot"
LABEL org.opencontainers.image.description="企业生态环境合规AI管家"

# 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    chromium \
    && rm -rf /var/lib/apt/lists/*

# Python 依赖
WORKDIR /app
COPY desktop/server/requirements.txt /app/server/requirements-lock.txt* /app/server/
RUN pip install --no-cache-dir -r /app/server/requirements-lock.txt 2>/dev/null || \
    pip install --no-cache-dir -r /app/server/requirements.txt
RUN python -m playwright install --with-deps chromium

# 后端代码
COPY desktop/server/ /app/server/
COPY desktop/server/.env.example /app/server/.env.example

# 前端构建产物
COPY --from=frontend-builder /app/.next /app/frontend/.next
COPY --from=frontend-builder /app/public /app/frontend/public
COPY --from=frontend-builder /app/package.json /app/frontend/
COPY --from=frontend-builder /app/node_modules /app/frontend/node_modules

# 启动脚本
COPY deploy/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# 安全：非 root 运行
RUN useradd --create-home --shell /bin/bash ecopilot
RUN chown -R ecopilot:ecopilot /app
USER ecopilot

# 环境变量
ENV PYTHONUNBUFFERED=1
ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 8002 3000

ENTRYPOINT ["/app/entrypoint.sh"]
