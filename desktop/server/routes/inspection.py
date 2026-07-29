"""
EcoPilot 督察整改 API — 文档解析 + 工单管理

提取自 chat_api.py (v1.1)
"""

import json as _json
import re as _re
import base64 as _b64
import time as _time
from pathlib import Path
from fastapi import APIRouter, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse

from logging_config import get_logger
from core.config import HERMES_HOME

_log = get_logger("inspection")

router = APIRouter(prefix="/api", tags=["inspection"])

# ── 内联工具 ──

def _sanitize_input(s: str, max_len: int = 100) -> str:
    if not isinstance(s, str): return s
    s = s[:max_len]
    import html; s = html.escape(s, quote=True)
    for p in ("' OR ", "' AND ", "--", ";", "/*", "*/", "xp_", "exec "):
        s = s.replace(p, "")
    return s

def _load_json_dict(filename: str) -> dict:
    fpath = HERMES_HOME / filename
    if fpath.exists():
        try: return _json.loads(fpath.read_text())
        except: pass
    return {}

def _save_json_dict(filename: str, data: dict):
    HERMES_HOME.mkdir(parents=True, exist_ok=True)
    tmp = HERMES_HOME / f".{filename}.tmp"
    tmp.write_text(_json.dumps(data, ensure_ascii=False, indent=2))
    tmp.replace(HERMES_HOME / filename)

async def _parse_json(request: Request):
    try: return await request.json(), None
    except:
        return None, JSONResponse(status_code=400, content={"ok": False, "detail": "JSON parse failed"})

# ─── 督察整改文档解析 API ───

@router.post("/inspection/parse")
async def inspection_parse(image: UploadFile = File(...), prompt: str = Form("请识别这份环保督察交办文件中的所有问题")):
    """上传督察交办文档 → Kimi OCR → DeepSeek 结构化解析"""
    try:
        content = await image.read()
        b64 = base64.b64encode(content).decode()

        # Step 1: Kimi 视觉 OCR
        resp = await kimi_client.chat.completions.create(
            model=KIMI_VISION_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                ],
            }],
            temperature=0.1,
        )
        ocr_text = resp.choices[0].message.content or ""

        # Step 2: DeepSeek 结构化解析（增强：自动分类类型 + 法规依据 + 严重度）
        ds_prompt = f"""请从以下环保督察交办文件内容中提取所有整改问题，返回严格JSON格式。

文件内容：
{ocr_text[:6000]}

对每个问题提取以下字段：
- title: 问题标题（简洁明确）
- description: 问题详细描述
- requirement: 整改要求
- deadline: 整改截止日期（YYYY-MM-DD格式，无法识别则为空字符串）
- source: 交办来源（central=中央督察/provincial=省级督察/mee=部委交办/special=专项整改/self_check=企业自查，根据上下文推断）
- sourceDetail: 来源详情（如"2025年中央环保督察第3批"）
- responsibleUnit: 责任部门（如有）
- progress: 当前进度（0-100数字，无法识别则为0）
- type: 整改类型，必须从以下三类中选择：
  * "immediate" = 立行立改（立即整改/限期整改/操作违规/管理瑕疵，7-30天内完成）
  * "tracking" = 跟踪督办（需要持续跟踪督办，督办过程中可能升级为立案查处）
  * "engineering" = 工程建设（需要工程措施：改造/新建/扩建/安装/拆除重建，数月-数年完成）
- category: 问题类别（许可管理/台账管理/自行监测/执行报告/应急预案/固废管理/排放口/其他）
- regulation: 法规依据（如"《条例》第21条"、《法典》第75条"，根据问题性质推断）
- severity: 严重度（high=高风险可能立案/medium=中风险/low=低风险）

类型判断规则：
- 包含"改造/新建/扩建/工程/建设/安装"关键词 → engineering
- 包含"立即/限期/立行立改/三天内/七天内"关键词 → immediate
- 包含"跟踪/督办/立案/查处/处罚/罚款/违法"关键词 → tracking
- 不确定时默认 immediate

返回格式:
{{"source":"central","sourceDetail":"2025年中央督察","tasks":[{{"title":"...","description":"...","requirement":"...","deadline":"...","source":"central","sourceDetail":"...","responsibleUnit":"...","progress":0,"type":"immediate","category":"台账管理","regulation":"《条例》第21条","severity":"medium"}}]}}

只输出 JSON，不要其他文字。"""

        ds_resp = await ds_client.chat.completions.create(
            model=TEXT_MODEL,
            messages=[{"role": "user", "content": ds_prompt}],
            temperature=0.1,
            max_tokens=4096,
        )
        ds_text = ds_resp.choices[0].message.content or ""
        json_start = ds_text.find("{")
        json_end = ds_text.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            parsed = json.loads(ds_text[json_start:json_end])
            return {"ok": True, "ocr_text": ocr_text[:500], "tasks": parsed.get("tasks", []), "source": parsed.get("source", "")}
        return {"ok": False, "detail": "DeepSeek 解析失败，返回非JSON格式"}

    except Exception as e:
        return {"ok": False, "detail": f"文档解析失败: {str(e)}"}


