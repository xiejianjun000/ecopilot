"""
EcoPilot 档案库 (Vault) API

提取自 chat_api.py (v1.1)
"""

import json as _json
import os
import re as _re
import time as _time
import base64 as _b64
from pathlib import Path
from fastapi import APIRouter, Request, UploadFile, File, Form
from fastapi.responses import StreamingResponse, JSONResponse

from logging_config import get_logger
from core.config import (
    HERMES_HOME,
    VAULT_DIR, VAULT_MANIFEST,
    ALLOWED_VAULT_EXT, MAX_VAULT_FILE_SIZE, EXT_MIME,
    validate_file_magic, vault_load_manifest, vault_save_manifest,
    vault_safe_filename, fmt_size_py,
)

_log = get_logger("vault")

router = APIRouter(prefix="/api", tags=["vault"])

# ── 内联工具（避免循环导入）──

def _sse(d: dict) -> str:
    """SSE 事件格式化"""
    return f"data: {_json.dumps(d, ensure_ascii=False)}\n\n"

def _sanitize_input(s: str, max_len: int = 100) -> str:
    """基础输入清洗"""
    if not isinstance(s, str):
        return s
    s = s[:max_len]
    import html
    s = html.escape(s, quote=True)
    for p in ("' OR ", "' AND ", "--", ";", "/*", "*/", "xp_", "exec "):
        s = s.replace(p, "")
    return s

async def _parse_json(request: Request):
    """安全的 JSON 解析"""
    try:
        body = await request.json()
        return body, None
    except Exception:
        return None, JSONResponse(status_code=400, content={"ok": False, "detail": "JSON 解析失败"})

# 存储：~/.ecopilot-home/vault/  (扁平存储)
# 元数据：~/.ecopilot-home/vault/manifest.json

VAULT_DIR = HERMES_HOME / "vault"
VAULT_MANIFEST = VAULT_DIR / "manifest.json"

# ═══ 三大阶段 + 子分类体系 ═══
# 企业环境档案按生命周期分为三大阶段，每阶段下有子分类
VAULT_PHASES = [
    {"id": "construction", "label": "建设期间"},
    {"id": "operation",    "label": "运营期间"},
    {"id": "decommission", "label": "退役期间"},
]

# 子分类默认归属某个阶段（用户可自定义增删，但"其他"始终存在）
VAULT_DEFAULT_SUBCATS = [
    {"name": "环评",       "phase": "construction"},
    {"name": "验收",       "phase": "construction"},
    {"name": "许可证",     "phase": "operation"},
    {"name": "台账",       "phase": "operation"},
    {"name": "自行监测",   "phase": "operation"},
    {"name": "执行报告",   "phase": "operation"},
    {"name": "应急预案",   "phase": "operation"},
    {"name": "固废管理",   "phase": "operation"},
    {"name": "清洁生产",   "phase": "operation"},
    {"name": "信息公开",   "phase": "operation"},
    {"name": "土壤调查",   "phase": "decommission"},
    {"name": "拆除方案",   "phase": "decommission"},
    {"name": "修复报告",   "phase": "decommission"},
    {"name": "退役验收",   "phase": "decommission"},
    {"name": "其他",       "phase": "operation"},  # 兜底分类
]

