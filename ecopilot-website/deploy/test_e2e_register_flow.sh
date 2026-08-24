#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# EcoPilot 端到端测试：注册 → 订阅 → 许可证 → 心跳 完整闭环
#
# 用法: bash test_e2e_register_flow.sh [--retry-test]
#   --retry-test  测试 subscription_service 不可达时的重试机制
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# ── 颜色 ────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

PASS="${GREEN}✓${NC}"
FAIL="${RED}✗${NC}"
WARN="${YELLOW}⚠${NC}"
INFO="${BLUE}→${NC}"

# ── 配置 ────────────────────────────────────────────
AUTH_URL="http://localhost:8091"
SUB_URL="http://localhost:8092"
POOL_URL="http://localhost:8095"
TEST_PREFIX="e2e_$(date +%s)"
TEST_EMAIL="${TEST_PREFIX}@ecopilot.test"
TEST_PHONE="1390000$(python3 -c 'import random; print(random.randint(1000,9999))')"
TEST_PASSWORD="EcoTest123"
DATA_DIR="$(dirname "$0")/data"
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  EcoPilot 端到端闭环测试                     ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${INFO} 测试邮箱: ${TEST_EMAIL}"
echo -e "${INFO} 测试手机: ${TEST_PHONE}"
echo ""

# ── 辅助函数 ────────────────────────────────────────

_ok()   { echo -e "  ${PASS} $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
_fail() { echo -e "  ${FAIL} $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
_warn() { echo -e "  ${WARN} $1"; WARN_COUNT=$((WARN_COUNT + 1)); }
_step() { echo ""; echo -e "${BLUE}─── $1 ───${NC}"; }

_json() {
    python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d, indent=2, ensure_ascii=False))" 2>/dev/null || echo "(非JSON输出)"
}

_check_status() {
    local code=$1 label=$2
    if [ "$code" -eq 200 ] || [ "$code" -eq 201 ]; then
        _ok "$label (HTTP $code)"
        return 0
    else
        _fail "$label (HTTP $code)"
        return 1
    fi
}

# ── 第1步：健康检查 ──────────────────────────────────
_step "第1步：服务健康检查"

for svc in "auth:8091:/api/auth/health" "subscription:8092:/api/subscription/health" "pool:8095:/api/pool/health"; do
    name="${svc%%:*}"
    rest="${svc#*:}"
    port="${rest%%:*}"
    path="${rest#*:}"
    endpoint="http://localhost:${port}${path}"
    code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "$endpoint" 2>/dev/null || echo "000")
    if [ "$code" = "200" ]; then
        _ok "${name}_service (:${port}) 健康"
    else
        _fail "${name}_service (:${port}) 不可达 (HTTP ${code})"
    fi
done

# ── 第2步：用户注册 ──────────────────────────────────
_step "第2步：用户注册"

REG_RESP=$(curl -s -w "\n%{http_code}" -X POST "${AUTH_URL}/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"company\":\"端到端测试企业\",\"name\":\"测试用户\",\"phone\":\"${TEST_PHONE}\",\"email\":\"${TEST_EMAIL}\",\"password\":\"${TEST_PASSWORD}\"}" 2>&1)

REG_CODE=$(echo "$REG_RESP" | tail -1)
REG_BODY=$(echo "$REG_RESP" | sed '$d')

if _check_status "$REG_CODE" "注册"; then
    USER_ID=$(echo "$REG_BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['user']['id'])" 2>/dev/null)
    _ok "用户ID: ${USER_ID}"
else
    echo "$REG_BODY" | _json
    echo -e "\n${RED}注册失败，终止测试${NC}"
    exit 1
fi

# ── 第3步：验证订阅自动创建 ─────────────────────────────
_step "第3步：验证订阅自动创建"

SUB_FILE="${DATA_DIR}/subscriptions.json"
if [ -f "$SUB_FILE" ]; then
    SUB_INFO=$(python3 -c "
import json
with open('${SUB_FILE}') as f:
    subs = json.load(f)
match = [s for s in subs if s.get('user_id') == '${USER_ID}']
if match:
    s = match[-1]
    print(f\"{s['plan']} | {s['status']} | {s.get('created_at','?')}\")
else:
    print('NOT_FOUND')
" 2>/dev/null)
    
    case "$SUB_INFO" in
        NOT_FOUND) _warn "订阅未在 subscriptions.json 中找到（可能需重试回调）" ;;
        *) _ok "订阅已创建: plan=${SUB_INFO}" ;;
    esac
else
    _warn "subscriptions.json 不存在"
fi

# ── 第4步：模拟客户端首次启动（指纹 → 签发许可证）─────────────
_step "第4步：模拟客户端首次启动"

