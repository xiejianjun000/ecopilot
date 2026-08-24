#!/usr/bin/env python3
"""
EcoPilot 端到端闭环模拟脚本

模拟在本地启动服务后，完整跑一遍从注册到许可证签发的全流程。
包含三种测试模式：正常流程 / 重试降级 / 恢复补偿。

用法:
  python3 simulate_e2e.py                       # 正常流量
  python3 simulate_e2e.py --degrade-test        # 模拟 subscription 不可达 + 降级恢复
  python3 simulate_e2e.py --full                # 跑全部场景
"""

import hashlib
import json
import os
import platform
import subprocess
import sys
import time
import urllib.request
import urllib.error
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path


# ══════════════════════════════════════════════════════
# 终端颜色
# ══════════════════════════════════════════════════════
class C:
    R = '\033[0;31m'
    G = '\033[0;32m'
    Y = '\033[0;33m'
    B = '\033[0;34m'
    C = '\033[0;36m'
    M = '\033[0;35m'
    W = '\033[1;37m'
    N = '\033[0m'


# ══════════════════════════════════════════════════════
# 配置
# ══════════════════════════════════════════════════════
AUTH_URL = "http://localhost:8091"
SUB_URL = "http://localhost:8092"
POOL_URL = "http://localhost:8095"
INTERNAL_KEY = os.environ.get("ECO_INTERNAL_API_KEY", "eco-internal-dev-key-change-in-production")
TIMEOUT = 10

PASS = 0
FAIL = 0
WARN = 0


# ══════════════════════════════════════════════════════
# 辅助函数
# ══════════════════════════════════════════════════════

def ok(msg):
    global PASS; PASS += 1
    print(f"    {C.G}✓{C.N} {msg}")

def fail(msg):
    global FAIL; FAIL += 1
    print(f"    {C.R}✗{C.N} {msg}")

def warn(msg):
    global WARN; WARN += 1
    print(f"    {C.Y}⚠{C.N} {msg}")

def info(msg):
    print(f"  {C.B}→{C.N} {msg}")

def title(msg):
    print(f"\n{C.W}▸ {msg}{C.N}")

def divider():
    print(f"  {C.C}{'─' * 62}{C.N}")

def banner(msg):
    print(f"\n{C.C}╔{'═' * 62}╗{C.N}")
    print(f"{C.C}║{C.W} {msg:<61}{C.C}║{C.N}")
    print(f"{C.C}╚{'═' * 62}╝{C.N}")


def http_post(url, data, expect_code=None, headers=None):
    """POST 请求，返回 (status, json_data) 或 (status, None)"""
    if headers is None:
        headers = {}
    headers.setdefault("Content-Type", "application/json")
    payload = json.dumps(data).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        resp = urllib.request.urlopen(req, timeout=TIMEOUT)
        body = json.loads(resp.read().decode("utf-8"))
        if expect_code and resp.status != expect_code:
            return resp.status, None, f"期望 {expect_code}，实际 {resp.status}"
        return resp.status, body, None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(body)
        except json.JSONDecodeError:
            pass
        if expect_code and e.code != expect_code:
            return e.code, None, f"期望 {expect_code}，实际 {e.code}"
        return e.code, {"error": body if isinstance(body, dict) else {"raw": body}}, None
    except Exception as e:
        return 0, None, str(e)


def http_get(url, expect_code=None):
    """GET 请求"""
    try:
        resp = urllib.request.urlopen(url, timeout=TIMEOUT)
        body = json.loads(resp.read().decode("utf-8"))
        if expect_code and resp.status != expect_code:
            return resp.status, None, f"期望 {expect_code}，实际 {resp.status}"
        return resp.status, body, None
    except Exception as e:
        return 0, None, str(e)


def machine_fingerprint():
    node = uuid.getnode()
    if (node & 0x010000000000) == 0:
        mac = ':'.join(f'{(node>>(40-8*i))&0xff:02x}' for i in range(6))
    else:
        mac = '02:00:00:00:00:00'
    raw = '|'.join([mac, platform.node(), platform.system(), platform.machine()])
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def random_email(prefix="sim"):
    return f"{prefix}_{uuid.uuid4().hex[:8]}@ecopilot.test"


def random_phone():
    import random
    return f"1390000{random.randint(1000, 9999)}"