# 法规要求企业必备的环境档案模板（缺失项提示）
REQUIRED_DOCS = [
    # 建设期间
    {"tpl_id": "eia_report",      "name": "环境影响评价报告书",       "cat": "环评",     "phase": "construction", "desc": "建设项目环评报告书全文"},
    {"tpl_id": "eia_approval",    "name": "环评批复文件",             "cat": "环评",     "phase": "construction", "desc": "生态环境部门批复文件，含排放总量"},
    {"tpl_id": "acceptance",      "name": "竣工环保验收报告",         "cat": "验收",     "phase": "construction", "desc": "新建项目投产前必须完成验收"},
    # 运营期间 — 许可证
    {"tpl_id": "permit",          "name": "排污许可证(正本+副本)",    "cat": "许可证",   "phase": "operation", "desc": "有效期内的排污许可证正本与副本"},
    # 运营期间 — 自行监测
    {"tpl_id": "monitor_plan",    "name": "自行监测方案",             "cat": "自行监测", "phase": "operation", "desc": "根据 HJ 878 编制"},
    {"tpl_id": "monitor_eq",      "name": "自动监测设备验收材料",     "cat": "自行监测", "phase": "operation", "desc": "CEMS 通过验收的材料"},
    # 运营期间 — 执行报告
    {"tpl_id": "exec_report",     "name": "年度执行报告",             "cat": "执行报告", "phase": "operation", "desc": "上年度排污许可执行报告"},
    # 运营期间 — 应急
    {"tpl_id": "emergency",       "name": "突发环境事件应急预案",     "cat": "应急预案", "phase": "operation", "desc": "备案有效期内的应急预案"},
    # 运营期间 — 固废
    {"tpl_id": "hazwaste",        "name": "危险废物管理计划",         "cat": "固废管理", "phase": "operation", "desc": "每年12月前备案下一年度计划"},
    # 运营期间 — 清洁生产
    {"tpl_id": "cleaner",         "name": "清洁生产审核报告",         "cat": "清洁生产", "phase": "operation", "desc": "清洁生产审核报告"},
    # 运营期间 — 信息公开
    {"tpl_id": "info_disclosure", "name": "环境信息公开记录",         "cat": "信息公开", "phase": "operation", "desc": "企业环境信息依法披露记录"},
    # 退役期间
    {"tpl_id": "soil_survey",     "name": "土壤环境调查报告",         "cat": "土壤调查", "phase": "decommission", "desc": "停产前土壤环境质量现状调查"},
    {"tpl_id": "decomm_plan",     "name": "退役拆除方案",             "cat": "拆除方案", "phase": "decommission", "desc": "拆除活动污染防治方案"},
    {"tpl_id": "remediation",     "name": "污染场地修复报告",         "cat": "修复报告", "phase": "decommission", "desc": "场地污染修复效果评估报告"},
    {"tpl_id": "decomm_accept",   "name": "退役验收文件",             "cat": "退役验收", "phase": "decommission", "desc": "生态环境部门退役验收批复"},
]

VAULT_CATEGORIES = ["全部", "环评", "验收", "许可证", "台账", "自行监测", "执行报告", "应急预案", "固废管理", "清洁生产", "信息公开", "土壤调查", "拆除方案", "修复报告", "退役验收", "其他"]

# 分类持久化文件（用户可自定义子分类）
VAULT_CATEGORIES_FILE = VAULT_DIR / "categories.json"

def _vault_load_categories():
    """读取用户自定义子分类列表，返回 [{name, phase}, ...]"""
    import json as _json
    if VAULT_CATEGORIES_FILE.exists():
        try:
            data = _json.loads(VAULT_CATEGORIES_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list) and data:
                # 兼容旧格式（纯字符串列表）
                if isinstance(data[0], str):
                    return [{"name": c, "phase": "operation"} for c in data]
                return data
        except Exception:
            pass
    return VAULT_DEFAULT_SUBCATS

def _vault_save_categories(cats):
    """保存子分类列表 [{name, phase}, ...]"""
    import json as _json
    VAULT_DIR.mkdir(parents=True, exist_ok=True)
    VAULT_CATEGORIES_FILE.write_text(
        _json.dumps(cats, ensure_ascii=False, indent=2), encoding="utf-8"
    )

def _vault_category_names():
    """返回所有子分类名称列表（不含'全部'）"""
    return [c["name"] for c in _vault_load_categories()]

# 允许上传的文件类型与大小限制
ALLOWED_VAULT_EXT = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff",
    ".txt", ".md", ".csv", ".zip", ".rar", ".7z",
}
MAX_VAULT_FILE_SIZE = 50 * 1024 * 1024  # 50MB

# 文件扩展名 → MIME 类型（预览用）
EXT_MIME = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".bmp": "image/bmp", ".webp": "image/webp",
    ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".zip": "application/zip", ".rar": "application/x-rar", ".7z": "application/x-7z-compressed",
}

def vault_load_manifest():
    """读取档案库 manifest，返回 files 列表"""
    import json as _json
    if VAULT_MANIFEST.exists():
        try:
            data = _json.loads(VAULT_MANIFEST.read_text(encoding="utf-8"))
            return data.get("files", []) if isinstance(data, dict) else []
        except Exception:
            return []
    return []