# 4a. 生成机器指纹
FINGERPRINT=$(python3 -c "
import hashlib, uuid, platform
node = uuid.getnode()
# 检查是否是随机 MAC
if (node & 0x010000000000) == 0:
    mac = ':'.join(f'{(node>>(40-8*i))&0xff:02x}' for i in range(6))
else:
    mac = '02:00:00:00:00:00'  # 随机MAC fallback
raw = '|'.join([mac, platform.node(), platform.system(), platform.machine()])
print(hashlib.sha256(raw.encode()).hexdigest()[:32])
")
_ok "机器指纹: ${FINGERPRINT}"

# 4b. 轮询检查（应返回 has_new:false）
CHECK_RESP=$(curl -s "${POOL_URL}/api/pool/license/check?user_id=${USER_ID}")
HAS_NEW=$(echo "$CHECK_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['has_new'])" 2>/dev/null)

if [ "$HAS_NEW" = "False" ]; then
    _ok "轮询检查: has_new=false（无已有许可证，符合预期）"
else
    _warn "轮询检查: has_new=${HAS_NEW}（可能已有旧许可证）"
fi

# 4c. 签发许可证
ISSUE_RESP=$(curl -s -w "\n%{http_code}" -X POST "${POOL_URL}/api/pool/license/issue" \
    -H "Content-Type: application/json" \
    -d "{\"user_id\":\"${USER_ID}\",\"fingerprint\":\"${FINGERPRINT}\",\"tier\":\"pro_trial\",\"customer\":\"端到端测试企业\",\"expire_days\":15}" 2>&1)

ISSUE_CODE=$(echo "$ISSUE_RESP" | tail -1)
ISSUE_BODY=$(echo "$ISSUE_RESP" | sed '$d')

if _check_status "$ISSUE_CODE" "签发许可证"; then
    LICENSE_KEY=$(echo "$ISSUE_BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['license_key'][:50])" 2>/dev/null)
    _ok "许可证: ${LICENSE_KEY}..."
else
    _fail "签发失败"
    echo "$ISSUE_BODY" | _json
fi

# 4d. 再次轮询（应返回 has_new:true）
sleep 0.5
CHECK_RESP2=$(curl -s "${POOL_URL}/api/pool/license/check?user_id=${USER_ID}")
HAS_NEW2=$(echo "$CHECK_RESP2" | python3 -c "import json,sys; print(json.load(sys.stdin)['has_new'])" 2>/dev/null)

if [ "$HAS_NEW2" = "True" ]; then
    _ok "再次轮询: has_new=true（新许可证可被客户端获取）"
else
    _fail "再次轮询: has_new=${HAS_NEW2}（新许可证未被轮询到）"
fi

# ── 第5步：客户端心跳 ──────────────────────────────────
_step "第5步：客户端心跳"

HB_RESP=$(curl -s -w "\n%{http_code}" -X POST "${POOL_URL}/api/pool/usage/heartbeat" \
    -H "Content-Type: application/json" \
    -d "{\"user_id\":\"${USER_ID}\",\"timestamp\":\"\",\"version\":\"1.0.0\"}" 2>&1)

HB_CODE=$(echo "$HB_RESP" | tail -1)

if _check_status "$HB_CODE" "心跳上报"; then
    _ok "客户端在线状态已同步"
fi

# ── 第6步（可选）：重试机制测试 ──────────────────────────
_retry_test() {
    _step "第6步：重试机制测试（需手动停止 subscription_service）"
    
    echo -e "  ${WARN} 请在另一个终端执行: kill \$(lsof -ti:8092)"
    echo -n "  按 Enter 继续..."
    read -r
    
    RETRY_EMAIL="retry_$(date +%s)@ecopilot.test"
    RETRY_PHONE="1390000$(python3 -c 'import random; print(random.randint(1000,9999))')"
    
    echo ""
    echo -e "  ${INFO} 注册（subscription_service 不可达）..."
    curl -s -X POST "${AUTH_URL}/api/auth/register" \
        -H "Content-Type: application/json" \
        -d "{\"company\":\"重试测试\",\"name\":\"重试\",\"phone\":\"${RETRY_PHONE}\",\"email\":\"${RETRY_EMAIL}\",\"password\":\"${TEST_PASSWORD}\"}" | _json
    
    echo ""
    echo -e "  ${INFO} 查看 auth_service 日志确认重试记录:"
    echo -e "    应看到: ↻ 重试 2/3 ... ↻ 重试 3/3 ... ❌ 已重试所有3次"
}

# ── 结果汇总 ──────────────────────────────────────────
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  测试结果汇总                                ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}通过: ${PASS_COUNT}${NC}"
echo -e "  ${YELLOW}警告: ${WARN_COUNT}${NC}"  
echo -e "  ${RED}失败: ${FAIL_COUNT}${NC}"

if [ "${1:-}" = "--retry-test" ]; then
    _retry_test
fi

if [ "$FAIL_COUNT" -eq 0 ]; then
    echo ""
    echo -e "  ${GREEN}─────────────────────────────────────────${NC}"
    echo -e "  ${GREEN}  注册 → 订阅 → 许可证 → 心跳 闭环通过 ✓${NC}"
    echo -e "  ${GREEN}─────────────────────────────────────────${NC}"
    exit 0
else
    echo ""
    echo -e "  ${RED}存在 ${FAIL_COUNT} 个失败项，请检查${NC}"
    exit 1
fi