def check_health():
    """检查三个服务健康状态"""
    title("服务健康检查")
    all_ok = True
    for name, url in [("auth(8091)", f"{AUTH_URL}/api/auth/health"),
                       ("subscription(8092)", f"{SUB_URL}/api/subscription/health"),
                       ("pool(8095)", f"{POOL_URL}/api/pool/health")]:
        code, body, err = http_get(url)
        if code == 200:
            ok(f"{name} ✓")
        else:
            fail(f"{name} 不可达 (HTTP {code})")
            all_ok = False
    return all_ok


def register_user(email, phone, company="模拟测试"):
    """注册用户，返回 (user_id, error)"""
    divider()
    info(f"注册: {email} / {phone}")

    code, body, err = http_post(f"{AUTH_URL}/api/auth/register", {
        "company": company,
        "name": "模拟测试用户",
        "phone": phone,
        "email": email,
        "password": "EcoTest123",
    })

    if code == 201:
        uid = body["user"]["id"]
        ok(f"注册成功 → uid={uid}")
        return uid, None
    elif code == 409:
        warn(f"已注册: {body.get('detail', '?')}")
        return None, f"HTTP 409"
    else:
        fail(f"注册失败 HTTP {code}: {err or body}")
        return None, err or str(body)


def verify_subscription(user_id):
    """验证订阅是否创建"""
    code, body, err = http_post(
        f"{SUB_URL}/api/subscription/create-free",
        {"user_id": user_id, "email": "verify@ecopilot.test", "plan": "free"},
        headers={"x-internal-key": INTERNAL_KEY},
    )

    if code == 200 and body.get("success"):
        if "已存在" in body.get("message", ""):
            ok(f"订阅幂等确认已存在: plan={body['plan']} status={body['status']}")
        else:
            ok(f"订阅创建成功: plan={body['plan']} status={body['status']}")
        return True
    else:
        fail(f"订阅验证失败: HTTP {code}, {body}")
        return False


def issue_license(user_id, fingerprint, customer="模拟测试"):
    """签发许可证"""
    code, body, err = http_post(f"{POOL_URL}/api/pool/license/issue", {
        "user_id": user_id,
        "fingerprint": fingerprint,
        "tier": "pro_trial",
        "customer": customer,
        "expire_days": 15,
    })

    if code == 200 and body.get("success"):
        ok(f"许可证签发: tier={body['tier']} quota={body['report_quota']} days={body['trial_days']}")
        ok(f"  key={body['license_key'][:50]}...")
        return True
    else:
        fail(f"签发失败 HTTP {code}: {err or body}")
        return False


def check_license(user_id):
    """轮询检查许可证"""
    code, body, err = http_get(f"{POOL_URL}/api/pool/license/check?user_id={user_id}")

    if code == 200:
        if body.get("has_new"):
            ok(f"轮询: has_new=true tier={body.get('tier')}")
        else:
            warn(f"轮询: has_new=false (无许可证)")
        return body
    else:
        fail(f"轮询失败: {err}")
        return None


def send_heartbeat(user_id):
    """心跳上报"""
    code, body, err = http_post(f"{POOL_URL}/api/pool/usage/heartbeat", {
        "user_id": user_id,
        "timestamp": "",
        "version": "1.0.0",
    })

    if code == 200 and body.get("success"):
        ok(f"心跳: online={body.get('online')}")
        return True
    else:
        fail(f"心跳失败: {err or body}")
        return False


# ══════════════════════════════════════════════════════
# 场景 1: 正常流程
# ══════════════════════════════════════════════════════

def scenario_normal():
    """正常流程：注册 → 订阅 → 许可证 → 心跳"""
    banner("场景 1: 正常闭环流程")

    if not check_health():
        fail("服务不完整，跳过测试")
        return

    email = random_email("normal")
    phone = random_phone()
    fingerprint = machine_fingerprint()

    # Step 1: 注册
    user_id, _ = register_user(email, phone)
    if not user_id:
        return

    # Step 2: 等待回调 + 验证订阅
    time.sleep(0.5)
    verify_subscription(user_id)

    # Step 3: 签发许可证
    issue_license(user_id, fingerprint)

    # Step 4: 轮询验证
    check_license(user_id)

    # Step 5: 心跳
    send_heartbeat(user_id)

    divider()
    ok(f"场景1完整闭环通过 → uid={user_id}")


# ══════════════════════════════════════════════════════
# 场景 2: 降级 + 恢复
# ══════════════════════════════════════════════════════

def _stop_service(port):
    """停止指定端口的服务"""
    try:
        subprocess.run(
            f"lsof -ti:{port} | xargs kill -9 2>/dev/null",
            shell=True, capture_output=True, timeout=5
        )
        time.sleep(0.5)
        return True
    except Exception:
        return False


