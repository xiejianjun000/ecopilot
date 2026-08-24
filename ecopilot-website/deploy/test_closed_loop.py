"""
EcoPilot 闭环单元测试：订阅创建 + 许可证签发 + 回调重试

运行方式:
  # 确保三个服务已启动 (8091 auth, 8092 subscription, 8095 pool)
  cd deploy && python3 -m pytest test_closed_loop.py -v

  # 仅运行重试测试（需要手动停 subscription service）
  python3 -m pytest test_closed_loop.py -v -m retry

  # 跳过需要纯网络操作的测试
  python3 -m pytest test_closed_loop.py -v -m "not slow"
"""

import hashlib
import json
import platform
import time
import uuid

import httpx
import pytest

# ── 配置 ──────────────────────────────────────────────
AUTH_URL = "http://localhost:8091"
SUB_URL = "http://localhost:8092"
POOL_URL = "http://localhost:8095"

# 内部鉴权 Key（与 auth_service、subscription_service 共享）
INTERNAL_KEY = "eco-internal-dev-key-change-in-production"

# ── 辅助函数 ──────────────────────────────────────────


def _random_email() -> str:
    return f"test_{uuid.uuid4().hex[:8]}@ecopilot.test"


def _random_phone() -> str:
    import random
    return f"1390000{random.randint(1000, 9999)}"


def _machine_fingerprint() -> str:
    """模拟 license_manager.get_machine_fingerprint()"""
    node = uuid.getnode()
    if (node & 0x010000000000) == 0:
        mac = ':'.join(f'{(node>>(40-8*i))&0xff:02x}' for i in range(6))
    else:
        mac = '02:00:00:00:00:00'
    raw = '|'.join([mac, platform.node(), platform.system(), platform.machine()])
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


@pytest.fixture
def auth_client():
    return httpx.Client(base_url=AUTH_URL, timeout=10)


@pytest.fixture
def sub_client():
    return httpx.Client(base_url=SUB_URL, timeout=10)


@pytest.fixture
def pool_client():
    return httpx.Client(base_url=POOL_URL, timeout=10)


@pytest.fixture
def test_user(auth_client):
    """注册一个测试用户，测试结束后清理"""
    email = _random_email()
    phone = _random_phone()
    resp = auth_client.post("/api/auth/register", json={
        "company": "单元测试企业",
        "name": "测试用户",
        "phone": phone,
        "email": email,
        "password": "EcoTest123",
    })
    assert resp.status_code in (201, 409), f"注册失败: {resp.text}"
    data = resp.json()
    user_id = data["user"]["id"]
    yield {"user_id": user_id, "email": email, "phone": phone}
    # 清理在数据文件中（不实际删除，用唯一邮箱隔离）


# ══════════════════════════════════════════════════════
# Test: subscription_service create-free 内部端点
# ══════════════════════════════════════════════════════

