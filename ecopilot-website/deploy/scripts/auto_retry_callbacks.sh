#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# EcoPilot 自动补偿脚本 — 通过 cron / systemd timer 周期执行
#
# 部署: 复制到 /opt/ecopilot/scripts/auto_retry_callbacks.sh
# cron: */1 * * * * /opt/ecopilot/scripts/auto_retry_callbacks.sh >> /var/log/ecopilot/callback-retry.log 2>&1
# systemd: 见 monitoring/ecopilot-callback-retry.timer (推荐)
#
# 特性:
#   - 带锁防并发 (flock)
#   - 无待处理记录时静默退出（0字节日志）
#   - 重试成功后通过 webhook 通知
#   - 失败超过阈值时升级告警
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

DEPLOY_DIR="/opt/ecopilot/deploy"
SCRIPT_DIR="${DEPLOY_DIR}/scripts"
DATA_DIR="${DEPLOY_DIR}/data"
LOCK_FILE="/var/run/ecopilot/callback-retry.lock"
COMPENSATION_LOG="/var/log/ecopilot/callback-compensation.log"
DINGTALK_HOOK="${DINGTALK_WEBHOOK:-}"           # 设置环境变量启用钉钉通知
WECOM_HOOK="${WECOM_WEBHOOK:-}"                # 设置环境变量启启用企微通知
FAILURE_THRESHOLD=3                             # 连续失败 N 次触发二次告警

mkdir -p "$(dirname "$LOCK_FILE")" "$(dirname "$COMPENSATION_LOG")"

# ── 防并发 ────────────────────────────────────────────
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    # 前一次还在运行，跳过（避免堆积）
    exit 0
fi

# ── 检查是否有待处理记录 ──────────────────────────────
PENDING_FILE="${DATA_DIR}/failed_callbacks.jsonl"
if [ ! -f "$PENDING_FILE" ]; then
    exit 0  # 静默退出
fi

PENDING_COUNT=$(python3 -c "
import json
with open('${PENDING_FILE}') as f:
    count = sum(1 for line in f if line.strip() and not json.loads(line).get('resolved', False))
print(count)
" 2>/dev/null || echo "0")

if [ "$PENDING_COUNT" -eq 0 ]; then
    exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 自动补偿启动 | pending=${PENDING_COUNT} 条"

# ── 执行补偿 ──────────────────────────────────────────
cd "$DEPLOY_DIR"

RESULT=$(python3 "${SCRIPT_DIR}/retry_failed_callbacks.py" 2>&1)
RETCODE=$?

echo "$RESULT" >> "$COMPENSATION_LOG"

# ── 解析结果 ──────────────────────────────────────────
RESOLVED=$(echo "$RESULT" | grep -oP '解决:\s*\K\d+' || echo "0")
FAILED=$(echo "$RESULT" | grep -oP '失败:\s*\K\d+' || echo "0")

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 补偿完成 | resolved=${RESOLVED} failed=${FAILED}"

# ── 通知逻辑 ──────────────────────────────────────────

# 成功恢复 → 推送恢复通知
if [ "$RESOLVED" -gt 0 ] && [ "$FAILED" -eq 0 ]; then
    MSG="ecopilot-callback 自动补偿完成 | 恢复 ${RESOLVED} 条订阅, pending=0"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ ${MSG}"

    if [ -n "$DINGTALK_HOOK" ]; then
        curl -sf -X POST "$DINGTALK_HOOK" \
            -H "Content-Type: application/json" \
            -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"[EcoPilot] ✓ ${MSG}\"}}" \
            > /dev/null 2>&1 || true
    fi
fi

# 仍有失败 → 升级告警
if [ "$FAILED" -gt 0 ]; then
    # 记录连续失败计数
    FAIL_COUNT_FILE="/var/run/ecopilot/callback-fail-count"
    PREV_COUNT=$(cat "$FAIL_COUNT_FILE" 2>/dev/null || echo "0")
    NEW_COUNT=$((PREV_COUNT + 1))
    echo "$NEW_COUNT" > "$FAIL_COUNT_FILE"

    if [ "$NEW_COUNT" -ge "$FAILURE_THRESHOLD" ]; then
        MSG="ecopilot-callback 自动补偿连续失败 ${NEW_COUNT} 次 | 仍 ${FAILED} 条未恢复 | 需人工介入"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🚨 ${MSG}"

        # 钉钉告警
        if [ -n "$DINGTALK_HOOK" ]; then
            curl -sf -X POST "$DINGTALK_HOOK" \
                -H "Content-Type: application/json" \
                -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"[EcoPilot] 🚨 ${MSG}\"}}" \
                > /dev/null 2>&1 || true
        fi
    fi
else
    # 恢复成功，清零计数
    rm -f /var/run/ecopilot/callback-fail-count
fi

exit 0