def vault_save_manifest(files):
    """原子写入 manifest"""
    import json as _json
    VAULT_DIR.mkdir(parents=True, exist_ok=True)
    tmp = VAULT_MANIFEST.with_suffix(".json.tmp")
    tmp.write_text(_json.dumps({"files": files}, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(VAULT_MANIFEST)

def vault_safe_filename(original: str) -> str:
    """生成安全的存储文件名：时间戳 + 原始名（去除路径）"""
    import re as _re, time as _time
    base = Path(original).name  # 去除路径
    base = _re.sub(r'[^\w\u4e00-\u9fff.\-]', '_', base)  # 保留中文/字母/数字/._-
    if not base or base.startswith("."):
        base = "file" + base
    ts = _time.strftime("%Y%m%d-%H%M%S")
    return f"{ts}_{base}"

_vault_list_cache: dict = {}

@router.get("/vault/list")
async def vault_list():
    """返回档案库列表：已上传文件 + 法规要求模板（标记是否已上传）"""
    import time as _t
    now = _t.time()
    if _vault_list_cache and now - _vault_list_cache.get("ts", 0) < 30:
        return _vault_list_cache["data"]
    files = vault_load_manifest()
    # 按文件名去重：同一 original_name 保留最新一条（upload_date 倒序）
    seen_names = {}
    for f in sorted(files, key=lambda x: x.get("upload_date", ""), reverse=True):
        name = f.get("original_name", "")
        if name and name not in seen_names:
            seen_names[name] = f
    files = list(seen_names.values())
    # 为已上传文件补充模板标记（同一 tpl_id 视为已补传）
    uploaded_tpl_ids = {f.get("tpl_id") for f in files if f.get("tpl_id")}
    required = []
    for tpl in REQUIRED_DOCS:
        item = {**tpl, "uploaded": tpl["tpl_id"] in uploaded_tpl_ids}
        required.append(item)
    result = {
        "files": files,
        "required": required,
        "categories": ["全部"] + _vault_category_names(),
        "subcats": _vault_load_categories(),
        "phases": VAULT_PHASES,
        "stats": {
            "total_required": len(REQUIRED_DOCS),
            "uploaded_required": len(uploaded_tpl_ids),
            "extra_files": len([f for f in files if not f.get("tpl_id")]),
        }
    }
    _vault_list_cache.clear()
    _vault_list_cache.update({"data": result, "ts": now})
    return result

@router.get("/vault/categories")
async def vault_categories_get():
    """获取子分类列表（含阶段归属）"""
    return {"ok": True, "subcats": _vault_load_categories(), "phases": VAULT_PHASES}

@router.post("/vault/categories")
async def vault_categories_update(request: Request):
    """更新子分类列表（重命名/新增/删除/排序/调整阶段归属）
    Body: { "subcats": [{"name":"环评","phase":"construction"},...], "renames": {"旧名":"新名"} }
    """
    import json as _json
    try:
        body = await request.json()
    except Exception:
        return {"ok": False, "detail": "无效的 JSON"}
    subcats = body.get("subcats", [])
    renames = body.get("renames", {}) or {}
    if not isinstance(subcats, list):
        return {"ok": False, "detail": "subcats 必须是数组"}
    # 校验 + 去重
    valid_phases = {p["id"] for p in VAULT_PHASES}
    seen = set(); deduped = []
    has_other = False
    for sc in subcats:
        if not isinstance(sc, dict): continue
        name = str(sc.get("name", "")).strip()
        phase = str(sc.get("phase", "operation"))
        if not name: continue
        if phase not in valid_phases: phase = "operation"
        if name in seen: continue
        seen.add(name)
        deduped.append({"name": name, "phase": phase})
        if name == "其他": has_other = True
    # "其他"必须保留
    if not has_other:
        deduped.append({"name": "其他", "phase": "operation"})
    _vault_save_categories(deduped)
    # 同步已上传文件的分类重命名
    if renames:
        files = vault_load_manifest()
        changed = False
        valid_names = {sc["name"] for sc in deduped}
        for f in files:
            old_cat = f.get("category", "")
            if old_cat in renames:
                f["category"] = renames[old_cat]
                changed = True
            elif old_cat not in valid_names:
                f["category"] = "其他"
                changed = True
        if changed:
            vault_save_manifest(files)
    return {"ok": True, "subcats": deduped, "phases": VAULT_PHASES}

@router.post("/vault/upload")
async def vault_upload(
    file: UploadFile = File(...),
    category: str = Form("其他"),
    code: str = Form(""),
    desc: str = Form(""),
    tpl_id: str = Form(""),  # 可选：关联的模板 id（缺失项补传）
):
    """上传单个文件到档案库"""
    from datetime import datetime as _dt
    # 校验扩展名
    original_name = file.filename or "unnamed"
    ext = Path(original_name).suffix.lower()
    if ext not in ALLOWED_VAULT_EXT:
        return {"ok": False, "detail": f"不支持的文件类型：{ext}（允许：PDF/Word/Excel/图片/文本/压缩包）"}

    # 读取内容并校验大小
    content = await file.read()
    if len(content) > MAX_VAULT_FILE_SIZE:
        return {"ok": False, "detail": f"文件过大：{len(content)//1024//1024}MB（上限 50MB）"}
    if len(content) == 0:
        return {"ok": False, "detail": "文件为空"}

    VAULT_DIR.mkdir(parents=True, exist_ok=True)

    # 如果指定了 tpl_id，先删除该模板下的旧文件（一个模板只保留最新一份）
    files = vault_load_manifest()
    if tpl_id:
        old = [f for f in files if f.get("tpl_id") == tpl_id]
        for o in old:
            try: (VAULT_DIR / o["filename"]).unlink(missing_ok=True)
            except Exception: pass
        files = [f for f in files if f.get("tpl_id") != tpl_id]

    # 存储文件
    stored_name = vault_safe_filename(original_name)
    # 避免重名
    counter = 1
    while (VAULT_DIR / stored_name).exists():
        stored_name = f"{Path(stored_name).stem}_{counter}{Path(stored_name).suffix}"
        counter += 1
    (VAULT_DIR / stored_name).write_bytes(content)

    # 记录元数据
    import uuid as _uuid
    record = {
        "id": _uuid.uuid4().hex[:12],
        "filename": stored_name,           # 实际存储名
        "original_name": original_name,    # 原始文件名（显示用）
        "category": category if category in _vault_category_names() else "其他",
        "code": code.strip()[:100],
        "desc": desc.strip()[:500],
        "tpl_id": tpl_id.strip() if tpl_id.strip() else None,
        "upload_date": _dt.now().isoformat(timespec="seconds"),
        "size": len(content),
        "mime_type": EXT_MIME.get(ext, "application/octet-stream"),
        "ext": ext,
    }
    files.append(record)
    vault_save_manifest(files)

    return {"ok": True, "file": record}

@router.get("/vault/file")
async def vault_file(id: str = "", name: str = "", inline: str = "1"):
    """获取档案文件内容用于在线预览/下载
    - id: manifest 中的文件 id（推荐）
    - name: 原始文件名（兼容旧前端）
    - inline=1 返回 inline（浏览器内预览），inline=0 返回 attachment（下载）
    """
    from fastapi.responses import FileResponse
    files = vault_load_manifest()
    record = None
    if id:
        record = next((f for f in files if f.get("id") == id), None)
    elif name:
        # 兼容旧前端按原始名查找
        record = next((f for f in files if f.get("original_name") == name or f.get("filename") == name), None)
    if not record:
        from fastapi.responses import JSONResponse
        return JSONResponse({"ok": False, "detail": "文件不存在"}, status_code=404)

    filepath = VAULT_DIR / record["filename"]
    if not filepath.exists():
        return JSONResponse({"ok": False, "detail": "文件已丢失"}, status_code=404)

    disposition = "inline" if inline == "1" else "attachment"
    media_type = record.get("mime_type", "application/octet-stream")
    # 中文文件名需要 RFC 5987 编码
    from urllib.parse import quote
    encoded = quote(record["original_name"])
    headers = {"Content-Disposition": f'{disposition}; filename="{encoded}"; filename*=UTF-8\'\'{encoded}'}
    return FileResponse(filepath, media_type=media_type, headers=headers)

@router.delete("/vault/file")
async def vault_delete(id: str):
    """删除档案文件"""
    files = vault_load_manifest()
    record = next((f for f in files if f.get("id") == id), None)
    if not record:
        return {"ok": False, "detail": "文件不存在"}
    try: (VAULT_DIR / record["filename"]).unlink(missing_ok=True)
    except Exception: pass
    files = [f for f in files if f.get("id") != id]
    vault_save_manifest(files)
    return {"ok": True}

@router.put("/vault/file")
async def vault_update(request: Request):
    """编辑档案元数据（名称/分类/文号/描述），不改动文件内容本身。
    Body: { "id": "...", "original_name": "...", "category": "...", "code": "...", "desc": "..." }
    所有字段可选，只更新传入的字段。
    """
    try:
        data = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "Invalid JSON"})
    file_id = data.get("id", "")
    if not file_id:
        return {"ok": False, "detail": "缺少档案 id"}

    files = vault_load_manifest()
    record = next((f for f in files if f.get("id") == file_id), None)
    if not record:
        return {"ok": False, "detail": "档案不存在"}

    # 更新字段
    if "original_name" in data:
        new_name = str(data["original_name"]).strip()
        if new_name:
            record["original_name"] = new_name
    if "category" in data:
        cat = str(data["category"]).strip()
        valid_cats = _vault_category_names()
        record["category"] = cat if cat in valid_cats else "其他"
    if "code" in data:
        record["code"] = str(data["code"]).strip()
    if "desc" in data:
        record["desc"] = str(data["desc"]).strip()

    # 写回 manifest
    vault_save_manifest(files)
    return {"ok": True, "file": record}