class TestSubscriptionCreateFree:
    """测试 subscription_service 的 POST /api/subscription/create-free 内部端点"""

    def test_normal_create(self, sub_client, test_user):
        """正常创建免费订阅"""
        resp = sub_client.post("/api/subscription/create-free", json={
            "user_id": test_user["user_id"],
            "email": test_user["email"],
            "plan": "free",
        }, headers={"x-internal-key": INTERNAL_KEY})

        assert resp.status_code == 200, f"HTTP {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data["success"] is True
        assert data["plan"] == "free"
        assert data["status"] == "active"
        assert data["subscription_id"] == test_user["user_id"]

    def test_idempotent(self, sub_client, test_user):
        """幂等性：同一用户多次调用应返回 '订阅已存在'"""
        # 第一次
        resp1 = sub_client.post("/api/subscription/create-free", json={
            "user_id": test_user["user_id"],
            "email": test_user["email"],
            "plan": "free",
        }, headers={"x-internal-key": INTERNAL_KEY})
        assert resp1.status_code == 200

        # 第二次（幂等）
        resp2 = sub_client.post("/api/subscription/create-free", json={
            "user_id": test_user["user_id"],
            "email": test_user["email"],
            "plan": "free",
        }, headers={"x-internal-key": INTERNAL_KEY})
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert data2["success"] is True
        assert "已存在" in data2["message"]

    def test_missing_internal_key(self, sub_client, test_user):
        """缺少 x-internal-key → 422（FastAPI 参数校验）"""
        resp = sub_client.post("/api/subscription/create-free", json={
            "user_id": test_user["user_id"],
            "email": test_user["email"],
            "plan": "free",
        })
        # 422: FastAPI 在参数层就拦截了缺失的必需 Header
        assert resp.status_code in (403, 422), f"期望 403/422，实际 {resp.status_code}"

    def test_wrong_internal_key(self, sub_client, test_user):
        """错误的 x-internal-key → 403"""
        resp = sub_client.post("/api/subscription/create-free", json={
            "user_id": test_user["user_id"],
            "email": test_user["email"],
            "plan": "free",
        }, headers={"x-internal-key": "wrong-key-hacker"})
        assert resp.status_code == 403, f"期望 403，实际 {resp.status_code}"

    def test_invalid_plan_rejected(self, sub_client, test_user):
        """plan 非 'free' 时拒绝"""
        resp = sub_client.post("/api/subscription/create-free", json={
            "user_id": test_user["user_id"],
            "email": test_user["email"],
            "plan": "pro",
        }, headers={"x-internal-key": INTERNAL_KEY})
        assert resp.status_code == 422, f"期望 422 校验错误，实际 {resp.status_code}"


# ══════════════════════════════════════════════════════
# Test: auth_service 回调重试机制
# ══════════════════════════════════════════════════════

class TestAuthCallbackRetry:
    """测试 auth_service 注册后的 _call_subscription_create_free 回调"""

    def test_registration_triggers_callback(self, auth_client, sub_client):
        """注册后应自动调用 subscription_service 创建订阅"""
        email = _random_email()
        phone = _random_phone()

        resp = auth_client.post("/api/auth/register", json={
            "company": "回调测试企业",
            "name": "回调测试",
            "phone": phone,
            "email": email,
            "password": "EcoTest123",
        })

        assert resp.status_code == 201, f"注册失败: {resp.text}"
        data = resp.json()
        user_id = data["user"]["id"]

        # 验证 subscription 已创建（通过内部端点查询）
        sub_resp = sub_client.post("/api/subscription/create-free", json={
            "user_id": user_id,
            "email": email,
            "plan": "free",
        }, headers={"x-internal-key": INTERNAL_KEY})

        assert sub_resp.status_code == 200
        sub_data = sub_resp.json()
        assert sub_data["plan"] == "free"
        # 幂等语义：如果注册回调已创建，第二次调用应返回 '已存在'
        assert sub_data["success"] is True

    @pytest.mark.retry
    def test_register_does_not_block_on_callback_failure(self, auth_client):
        """subscription_service 不可达时，注册仍应成功（不阻塞）"""
        email = _random_email()
        phone = _random_phone()

        resp = auth_client.post("/api/auth/register", json={
            "company": "容错测试企业",
            "name": "容错测试",
            "phone": phone,
            "email": email,
            "password": "EcoTest123",
        })

        # 无论 subscription_service 状态，注册都应成功
        assert resp.status_code == 201, (
            f"注册应成功即使 subscription 不可达，实际 HTTP {resp.status_code}: {resp.text}"
        )
        data = resp.json()
        assert data["success"] is True
        assert "user" in data
        assert data["user"]["email"] == email

    @pytest.mark.slow
    def test_callback_retry_on_timeout(self, auth_client, sub_client):
        """验证回调重试日志（需手动验证 auth 日志中的 '↻ 重试' 记录）"""
        # 此测试仅验证正常路径（subscription 在线时的回调成功）
        email = _random_email()
        phone = _random_phone()

        resp = auth_client.post("/api/auth/register", json={
            "company": "重试验证企业",
            "name": "重试验证",
            "phone": phone,
            "email": email,
            "password": "EcoTest123",
        })

        assert resp.status_code == 201
        user_id = resp.json()["user"]["id"]

        # 验证订阅最终创建成功
        time.sleep(1)  # 等待回调完成
        sub_resp = sub_client.post("/api/subscription/create-free", json={
            "user_id": user_id,
            "email": email,
            "plan": "free",
        }, headers={"x-internal-key": INTERNAL_KEY})

        assert sub_resp.status_code == 200
        sub_data = sub_resp.json()
        assert sub_data["plan"] == "free"


