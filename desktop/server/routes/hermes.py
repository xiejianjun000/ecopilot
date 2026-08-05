"""
Hermes API 路由 — 将 Hermes CLI 全部能力暴露为 REST 端点

注册: chat_api.py 中 app.include_router(hermes_router)
"""

import logging
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