@router.post("/vault/analyze")
async def vault_analyze(request: Request):
    """AI 分析档案内容（SSE 流式）
    Body: { "id": "档案id", "question": "用户提问" }
    - 文本/MD/CSV：直接读取内容交给 DeepSeek
    - 图片：base64 交给 Kimi 视觉模型
    - PDF：尝试用 Kimi 视觉（PDF 首页转图，若失败则提示）
    - Office/压缩包：提示不支持
    """
    import json as _json2
    data = await request.json()
    file_id = data.get("id", "")
    question = data.get("question", "请分析这份档案的合规要点").strip()
    if not file_id:
        return {"ok": False, "detail": "缺少档案 id"}

    files = vault_load_manifest()
    record = next((f for f in files if f.get("id") == file_id), None)
    if not record:
        return {"ok": False, "detail": "档案不存在"}
    filepath = VAULT_DIR / record["filename"]
    if not filepath.exists():
        return {"ok": False, "detail": "档案文件已丢失"}

    ext = record.get("ext", "").lower()
    is_image = ext in (".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp")
    is_text = ext in (".txt", ".md", ".csv", ".log")
    is_pdf = ext == ".pdf"

    def _sse(obj):
        return f"data: {_json2.dumps(obj, ensure_ascii=False)}\n\n"

    async def _stream():
        try:
            if is_text:
                # 文本类：直接读取内容，交给 DeepSeek
                yield _sse({"type": "progress", "step": 1, "name": "读取档案内容"})
                content = filepath.read_text(encoding="utf-8", errors="replace")
                if len(content) > 30000:
                    content = content[:30000] + "\n... [内容过长，已截断]"
                yield _sse({"type": "progress", "step": 2, "name": "AI 分析中"})
                system = "你是 EcoPilot 档案分析助手。用户正在预览一份企业环境档案，请基于档案内容回答问题或给出合规分析。档案类型：" + record.get("category", "") + "，文件名：" + record.get("original_name", "")
                stream = await ds_client.chat.completions.create(
                    model=TEXT_MODEL,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": f"档案内容：\n```\n{content}\n```\n\n用户问题：{question}"},
                    ],
                    stream=True,
                )
                async for chunk in stream:
                    delta = chunk.choices[0].delta.content if chunk.choices else ""
                    if delta:
                        yield _sse({"type": "text_delta", "text": delta})
                        await asyncio.sleep(0)
            elif is_image:
                # 图片：base64 交给 Kimi 视觉
                yield _sse({"type": "progress", "step": 1, "name": "读取图片"})
                raw = filepath.read_bytes()
                b64 = base64.b64encode(raw).decode()
                yield _sse({"type": "progress", "step": 2, "name": "AI 视觉分析中"})
                stream = await kimi_client.chat.completions.create(
                    model=KIMI_VISION_MODEL,
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": f"这是企业环境档案《{record.get('original_name','')}》。{question}"},
                            {"type": "image_url", "image_url": {"url": f"data:image/{ext[1:]};base64,{b64}"}},
                        ],
                    }],
                    stream=True,
                )
                async for chunk in stream:
                    delta = chunk.choices[0].delta.content if chunk.choices else ""
                    if delta:
                        yield _sse({"type": "text_delta", "text": delta})
                        await asyncio.sleep(0)
            elif is_pdf:
                # PDF：用 Moonshot file-extract 模式（上传文件→提取文本→DeepSeek 总结）
                yield _sse({"type": "progress", "step": 1, "name": "上传 PDF"})
                try:
                    import io as _io
                    # 1. 上传 PDF 到 Moonshot
                    upload_resp = await kimi_client.files.create(
                        file=("doc.pdf", _io.BytesIO(filepath.read_bytes()), "application/pdf"),
                        purpose="file-extract",
                    )
                    yield _sse({"type": "progress", "step": 2, "name": "提取 PDF 文本"})
                    # 2. 获取文件提取的文本内容
                    file_content = await kimi_client.files.retrieve_content(file_id=upload_resp.id)
                    # 3. 交给 DeepSeek 分析
                    yield _sse({"type": "progress", "step": 3, "name": "AI 分析中"})
                    content_text = file_content[:30000] if file_content else "（文件内容为空）"
                    stream = await ds_client.chat.completions.create(
                        model=TEXT_MODEL,
                        messages=[
                            {"role": "system", "content": f"你是 EcoPilot 档案分析助手。正在分析企业环境档案《{record.get('original_name','')}》（PDF）。请基于以下文件内容回答问题或给出合规分析。"},
                            {"role": "user", "content": f"档案内容：\n```\n{content_text}\n```\n\n用户问题：{question}"},
                        ],
                        stream=True,
                    )
                    async for chunk in stream:
                        delta = chunk.choices[0].delta.content if chunk.choices else ""
                        if delta:
                            yield _sse({"type": "text_delta", "text": delta})
                            await asyncio.sleep(0)
                except Exception as e:
                    yield _sse({"type": "text_delta", "text": f"⚠️ PDF 分析暂不可用（{e}）。您可以下载文件后在对话中上传图片让我分析，或针对文本类档案使用 AI 分析。"})
            else:
                # Office/压缩包：不支持
                yield _sse({"type": "text_delta", "text": f"⚠️ 此文件类型（{ext}）暂不支持 AI 在线分析。\n\n建议：\n1. 下载文件后转换为 PDF 或图片再上传分析\n2. 文本类档案（txt/md/csv）可直接分析\n3. 图片档案（jpg/png）可视觉识别"})
        except Exception as e:
            yield _sse({"type": "error", "detail": f"分析失败：{e}"})
        yield _sse({"type": "done"})

    return StreamingResponse(_stream(), media_type="text/event-stream")