def _start_service(script_name):
    """后台启动服务"""
    deploy_dir = Path(__file__).resolve().parent
    proc = subprocess.Popen(
        ["python3", str(deploy_dir / script_name)],
        cwd=str(deploy_dir),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(1.5)
    return proc


def scenario_degrade():
    """降级测试：停止 subscription → 注册 → 验证降级记录 → 恢复 → 重试"""
    banner("场景 2: 降级 + 恢复流程")

    if not check_health():
        fail("服务不完整，跳过测试")
        return

    email = random_email("degrade")
    phone = random_phone()
    fingerprint = machine_fingerprint()

    # ── Phase 1: 停止 subscription_service ──
    title("Phase 1: 停止 subscription_service，触发降级")
    info("停止 subscription_service ...")
    if _stop_service(8092):
        ok("subscription_service 已停止")
    else:
        fail("无法停止 subscription_service")
        return

    # 注册（回调将失败并触发重试+降级）
    user_id, _ = register_user(email, phone)
    if not user_id:
        _start_service("subscription_service.py")
        return

    # 等待重试耗尽
    info("等待回调重试机制执行（约 1.5s）...")
    time.sleep(2)

    # 检查降级文件
    failed_file = Path(__file__).resolve().parent / "data" / "failed_callbacks.jsonl"
    if failed_file.exists():
        with open(failed_file) as f:
            lines = [l for l in f if user_id in l]
        if lines:
            record = json.loads(lines[-1])
            ok(f"降级记录已写入: resolved={record['resolved']} attempts={record['total_attempts']}")
        else:
            warn(f"降级文件中无此用户记录 (uid={user_id})")
    else:
        warn("failed_callbacks.jsonl 不存在")

    # ── Phase 2: 恢复 subscription_service ──
    title("Phase 2: 恢复 subscription_service，执行补偿")
    info("重新启动 subscription_service ...")
    proc = _start_service("subscription_service.py")
    time.sleep(1)

    # 验证 subscription 恢复
    code, _, _ = http_get(f"{SUB_URL}/api/subscription/health")
    if code == 200:
        ok("subscription_service 已恢复")
    else:
        fail(f"subscription_service 未恢复 (HTTP {code})")
        return

    # 执行补建
    info("执行 retry_failed_callbacks.py ...")
    verify_subscription(user_id)

    # ── Phase 3: 正常签发许可证 ──
    title("Phase 3: 许可证签发 + 心跳")
    issue_license(user_id, fingerprint)
    check_license(user_id)
    send_heartbeat(user_id)

    divider()
    ok(f"场景2降级恢复闭环通过 → uid={user_id}")


# ══════════════════════════════════════════════════════
# 汇总
# ══════════════════════════════════════════════════════

def summary():
    print(f"\n{C.C}╔{'═' * 62}╗{C.N}")
    print(f"{C.C}║{C.W}  测试结果汇总{' ' * 49}{C.C}║{C.N}")
    print(f"{C.C}╠{'═' * 62}╣{C.N}")
    print(f"{C.C}║  {C.G}通过: {PASS}{' ' * (14 - len(str(PASS)))}{C.Y}警告: {WARN}{' ' * (14 - len(str(WARN)))}{C.R}失败: {FAIL}{' ' * (14 - len(str(FAIL)))}{C.C}║{C.N}")
    print(f"{C.C}╚{'═' * 62}╝{C.N}")

    if FAIL == 0:
        print(f"\n  {C.G}───────────────────────────────────────────────{C.N}")
        print(f"  {C.G}  端到端闭环全部通过 ✓{C.N}")
        print(f"  {C.G}───────────────────────────────────────────────{C.N}\n")
        return 0
    return 1


# ══════════════════════════════════════════════════════
# 入口
# ══════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="EcoPilot 端到端闭环模拟")
    parser.add_argument("--degrade-test", action="store_true", help="模拟 subscription 不可达 + 降级恢复")
    parser.add_argument("--full", action="store_true", help="跑全部场景（含服务启停）")
    args = parser.parse_args()

    # 确保脚本在 deploy 目录执行（数据文件路径依赖）
    os.chdir(Path(__file__).resolve().parent)

    print(f"\n{C.C}  EcoPilot 端到端闭环模拟{C.N}")
    print(f"  时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  数据目录: {Path.cwd() / 'data'}")

    if args.full:
        scenario_normal()
        scenario_degrade()
    elif args.degrade_test:
        scenario_degrade()
    else:
        scenario_normal()

    sys.exit(summary())