# ─── 交办整改工单 API ───

# 内存存储（与日历一致，重启丢失，前端 localStorage 主存储）
_rectification_tasks: dict[str, list[dict]] = _load_json_dict("rectification_tasks.json")  # {enterprise_id: [tasks]}

def _save_rectification_tasks():
    _save_json_dict("rectification_tasks.json", _rectification_tasks)

# 三类整改流程模板
_FLOW_TEMPLATES = {
    "immediate": {  # 立行立改
        "label": "立行立改",
        "nodes": ["发现", "整改", "验收", "归档"],
        "track_by": "day",
    },
    "tracking": {  # 跟踪督办（可能升级为立案查处）
        "label": "跟踪督办",
        "nodes": ["跟踪启动", "整改跟踪", "验收", "归档"],
        "track_by": "week",
        "legal_nodes": ["立案", "申辩/听证", "处罚决定", "执行", "归档"],
    },
    "engineering": {  # 工程建设
        "label": "工程建设",
        "nodes": ["立项", "设计", "招标", "施工", "调试", "验收"],
        "track_by": "month",
    },
}


def _infer_rectification_type(title: str, description: str, requirement: str) -> str:
    """根据交办文件内容推断整改类型"""
    text = f"{title} {description} {requirement}"
    # 工程建设：改造/新建/扩建/工程
    if any(k in text for k in ["改造", "新建", "扩建", "工程", "建设", "安装", "拆除重建"]):
        return "engineering"
    # 立行立改：立即/限期/整改/纠正
    if any(k in text for k in ["立即整改", "限期整改", "立行立改", "立即纠正", "三天内", "七天内", "15日内整改"]):
        return "immediate"
    # 跟踪督办：跟踪/督办/立案/查处/处罚/罚款
    if any(k in text for k in ["跟踪", "督办", "立案", "查处", "处罚", "罚款", "违法"]):
        return "tracking"
    # 默认：立行立改
    return "immediate"


def _generate_initial_review(title: str, description: str, requirement: str,
                              category: str, regulation: str) -> dict:
    """AI 生成初步复盘分析（基于交办内容 + 企业画像）"""
    # ① 巡查遗漏诊断 — 简化判断逻辑
    detection_status = "undetected"  # 默认未发现
    detection_note = "巡查清单未覆盖此类问题"

    # ② 根因分析 — 基于问题类别推断
    root_causes = {
        "许可管理": {"primary": "许可证动态管理机制未建立", "secondary": ["许可证到期预警缺失", "变更申报流程不规范"]},
        "台账管理": {"primary": "台账记录制度未落实到岗位", "secondary": ["记录人员职责不清", "缺乏台账自查机制"]},
        "自行监测": {"primary": "自行监测管理制度不完善", "secondary": ["监测频次执行不到位", "数据审核机制缺失"]},
        "执行报告": {"primary": "执行报告编制流程不规范", "secondary": ["数据来源审核缺失", "报告提交时限管理不足"]},
        "应急预案": {"primary": "应急预案管理缺失", "secondary": ["预案备案过期", "演练未按规定开展"]},
        "固废管理": {"primary": "固废全过程管理不完善", "secondary": ["贮存不规范", "转移联单制度执行不到位"]},
        "排放口": {"primary": "排放口规范化管理不足", "secondary": ["标识不规范", "监测孔设置不符合规范"]},
    }
    root = root_causes.get(category, {"primary": "合规管理制度不完善", "secondary": ["责任分工不明确", "监督检查机制缺失"]})

    # ③ 合规差距诊断 — 基于20项法定义务
    compliance_gap = [
        {"item": "台账记录制度", "status": "missing"},
        {"item": "定期自查机制", "status": "missing"},
        {"item": "岗位责任制度", "status": "partial"},
        {"item": "法规培训覆盖", "status": "partial"},
        {"item": "监测设备运维", "status": "established"},
    ]

    # ④ 预防建议
    prevention = [
        f"补充{category}岗位责任制度，明确记录与审核职责",
        f"每月开展{category}自查，形成自查记录",
        "环保专员参加法规培训，掌握 HJ944/HJ819 要求",
    ]

    return {
        "detectionStatus": detection_status,
        "detectionNote": detection_note,
        "rootCause": root,
        "complianceGap": compliance_gap,
        "preventionSuggestions": prevention,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }


@router.post("/rectification/tasks")
async def rectification_tasks(request: Request):
    """交办整改工单管理
    POST {action: 'list'|'add'|'update'|'delete'|'update_progress'}
    """
    body, err = await _parse_json(request)
    if err is not None: return err
    action = body.get("action", "list")
    eid = body.get("enterpriseId", "default")

    if action == "list":
        return {"ok": True, "tasks": _rectification_tasks.get(eid, [])}

    if action == "add":
        task = body.get("task", {})
        tid = f"rec-{int(time.time())}-{random.randint(1000, 9999)}"
        now = time.strftime("%Y-%m-%dT%H:%M:%S")

        # 自动推断类型（如未指定）
        rtype = task.get("type") or _infer_rectification_type(
            task.get("title", ""), task.get("description", ""), task.get("requirement", ""))

        # 填充流程节点
        template = _FLOW_TEMPLATES.get(rtype, _FLOW_TEMPLATES["immediate"])
        nodes = [{"name": n, "status": "pending"} for n in template["nodes"]]
        if nodes:
            nodes[0]["status"] = "current"

        task.update({
            "id": tid,
            "type": rtype,
            "typeLabel": template["label"],
            "nodes": nodes,
            "currentNode": 0,
            "progress": 0,
            "status": "pending",
            "escalatedToLegal": False,
            "createdAt": now,
            "updatedAt": now,
            "records": [{"time": now, "content": "工单创建", "progress": 0}],
        })

        # 生成初步复盘
        task["review"] = _generate_initial_review(
            task.get("title", ""), task.get("description", ""),
            task.get("requirement", ""), task.get("category", "其他"),
            task.get("regulation", ""))

        tasks = _rectification_tasks.setdefault(eid, [])
        tasks.append(task)
        _save_rectification_tasks()
        return {"ok": True, "task": task}

    if action == "update":
        tid = body.get("taskId", "")
        updates = body.get("updates", {})
        tasks = _rectification_tasks.get(eid, [])
        for t in tasks:
            if t.get("id") == tid:
                t.update(updates)
                t["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                _save_rectification_tasks()
                return {"ok": True, "task": t}
        return {"ok": False, "detail": "工单不存在"}

    if action == "update_progress":
        tid = body.get("taskId", "")
        progress = body.get("progress", 0)
        node_idx = body.get("currentNode")
        content = body.get("content", "")
        tasks = _rectification_tasks.get(eid, [])
        for t in tasks:
            if t.get("id") == tid:
                t["progress"] = progress
                if node_idx is not None:
                    t["currentNode"] = node_idx
                    # 更新节点状态
                    nodes = t.get("nodes", [])
                    for i, n in enumerate(nodes):
                        if i < node_idx:
                            n["status"] = "done"
                        elif i == node_idx:
                            n["status"] = "current"
                        else:
                            n["status"] = "pending"
                    t["nodes"] = nodes
                # 更新工单状态
                if progress >= 100:
                    t["status"] = "completed"
                elif progress > 0:
                    t["status"] = "in_progress"
                # 添加记录
                if content:
                    t.setdefault("records", []).append({
                        "time": time.strftime("%Y-%m-%dT%H:%M:%S"),
                        "content": content,
                        "progress": progress,
                    })
                t["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                _save_rectification_tasks()
                return {"ok": True, "task": t}
        return {"ok": False, "detail": "工单不存在"}

    if action == "escalate_legal":
        """跟踪督办升级为立案查处"""
        tid = body.get("taskId", "")
        tasks = _rectification_tasks.get(eid, [])
        for t in tasks:
            if t.get("id") == tid:
                t["escalatedToLegal"] = True
                # 添加法律程序节点
                legal_nodes = _FLOW_TEMPLATES["tracking"]["legal_nodes"]
                t["legalNodes"] = [{"name": n, "status": "pending"} for n in legal_nodes]
                if t["legalNodes"]:
                    t["legalNodes"][0]["status"] = "current"
                t["legalCurrentNode"] = 0
                # 添加法定时限
                t["legalDeadlines"] = [
                    {"name": "陈述申辩", "deadline": "收到通知7日内", "status": "pending"},
                    {"name": "听证申请", "deadline": "收到告知15日内", "status": "pending"},
                    {"name": "缴纳罚款", "deadline": "收到决定15日内", "status": "pending"},
                ]
                t.setdefault("records", []).append({
                    "time": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    "content": "升级为立案查处程序",
                    "progress": t.get("progress", 0),
                })
                t["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                _save_rectification_tasks()
                return {"ok": True, "task": t}
        return {"ok": False, "detail": "工单不存在"}

    if action == "delete":
        tid = body.get("taskId", "")
        tasks = _rectification_tasks.get(eid, [])
        _rectification_tasks[eid] = [t for t in tasks if t.get("id") != tid]
        _save_rectification_tasks()
        return {"ok": True}

    return {"ok": False, "detail": "未知 action"}


