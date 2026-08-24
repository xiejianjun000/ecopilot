"""
Hermes API 路由 — 将 Hermes CLI 全部能力暴露为 REST 端点

注册: chat_api.py 中 app.include_router(hermes_router)
"""

import logging
import time
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from hermes_bridge import HermesBridge

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/hermes", tags=["hermes"])
bridge = HermesBridge()


def cors_json(status: int, data, request: Request):
    """统一 CORS JSON 响应"""
    content = data if isinstance(data, dict) else {"error": str(data)}
    return JSONResponse(status_code=status, content=content,
                        headers={"Access-Control-Allow-Origin": "*"})


def _log(level: str, event: str, **fields):
    """统一结构化日志打印 — 方便排查 onboarding 异常
    输出格式: [Hermes] [LEVEL] event key=value ...
    只用 print 到 stdout（立即 flush，方便实时排查），
    不走 logging 避免 root logger 重复输出。
    """
    extra = " ".join(f"{k}={v!r}" for k, v in fields.items())
    line = f"[Hermes] [{level.upper()}] {event} {extra}" if extra else f"[Hermes] [{level.upper()}] {event}"
    print(line, flush=True)


# ─── Health ────────────────────────────────────────────────

@router.get("/health")
async def hermes_health():
    """Hermes 连接状态"""
    try:
        v = await bridge.version()
        return {"ok": True, "version": v, "connected": bool(v)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ─── Curator (技能管家/进化) ─────────────────────────────

@router.get("/curator/status")
async def curator_status(request: Request):
    """Curator 状态 — 技能进化管家"""
    try:
        data = await bridge.curator_status()
        return cors_json(200, data, request)
    except Exception as e:
        return cors_json(500, str(e), request)


@router.post("/curator/run")
async def curator_run(request: Request):
    """手动触发 Curator 运行"""
    try:
        data = await bridge.curator_run()
        return cors_json(200, data, request)
    except Exception as e:
        return cors_json(500, str(e), request)


@router.post("/curator/pause")
async def curator_pause(request: Request):
    """暂停 Curator"""
    try:
        data = await bridge.curator_pause()
        return cors_json(200, data, request)
    except Exception as e:
        return cors_json(500, str(e), request)


@router.post("/curator/resume")
async def curator_resume(request: Request):
    """恢复 Curator"""
    try:
        data = await bridge.curator_resume()
        return cors_json(200, data, request)
    except Exception as e:
        return cors_json(500, str(e), request)


@router.post("/curator/prune")
async def curator_prune(days: int = 90, request: Request = None):
    """清理闲置技能（默认90天未使用）"""
    try:
        data = await bridge.curator_prune(days)
        return cors_json(200, data, request)
    except Exception as e:
        return cors_json(500, str(e), request)


# ─── Skills (技能管理) ──────────────────────────────────

@router.get("/skills")
async def skills_list(source: str = "all", request: Request = None):
    """列出所有已安装技能"""
    try:
        data = await bridge.skills_list(source)
        return cors_json(200, {"skills": data, "total": len(data)}, request)
    except Exception as e:
        return cors_json(500, str(e), request)


@router.get("/skills/search")
async def skills_search(q: str = "", request: Request = None):
    """搜索可安装技能"""
    try:
        data = await bridge.skills_search(q) if q else []
        return cors_json(200, {"results": data}, request)
    except Exception as e:
        return cors_json(500, str(e), request)


@router.post("/skills/install")
async def skills_install(body: dict, request: Request = None):
    """安装技能"""
    try:
        name = body.get("name", "")
        if not name:
            return cors_json(400, {"error": "缺少 name"}, request)
        data = await bridge.skills_install(name)
        return cors_json(200, data, request)
    except Exception as e:
        return cors_json(500, str(e), request)


@router.delete("/skills/{name}")
async def skills_uninstall(name: str, request: Request = None):
    """卸载技能"""
    try:
        data = await bridge.skills_uninstall(name)
        return cors_json(200, data, request)
    except Exception as e:
        return cors_json(500, str(e), request)


@router.get("/skills/{name}")
async def skills_inspect(name: str, request: Request = None):
    """查看技能详情"""
    try:
        data = await bridge.skills_inspect(name)
        return cors_json(200, data, request)
    except Exception as e:
        return cors_json(500, str(e), request)


# ─── Journey (学习旅程/记忆图谱) ────────────────────────

@router.get("/journey")
async def journey(request: Request):
    """学习旅程 — 时间线 + 图谱数据"""
    try:
        data = await bridge.journey()
        return cors_json(200, data, request)
    except Exception as e:
        return cors_json(500, str(e), request)


@router.get("/journey/stats")
async def journey_stats(request: Request):
    """学习旅程统计摘要"""
    try:
        data = await bridge.journey_stats()
        return cors_json(200, data, request)
    except Exception as e:
        return cors_json(500, str(e), request)


# ─── Memory (记忆) ────────────────────────────────────────

@router.get("/memory/status")
async def memory_status(request: Request):
    """记忆系统状态"""
    try:
        data = await bridge.memory_status()
        return cors_json(200, data, request)
    except Exception as e:
        return cors_json(500, str(e), request)


# ─── Insights (洞察/用量) ────────────────────────────────

@router.get("/insights")
async def insights(request: Request):
    """用量洞察与分析"""
    try:
        data = await bridge.insights()
        return cors_json(200, data, request)
    except Exception as e:
        return cors_json(500, str(e), request)


# ─── Doctor (健康检查) ──────────────────────────────────

@router.get("/doctor")
async def hermes_doctor(request: Request):
    """Hermes 全面健康检查"""
    try:
        data = await bridge.doctor()
        return cors_json(200, data, request)
    except Exception as e:
        return cors_json(500, str(e), request)


# ═══════════════════════════════════════════════════════════════
# Onboarding 集成端点 — 品牌动画→模型配置→许可证登录→技能下载→用户注册
# ═══════════════════════════════════════════════════════════════

@router.post("/wake")
async def hermes_wake(request: Request):
    """唤醒 Hermes Agent — 配置大模型后调用，初始化引擎+记忆系统

    在 onboarding 的 ModelConfigStep 保存模型后调用。
    后端会:
      1. 初始化 HermesEngine 并 warmup
      2. 初始化 hermes_adapter 的 MemoryManager
      3. 返回 hermes_session_id（后续对话复用）
    """
    _log("info", "wake_request_received")
    t0 = time.time()
    try:
        body = await request.json()
    except Exception:
        body = {}
    _log("info", "wake_request_body", text_model=body.get("text_model", ""))

    try:
        # 1. 唤醒 Hermes 引擎（懒加载 + warmup）
        _log("info", "wake_engine_init_start")
        import chat_api
        engine = chat_api._get_hermes_engine()
        # warmup 已在 _get_hermes_engine 中自动触发
        _log("info", "wake_engine_init_done", engine=type(engine).__name__)

        # 2. 初始化记忆系统
        _log("info", "wake_memory_init_start")
        from hermes_adapter import memory as hermes_memory
        _log("info", "wake_memory_init_done", module=type(hermes_memory).__name__)

        # 3. 生成 hermes_session_id
        import uuid
        hermes_session_id = f"hermes-{uuid.uuid4().hex[:12]}"
        _log("info", "wake_session_created", session_id=hermes_session_id)

        # 4. 记录唤醒事件
        try:
            import json as _j
            from pathlib import Path
            from datetime import datetime, timezone, timedelta
            tz = timezone(timedelta(hours=8))
            wake_log = Path.home() / ".ecopilot-home" / "hermes-wake.json"
            wake_log.parent.mkdir(parents=True, exist_ok=True)
            wake_data = {
                "session_id": hermes_session_id,
                "woken_at": datetime.now(tz).isoformat(),
                "engine": "hermes",
                "model": body.get("text_model", ""),
            }
            wake_log.write_text(_j.dumps(wake_data, ensure_ascii=False, indent=2), encoding="utf-8")
            _log("info", "wake_log_saved", path=str(wake_log))
        except Exception as e:
            _log("warning", "wake_log_save_failed", error=str(e))

        ms = int((time.time() - t0) * 1000)
        _log("info", "wake_done", session_id=hermes_session_id, ms=ms, engine_ready=True, memory_ready=True)
        return cors_json(200, {
            "ok": True,
            "hermes_session_id": hermes_session_id,
            "engine_ready": True,
            "memory_ready": True,
            "detail": "Hermes 合规管家已唤醒",
        }, request)
    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        _log("error", "wake_failed", ms=ms, error=str(e), exc_type=type(e).__name__,
             hint="降级到 DeepSeek 引擎")
        return cors_json(200, {
            "ok": True,
            "hermes_session_id": f"hermes-fallback",
            "engine_ready": False,
            "memory_ready": False,
            "detail": f"Hermes 唤醒降级（{e}），DeepSeek 引擎可用",
        }, request)


@router.post("/memory")
async def hermes_save_memory(request: Request):
    """写入 Hermes 记忆 — 用户注册后/企业画像更新后调用

    Body:
        target: "user" | "enterprise" | "session"
        id: 用户ID/企业ID/会话ID
        data: 记忆数据 dict

    在 onboarding 的 RegisterStep 注册后调用（target=user），
    在 PermitReadingStep 读取许可证后调用（target=enterprise）。
    """
    _log("info", "memory_request_received")
    t0 = time.time()
    try:
        body = await request.json()
    except Exception:
        _log("error", "memory_invalid_json")
        return cors_json(400, {"error": "Invalid JSON"}, request)

    target = body.get("target", "")
    target_id = body.get("id", "")
    data = body.get("data", {})

    _log("info", "memory_request_body", target=target, id=target_id, data_keys=list(data.keys()) if isinstance(data, dict) else None)

    if not target or not target_id:
        _log("warning", "memory_missing_target_or_id", target=target, id=target_id)
        return cors_json(400, {"error": "缺少 target 或 id"}, request)

    try:
        from hermes_adapter import memory as hermes_memory
        import json as _j
        from pathlib import Path
        from datetime import datetime, timezone, timedelta

        tz = timezone(timedelta(hours=8))
        home = Path.home() / ".ecopilot-home"

        if target == "user":
            # 保存用户信息到 user.json
            user_file = home / "user.json"
            existing = {}
            if user_file.exists():
                try:
                    existing = _j.loads(user_file.read_text(encoding="utf-8"))
                except Exception:
                    pass
            existing.update(data)
            existing["updated_at"] = datetime.now(tz).isoformat()
            user_file.parent.mkdir(parents=True, exist_ok=True)
            user_file.write_text(_j.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
            _log("info", "memory_user_saved", id=target_id, path=str(user_file),
                 name=data.get("name", ""), role=data.get("role", ""))

            # 同时写入 hermes_adapter 的企业画像记忆（用 phone 或 name 作为 id）
            try:
                hermes_memory.save_enterprise_profile(target_id, {
                    "user_name": data.get("name", ""),
                    "user_role": data.get("role", ""),
                    "user_phone": data.get("phone", ""),
                    "profile_type": "user",
                })
                _log("info", "memory_user_hermes_synced", id=target_id)
            except Exception as e:
                _log("warning", "memory_user_hermes_sync_failed", id=target_id, error=str(e))

        elif target == "enterprise":
            # 保存企业画像到 enterprise.json
            ent_file = home / "enterprise.json"
            existing = {}
            if ent_file.exists():
                try:
                    existing = _j.loads(ent_file.read_text(encoding="utf-8"))
                except Exception:
                    pass
            existing.update(data)
            existing["updated_at"] = datetime.now(tz).isoformat()
            ent_file.parent.mkdir(parents=True, exist_ok=True)
            ent_file.write_text(_j.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
            _log("info", "memory_enterprise_saved", id=target_id, path=str(ent_file),
                 enterprise=data.get("enterprise_name", ""),
                 industry=data.get("industry_name", ""),
                 industry_code=data.get("industry_code", ""))

            # 同步到 hermes_adapter 记忆
            try:
                hermes_memory.save_enterprise_profile(target_id, data)
                _log("info", "memory_enterprise_hermes_synced", id=target_id)
            except Exception as e:
                _log("warning", "memory_enterprise_hermes_sync_failed", id=target_id, error=str(e))

        elif target == "session":
            # 保存会话上下文
            try:
                hermes_memory.save_session_context(target_id, data.get("enterprise_id", ""), data)
                _log("info", "memory_session_saved", id=target_id)
            except Exception as e:
                _log("warning", "memory_session_save_failed", id=target_id, error=str(e))

        else:
            _log("warning", "memory_unknown_target", target=target)
            return cors_json(400, {"error": f"未知 target: {target}"}, request)

        ms = int((time.time() - t0) * 1000)
        _log("info", "memory_done", target=target, id=target_id, ms=ms)
        return cors_json(200, {
            "ok": True,
            "target": target,
            "id": target_id,
            "detail": f"已写入{target}记忆",
        }, request)

    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        _log("error", "memory_failed", target=target, id=target_id, ms=ms,
             error=str(e), exc_type=type(e).__name__)
        return cors_json(500, {"error": str(e)}, request)


@router.get("/soul-tuner/summary")
async def soul_tuner_summary(request: Request):
    """SOUL 调优器状态摘要 — 前端展示当前个性化状态"""
    try:
        from soul_tuner import get_tuner_summary
        data = get_tuner_summary()
        return cors_json(200, data, request)
    except Exception as e:
        return cors_json(500, {"error": str(e)}, request)


@router.get("/service-boundary")
async def service_boundary_api(request: Request):
    """服务边界摘要 — 前端展示当前管理等级+行业的服务边界"""
    try:
        from service_boundary import get_boundary_summary
        data = get_boundary_summary()
        return cors_json(200, data, request)
    except Exception as e:
        return cors_json(500, {"error": str(e)}, request)


# ─── EcoSkill 行业技能端点 ──────────────────────────────

@router.get("/ecoskill/by-industry")
async def ecoskill_by_industry(request: Request):
    """获取行业对应的技能列表（远程 + 通用 + 兜底）"""
    try:
        from ecoskill.bridge import get_skills_by_industry
        industry_code = request.query_params.get("code", "")
        if not industry_code:
            return cors_json(400, {"error": "缺少 code 参数"}, request)
        data = get_skills_by_industry(industry_code)
        return cors_json(200, data, request)
    except Exception as e:
        return cors_json(500, {"error": str(e)}, request)


@router.post("/ecoskill/install-industry")
async def ecoskill_install_industry(request: Request):
    """为指定行业批量安装所有匹配技能（远程下载含完整 SKILL.md）"""
    _log("info", "install_industry_request_received")
    t0 = time.time()
    try:
        body = await request.json()
    except Exception:
        body = {}
    industry_code = body.get("industry_code", "")
    _log("info", "install_industry_request_body", industry_code=industry_code)
    if not industry_code:
        _log("warning", "install_industry_missing_code")
        return cors_json(400, {"error": "缺少 industry_code"}, request)
    try:
        from ecoskill.bridge import install_skills_for_industry
        _log("info", "install_industry_calling_bridge", industry_code=industry_code)
        data = install_skills_for_industry(industry_code)
        ms = int((time.time() - t0) * 1000)
        _log("info", "install_industry_response",
             industry_code=industry_code,
             ok=data.get("ok"),
             industry_name=data.get("industry_name"),
             total=data.get("total"),
             installed_count=len(data.get("installed", [])),
             skipped_count=len(data.get("skipped", [])),
             failed_count=len(data.get("failed", [])),
             ms=ms)
        return cors_json(200, data, request)
    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        _log("error", "install_industry_failed",
             industry_code=industry_code, ms=ms,
             error=str(e), exc_type=type(e).__name__)
        return cors_json(500, {"error": str(e)}, request)