@router.post("/vault/auto-classify")
async def vault_auto_classify(
    file: UploadFile = File(...),
):
    """AI 自动识别文件类型并归档到档案库
    接收文件 → AI 识别内容 → 自动匹配 11 类法定档案 → 归档
    SSE 事件: progress / classified / text_delta / done / error
    """
    import base64 as _b64, uuid as _uuid
    from datetime import datetime as _dt

    async def _stream():
        try:
            original_name = file.filename or "未命名文件"
            content = await file.read()
            size = len(content)

            yield _sse({"type": "progress", "text": f"正在接收文件：{original_name}（{fmt_size_py(size)}）"})

            # 校验扩展名
            ext = Path(original_name).suffix.lower()
            if ext not in ALLOWED_VAULT_EXT:
                yield _sse({"type": "error", "detail": f"不支持的文件类型：{ext}"})
                yield _sse({"type": "done"})
                return

            if size > MAX_VAULT_FILE_SIZE:
                yield _sse({"type": "error", "detail": f"文件过大（{fmt_size_py(size)}），最大支持 50MB"})
                yield _sse({"type": "done"})
                return

            yield _sse({"type": "progress", "text": "正在读取文件内容..."})

            # 提取文本内容用于 AI 识别
            file_text = ""
            try:
                if ext in [".txt", ".md", ".csv"]:
                    file_text = content.decode("utf-8", errors="ignore")[:3000]
                elif ext in [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"]:
                    file_text = "[图片文件]"
                elif ext == ".pdf":
                    file_text = "[PDF 文件]"
                else:
                    file_text = f"[{ext} 文件]"
            except Exception:
                file_text = ""

            yield _sse({"type": "progress", "text": "AI 正在智能识别文件类型和分类..."})

            # AI 识别分类
            classify_prompt = f"""你是企业环境档案管理专家。请根据文件名和内容片段，判断这个文件属于以下哪一类法定环境管理档案：

可选分类（必选其一）：
- 环评：环境影响评价报告、批复
- 验收：竣工环保验收报告
- 许可证：排污许可证
- 监测：自行监测方案、监测报告
- 应急：突发环境事件应急预案
- 清洁生产：清洁生产审核报告
- 执行报告：月报/季报/年报
- 固废：危险废物管理计划、转移联单
- 其他：不属于以上类别的文件

文件名：{original_name}
内容片段：{file_text[:500]}

请只回复一个 JSON，格式：{{"category": "分类名", "code": "文号（如有）", "desc": "一句话描述文件内容"}}"""

            ai_category = "其他"
            ai_code = ""
            ai_desc = ""
            try:
                resp = await ds_client.chat.completions.create(
                    model=TEXT_MODEL,
                    messages=[{"role": "user", "content": classify_prompt}],
                )
                text = resp.choices[0].message.content or ""
                # 解析 JSON
                import re as _re
                m = _re.search(r'\{[^}]+\}', text, _re.DOTALL)
                if m:
                    import json as _json2
                    parsed = _json2.loads(m.group(0))
                    ai_category = parsed.get("category", "其他")
                    ai_code = parsed.get("code", "")
                    ai_desc = parsed.get("desc", "")
                    # 校验分类合法性
                    if ai_category not in ["环评","验收","许可证","监测","应急","清洁生产","执行报告","固废","其他"]:
                        ai_category = "其他"
            except Exception as e:
                yield _sse({"type": "progress", "text": f"AI 识别失败，使用默认分类「其他」: {e}"})

            yield _sse({"type": "progress", "text": f"识别完成：{ai_category}"})
            yield _sse({"type": "classified", "category": ai_category, "code": ai_code, "desc": ai_desc, "filename": original_name})

            # 保存文件
            VAULT_DIR.mkdir(parents=True, exist_ok=True)
            stored_name = vault_safe_filename(original_name)
            counter = 1
            while (VAULT_DIR / stored_name).exists():
                stored_name = f"{Path(stored_name).stem}_{counter}{Path(stored_name).suffix}"
                counter += 1
            (VAULT_DIR / stored_name).write_bytes(content)

            # 写入 manifest
            files = vault_load_manifest()
            record = {
                "id": _uuid.uuid4().hex[:12],
                "filename": stored_name,
                "original_name": original_name,
                "category": ai_category,
                "code": ai_code,
                "desc": ai_desc or f"AI 智能识别归档 · {original_name}",
                "tpl_id": None,
                "upload_date": _dt.now().isoformat(timespec="seconds"),
                "size": size,
                "mime_type": EXT_MIME.get(ext, "application/octet-stream"),
                "ext": ext,
            }
            files.append(record)
            vault_save_manifest(files)

            yield _sse({"type": "progress", "text": f"已归档到「{ai_category}」分类"})
            yield _sse({"type": "done", "file": record})

        except Exception as e:
            yield _sse({"type": "error", "detail": f"智能识别失败：{e}"})
            yield _sse({"type": "done"})

    return StreamingResponse(_stream(), media_type="text/event-stream")


def fmt_size_py(n: int) -> str:
    """字节数转人类可读"""
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n / 1024 / 1024:.1f} MB"