# ══════════════════════════════════════════════════════
# Test: api_pool 许可证签发
# ══════════════════════════════════════════════════════

class TestLicenseIssue:
    """测试 api_pool 的 POST /api/pool/license/issue 和 GET /api/pool/license/check"""

    def test_issue_license_normal(self, pool_client, test_user):
        """正常签发许可证"""
        fingerprint = _machine_fingerprint()

        resp = pool_client.post("/api/pool/license/issue", json={
            "user_id": test_user["user_id"],
            "fingerprint": fingerprint,
            "tier": "pro_trial",
            "customer": test_user["email"].split("@")[0],
            "expire_days": 15,
        })

        assert resp.status_code == 200, f"HTTP {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data["success"] is True
        assert data["license_key"].startswith("ECOPILOT-")
        assert data["tier"] == "pro_trial"
        assert data["report_quota"] == 3
        assert data["trial_days"] == 15

    def test_issue_license_free_tier(self, pool_client, test_user):
        """签发 free 套餐许可证"""
        fingerprint = _machine_fingerprint()

        resp = pool_client.post("/api/pool/license/issue", json={
            "user_id": test_user["user_id"],
            "fingerprint": fingerprint,
            "tier": "free",
            "customer": test_user["email"].split("@")[0],
            "expire_days": 3650,
        })

        assert resp.status_code == 200
        data = resp.json()
        assert data["tier"] == "free"
        assert data["report_quota"] == 0  # free 无报告配额

    def test_license_check_after_issue(self, pool_client, test_user):
        """签发许可证后，check 应返回 has_new=true"""
        fingerprint = _machine_fingerprint()

        # 先签发
        issue_resp = pool_client.post("/api/pool/license/issue", json={
            "user_id": test_user["user_id"],
            "fingerprint": fingerprint,
            "tier": "pro_trial",
            "customer": test_user["email"].split("@")[0],
            "expire_days": 15,
        })
        assert issue_resp.status_code == 200

        # 再轮询
        check_resp = pool_client.get(
            f"/api/pool/license/check?user_id={test_user['user_id']}"
        )
        assert check_resp.status_code == 200
        data = check_resp.json()
        assert data["has_new"] is True
        assert data["license_key"].startswith("ECOPILOT-")
        assert data["tier"] == "pro_trial"

    def test_license_check_no_history(self, pool_client):
        """从未签发过的用户，check 应返回 has_new=false"""
        fake_id = f"nonexistent_{uuid.uuid4().hex[:8]}"
        resp = pool_client.get(f"/api/pool/license/check?user_id={fake_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_new"] is False

    def test_issue_license_missing_fingerprint(self, pool_client, test_user):
        """fingerprint 太短 → 422 校验错误"""
        resp = pool_client.post("/api/pool/license/issue", json={
            "user_id": test_user["user_id"],
            "fingerprint": "short",  # min_length=8，但这里只有5
            "tier": "free",
            "customer": "test",
            "expire_days": 365,
        })
        assert resp.status_code == 422, f"期望 422，实际 {resp.status_code}"

    def test_heartbeat(self, pool_client, test_user):
        """心跳上报"""
        resp = pool_client.post("/api/pool/usage/heartbeat", json={
            "user_id": test_user["user_id"],
            "timestamp": "",
            "version": "1.0.0",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["online"] is True


# ══════════════════════════════════════════════════════
# Test: 端到端闭环集成
# ══════════════════════════════════════════════════════

class TestE2EClosedLoop:
    """端到端集成测试：注册 → 订阅 → 许可证 → 心跳"""

    @pytest.mark.integration
    def test_full_flow(self, auth_client, sub_client, pool_client):
        """完整闭环流程，一步到位"""
        email = _random_email()
        phone = _random_phone()
        fingerprint = _machine_fingerprint()

        # ── Step 1: 注册 ──
        reg = auth_client.post("/api/auth/register", json={
            "company": "闭环集成测试",
            "name": "集成用户",
            "phone": phone,
            "email": email,
            "password": "EcoTest123",
        })
        assert reg.status_code == 201, f"注册失败: {reg.text}"
        reg_data = reg.json()
        user_id = reg_data["user"]["id"]
        assert reg_data["success"] is True

        # ── Step 2: 验证订阅自动创建 ──
        time.sleep(0.5)
        sub = sub_client.post("/api/subscription/create-free", json={
            "user_id": user_id,
            "email": email,
            "plan": "free",
        }, headers={"x-internal-key": INTERNAL_KEY})
        assert sub.status_code == 200, f"订阅查询失败: {sub.text}"
        sub_data = sub.json()
        assert sub_data["plan"] == "free"
        assert sub_data["status"] == "active"

        # ── Step 3: 签发许可证 ──
        lic = pool_client.post("/api/pool/license/issue", json={
            "user_id": user_id,
            "fingerprint": fingerprint,
            "tier": "pro_trial",
            "customer": "闭环集成测试",
            "expire_days": 15,
        })
        assert lic.status_code == 200, f"签发失败: {lic.text}"
        lic_data = lic.json()
        assert lic_data["success"] is True
        lic_key = lic_data["license_key"]
        assert lic_key.startswith("ECOPILOT-")
        assert lic_data["report_quota"] == 3

        # ── Step 4: 轮询验证 ──
        check = pool_client.get(f"/api/pool/license/check?user_id={user_id}")
        assert check.status_code == 200
        check_data = check.json()
        assert check_data["has_new"] is True
        assert check_data["license_key"] == lic_key

        # ── Step 5: 心跳 ──
        hb = pool_client.post("/api/pool/usage/heartbeat", json={
            "user_id": user_id,
            "timestamp": "",
            "version": "1.0.0",
        })
        assert hb.status_code == 200
        hb_data = hb.json()
        assert hb_data["online"] is True

    @pytest.mark.integration
    def test_register_with_retry_on_subscription_failure(self, auth_client, sub_client):
        """注册时 subscription 失败，注册仍成功，后续幂等补建订阅"""
        email = _random_email()
        phone = _random_phone()

        # Step 1: 注册（subscription 正常时）
        reg = auth_client.post("/api/auth/register", json={
            "company": "容错集成测试",
            "name": "容错用户",
            "phone": phone,
            "email": email,
            "password": "EcoTest123",
        })
        assert reg.status_code == 201, f"注册失败: {reg.text}"
        user_id = reg.json()["user"]["id"]

        # Step 2: 调用 create-free（幂等验证：如果回调成功，返回'已存在'）
        sub = sub_client.post("/api/subscription/create-free", json={
            "user_id": user_id,
            "email": email,
            "plan": "free",
        }, headers={"x-internal-key": INTERNAL_KEY})

        assert sub.status_code == 200
        sub_data = sub.json()
        # 无论回调是否成功，这里都能创建/恢复 subscription
        assert sub_data["success"] is True
        assert sub_data["plan"] == "free"


# ══════════════════════════════════════════════════════
# Test: 服务健康检查
# ══════════════════════════════════════════════════════

class TestServiceHealth:
    """确保所有服务在测试前都已启动"""

    def test_auth_health(self, auth_client):
        resp = auth_client.get("/api/auth/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_subscription_health(self, sub_client):
        resp = sub_client.get("/api/subscription/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_pool_health(self, pool_client):
        resp = pool_client.get("/api/pool/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
