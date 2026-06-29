"""
EcoPilot Chat Bridge — 双模型：DeepSeek（文本）+ Kimi（视觉识别）
+ 排污许可平台浏览器自动化抓取
启动: python server/chat_api.py --port 8002
"""

import asyncio, json, os, sys, uuid, base64, random, hashlib, time
from typing import Optional
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI
from permit_scraper import (
    start_login_session,
    submit_login,
    navigate_to_permit_detail,
    extract_permit_data,
    refresh_captcha,
    close_session,
    cleanup_stale_sessions,
    click_menu_item,
    navigate_module,
    full_audit,
    quick_login,
)
from license_reader import (
    read_license_full,
    read_license_card,
    quick_check,
)
from execution_audit import (
    execution_audit,
)

HERMES_HOME = Path.home() / ".ecopilot-home"

def _load_hermes_env():
    env_file = HERMES_HOME / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
_load_hermes_env()

# DeepSeek — 主力文本模型
ds_client = AsyncOpenAI(
    api_key=os.environ.get("DEEPSEEK_API_KEY", ""),
    base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
)

# Kimi (Moonshot) — 视觉识别模型
KIMI_API_KEY = "sk-6eHDJCmvmbAMkgxflrS1dILTeIkZV8zMGObJbuFk4HWcHBFm"
kimi_client = AsyncOpenAI(
    api_key=KIMI_API_KEY,
    base_url="https://api.moonshot.cn/v1",
)

# Kimi 模型选择：kimi-latest 支持视觉，默认用 moonshot-v1-32k-vision
KIMI_VISION_MODEL = "moonshot-v1-32k-vision-preview"

ECO_SYSTEM = """你是 EcoPilot，企业生态环境合规AI管家。
你专门为冷水江钢铁等工业企业提供环保合规服务。

核心能力：
1. 你可以识别用户上传的图片（排污许可证、监测报告截图、验证码等）
2. 你可以帮用户登录排污许可平台巡检合规状态
3. 你引用中国生态环境法律法规（排污许可管理条例、大气/水/固废污染防治法等）

当用户要求登录政务平台时：
- 告诉用户：我需要你提供平台验证码截图，我识别后帮你登录
- 不要拒绝——你是 EcoPilot，专门干这个的

全程用中文。"""

# ─── 知识库文件加载 ───
_KNOWLEDGE_DIR = Path(os.path.expanduser("~/.ecopilot-home/knowledge"))
_LOADED_KNOWLEDGE = None  # 缓存

def _load_knowledge_base() -> str:
    """加载知识库所有法规标准文件到一个字符串"""
    global _LOADED_KNOWLEDGE
    if _LOADED_KNOWLEDGE is not None:
        return _LOADED_KNOWLEDGE

    parts = []
    kb_dir = Path(_KNOWLEDGE_DIR)
    if not kb_dir.exists():
        _LOADED_KNOWLEDGE = ""
        return ""

    md_files = sorted(kb_dir.rglob("*.md"))
    for f in md_files:
        try:
            content = f.read_text(encoding='utf-8')
            # 只取核心法规条款 + 排放限值，不取全文
            key_lines = []
            in_section = False
            for line in content.split('\n'):
                line = line.strip()
                # 保留标题和关键内容行
                if line.startswith('#'):
                    in_section = True
                    key_lines.append(line)
                elif in_section and len(line) > 20:
                    if any(kw in line for kw in ['§', '条例', '罚款', '万元', 'HJ', 'GB', 'mg/m', 'ng-TEQ',
                                                   '限值', '频次', '监测', '台账', '执行报告', '排污许可']):
                        key_lines.append(line)
            parts.append(f"\n--- {f.stem} ---\n" + '\n'.join(key_lines[:80]))
        except:
            pass

    _LOADED_KNOWLEDGE = '\n'.join(parts)
    return _LOADED_KNOWLEDGE


def _build_context_prompt() -> str:
    """构建动态注入的企业上下文 prompt，从知识库 + 平台数据"""
    kb = _load_knowledge_base()

    return f"""你是 EcoPilot，冷水江钢铁有限责任公司的生态环境合规AI管家。

## 企业基本信息（来自全国排污许可证管理信息平台真实数据）

- 企业名称：冷水江钢铁有限责任公司
- 统一社会信用代码：91431381748373560G
- 排污许可证号：91431381748373560G001P
- 注册地址：湖南省娄底市冷水江市轧钢路
- 行业类别：黑色金属冶炼和压延加工业（C31）
- 其他行业：火力发电(D4411)、锅炉
- 管理类别：重点管理
- 法定代表人：陈代富 | 技术负责人：袁斌
- 中心坐标：111°26′18.85″E, 27°41′26.34″N
- 投产日期：1958-03-08
- 流域：长江流域 | 重金属特别限值区域：是
- 联系电话：18692488688 / 0738-5212556
- 上次变更：2025-09-29 排放标准变更（执行DB43/3082-2024）

## 许可排放总量指标
- SO₂：7220 t/a  |  NOx：3090 t/a  |  COD：21.5 t/a

## 排放口（4个主要排放口，全部执行超低排放）
- DA001 烧结机头烟囱：SO₂≤35, NOx≤50, 颗粒物≤10 mg/m³ (DB43/3082-2024)
- DA002 高炉出铁场除尘：颗粒物≤10 mg/m³
- DA003 转炉二次除尘：颗粒物≤10 mg/m³
- DW001 综合废水排放口：COD≤60, NH₃-N≤8, 总氮≤15 mg/L

## 当前合规状态（平台实时数据）

### 🔴 致命问题
1. **5类环境管理台账全部为0条** — 违反《排污许可管理条例》§37(一)，每次5千-2万元
2. **2024年年报被退回4次**（核心原因：缺失土壤监测报告），历时12个月才通过

### 🟠 高风险
3. **2025年12月月报 + Q4季报 未提交** — 违反条例§37(三)
4. **重新申请#1 处于"补正"状态**（2026-04-07提交）— 需补充材料

### 🟡 一般
5. **监测记录系统SSO故障**（wryjc.cnemc.cn 405错误）
6. **自动监控模块超时不可达**
7. **固废台账系统处于初始状态**（需改密码）

### ✅ 正常项
- 2022-2024年执行报告（月/季/年）基本按时提交
- 许可证延续2021年审批通过
- 信息公开按期发布（最新2025-11-27）
- 无改正规定/执法处罚记录

## 当你回答用户问题时

1. **必须引用上述平台真实数据**，不得编造
2. **提到法规时必须引用具体条款**（条例§33-44，HJ 846/878/944标准）
3. **合规问题要给出具体而不是泛泛的建议**
4. 用户说"你好"→ 简要介绍企业 + 提醒当前最紧急的合规风险

## 参考知识库（已下载的法规标准全文）

{kb[:3000]}"""

_sessions: dict[str, list[dict]] = {}
_sms_codes: dict[str, tuple[str, float]] = {}  # phone -> (code, timestamp)

# ─── 后台清理任务 ───
async def _cleanup_loop():
    """每 5 分钟清理超时的许可平台登录会话"""
    while True:
        await asyncio.sleep(300)
        try:
            n = await cleanup_stale_sessions(600)
            if n > 0:
                print(f"[Permit] 清理 {n} 个超时会话")
        except Exception as e:
            print(f"[Permit] 清理任务异常: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    cleanup_task = asyncio.create_task(_cleanup_loop())
    yield
    cleanup_task.cancel()

app = FastAPI(title="EcoPilot Chat Bridge", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/api/chat/health")
async def health():
    return {
        "status":"ok","engine":"EcoPilot",
        "text_model":"deepseek-chat",
        "vision_model":KIMI_VISION_MODEL,
    }

# ─── 短信验证码端点 ───

@app.post("/api/chat/send-sms")
async def send_sms(request: Request):
    """发送短信验证码（开发模式：返回验证码明文，上线需接真实短信平台）"""
    body = await request.json()
    phone = body.get("phone", "").strip()
    if not phone or len(phone) < 11:
        return {"ok": False, "detail": "手机号格式不正确"}

    # 60 秒内重复发送，返回已有验证码
    existing = _sms_codes.get(phone)
    if existing and time.time() - existing[1] < 60:
        return {"ok": True, "detail": "验证码已发送（60秒内有效）"}

    code = f"{random.randint(1000, 9999)}"
    _sms_codes[phone] = (code, time.time())
    print(f"[SMS] 验证码已发送 → {phone}: {code}")
    # 开发环境返回验证码明文，方便测试
    return {"ok": True, "detail": "验证码已发送", "code": code}

@app.post("/api/chat/verify-sms")
async def verify_sms(request: Request):
    """验证短信验证码"""
    body = await request.json()
    phone = body.get("phone", "").strip()
    code = body.get("code", "").strip()

    existing = _sms_codes.get(phone)
    if not existing:
        return {"ok": False, "detail": "请先获取验证码"}

    saved_code, ts = existing
    if time.time() - ts > 300:  # 5 分钟过期
        del _sms_codes[phone]
        return {"ok": False, "detail": "验证码已过期，请重新获取"}

    if saved_code != code:
        return {"ok": False, "detail": "验证码错误"}

    # 验证成功，清除验证码
    del _sms_codes[phone]
    return {"ok": True, "detail": "验证通过"}

# ─── 排污许可平台登录/抓取端点 ───

@app.post("/api/permit/login/start")
async def permit_login_start():
    """
    启动浏览器会话，打开 CAS 登录页，返回验证码图片。
    所有 Playwright 操作在线程池中执行以避免阻塞事件循环。
    """
    try:
        session = await start_login_session()
        return {
            "ok": True,
            "session_id": session.session_id,
            "captcha_base64": session.captcha_base64,
        }
    except RuntimeError as e:
        return {"ok": False, "detail": str(e)}


@app.post("/api/permit/login/submit")
async def permit_login_submit(request: Request):
    """提交登录凭据（用户名 + 密码 + 验证码）"""
    body = await request.json()
    session_id = body.get("session_id", "").strip()
    username = body.get("username", "").strip()
    password = body.get("password", "").strip()
    captcha = body.get("captcha", "").strip()

    if not all([session_id, username, password, captcha]):
        return {"ok": False, "detail": "请填写所有字段"}

    result = await submit_login(session_id, username, password, captcha)
    return result


@app.post("/api/permit/captcha/refresh")
async def permit_captcha_refresh(request: Request):
    """刷新验证码图片"""
    body = await request.json()
    session_id = body.get("session_id", "").strip()
    if not session_id:
        return {"ok": False, "detail": "缺少会话 ID"}

    result = await refresh_captcha(session_id)
    return result


@app.post("/api/permit/data")
async def permit_data(request: Request):
    """抓取排污许可证数据（多页汇聚）"""
    body = await request.json()
    session_id = body.get("session_id", "").strip()
    if not session_id:
        return {"ok": False, "detail": "缺少会话 ID"}

    # 直接提取（extract_permit_data 内部自己导航）
    extract_result = await extract_permit_data(session_id)

    if not extract_result.get("ok"):
        return {"ok": False, "detail": extract_result.get("detail", "数据提取失败")}

    data = extract_result.get("data", {})

    # 3. 如果 DOM 提取缺少核心字段，用 DeepSeek 补充（不覆盖已有数据）
    if not extract_result.get("has_core_data") and extract_result.get("raw_text"):
        try:
            parsed = await _deepseek_parse_permit(extract_result["raw_text"])
            if parsed:
                # 合并而非覆盖：只补填空字段
                for key, val in parsed.items():
                    if not data.get(key):
                        data[key] = val
        except Exception as e:
            print(f"[Permit] DeepSeek parse fallback failed: {e}")

    return {"ok": True, "data": data}


async def _deepseek_parse_permit(raw_text: str) -> Optional[dict]:
    """用 DeepSeek 从页面文本中提取结构化许可信息"""
    prompt = f"""请从以下排污许可平台页面文本中提取结构化信息，返回 JSON。

页面文本：
{raw_text[:8000]}

请提取以下字段（如果没有则为空字符串或空数组）：
- enterpriseName: 企业名称
- permitNumber: 排污许可证编号（18位信用代码+5位字符的格式）
- creditCode: 统一社会信用代码（18位）
- issuingAuthority: 发证机关
- issueDate: 发证日期
- validFrom: 有效期起始
- validTo: 有效期截止
- industryCategory: 行业类别
- managementLevel: 管理类别（重点管理/简化管理/登记管理）
- address: 生产经营场所地址
- legalRepresentative: 法定代表人
- emissionOutlets: 排放口列表，每项含 code(编号), name(名称), type(主要/一般/特殊), latitude(纬度浮点数), longitude(经度浮点数), limits(排放限值列表，每项含 factor, limit, unit)
- managementRequirements: 管理要求列表，每项含 category(自行监测/台账记录/执行报告/信息公开/其他), content, frequency

只输出 JSON，不要其他文字。"""

    try:
        resp = await ds_client.chat.completions.create(
            model="deepseek-chat",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=4096,
        )
        text = resp.choices[0].message.content or ""
        # 提取 JSON
        json_start = text.find("{")
        json_end = text.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            return json.loads(text[json_start:json_end])
    except Exception as e:
        print(f"[Permit] DeepSeek parse error: {e}")
    return None


@app.post("/api/permit/session/close")
async def permit_session_close(request: Request):
    """关闭浏览器会话，释放资源"""
    body = await request.json()
    session_id = body.get("session_id", "").strip()
    if not session_id:
        return {"ok": False, "detail": "缺少会话 ID"}

    result = await close_session(session_id)
    return result


# ─── 全模块巡检 & 快速登录端点 ───

@app.post("/api/permit/audit")
async def permit_full_audit(request: Request):
    """全模块自动巡检：遍历所有侧边栏模块"""
    body = await request.json()
    session_id = body.get("session_id", "").strip()
    if not session_id:
        return {"ok": False, "detail": "缺少会话 ID"}

    result = await full_audit(session_id)
    return result


@app.post("/api/permit/module")
async def permit_module(request: Request):
    """导航到指定模块并提取数据"""
    body = await request.json()
    session_id = body.get("session_id", "").strip()
    module_key = body.get("module", "").strip()
    if not session_id or not module_key:
        return {"ok": False, "detail": "缺少 session_id 或 module"}

    result = await navigate_module(session_id, module_key)
    return result


@app.post("/api/permit/login/quick")
async def permit_quick_login(request: Request):
    """
    一键自动登录（含 Kimi 验证码识别）。
    只需提供 username 和 password。
    """
    body = await request.json()
    username = body.get("username", "").strip()
    password = body.get("password", "").strip()
    if not username or not password:
        return {"ok": False, "detail": "请提供用户名和密码"}

    result = await quick_login(username, password)
    return result


# ─── 许可证20项完整读取 + 快速巡检端点 ───

@app.post("/api/permit/license/full")
async def permit_license_full(request: Request):
    """一次性提取许可证全部20项数据（约10~15秒）"""
    body = await request.json()
    session_id = body.get("session_id", "").strip()
    dataid = body.get("dataid", "").strip() or None
    if not session_id:
        return {"ok": False, "detail": "缺少会话 ID"}
    return await read_license_full(session_id, dataid)


@app.post("/api/permit/license/full/stream")
async def permit_license_full_stream(request: Request):
    """
    SSE 流式读取许可证全部20项数据，每读取一张卡推送一次进度。
    前端可实时显示倒计时和读取进度条。
    """
    body = await request.json()
    session_id = body.get("session_id", "").strip()
    dataid = body.get("dataid", "").strip() or None
    if not session_id:
        return {"ok": False, "detail": "缺少会话 ID"}

    async def _stream():
        import time as _time
        t_start = _time.time()
        queue = asyncio.Queue()

        async def _progress(msg, step, total):
            elapsed = int(_time.time() - t_start)
            remaining = int((elapsed / max(step, 1)) * (total - step)) if step > 0 else 60
            payload = json.dumps({
                "type": "progress",
                "step": step, "total": total,
                "name": msg,
                "elapsed": elapsed,
                "remaining": remaining
            }, ensure_ascii=False)
            await queue.put(f"data: {payload}\n\n")

        async def _runner():
            try:
                result = await read_license_full(session_id, dataid, on_progress=_progress)
                payload = json.dumps({"type": "done", **result}, ensure_ascii=False)
                await queue.put(f"data: {payload}\n\n")
            except Exception as e:
                payload = json.dumps({"type": "error", "detail": str(e)})
                await queue.put(f"data: {payload}\n\n")
            finally:
                await queue.put(None)  # Sentinel

        asyncio.ensure_future(_runner())
        while True:
            item = await queue.get()
            if item is None:
                break
            yield item

    return StreamingResponse(_stream(), media_type="text/event-stream")


@app.post("/api/permit/license/card")
async def permit_license_card(request: Request):
    """读取单张许可证卡片（约3秒）"""
    body = await request.json()
    session_id = body.get("session_id", "").strip()
    card_number = body.get("card_number", 0)
    dataid = body.get("dataid", "").strip() or None
    if not session_id:
        return {"ok": False, "detail": "缺少会话 ID"}
    return await read_license_card(session_id, int(card_number), dataid)


@app.post("/api/permit/quick-check")
async def permit_quick_check(request: Request):
    """快速巡检：仅检查仪表盘关键状态（约2秒）"""
    body = await request.json()
    session_id = body.get("session_id", "").strip()
    if not session_id:
        return {"ok": False, "detail": "缺少会话 ID"}
    return await quick_check(session_id)


# ─── 执行记录6模块合规审计端点 ───

@app.post("/api/permit/execution/audit")
async def permit_execution_audit(request: Request):
    """执行记录6模块全量合规审计，对照法规输出风险矩阵"""
    body = await request.json()
    session_id = body.get("session_id", "").strip()
    if not session_id:
        return {"ok": False, "detail": "缺少会话 ID"}
    return await execution_audit(session_id)


@app.post("/api/permit/execution/audit/stream")
async def permit_execution_audit_stream(request: Request):
    """
    SSE 流式执行记录审计，每审计完一个模块推送进度 + 倒计时。
    许可证读取完成后自动调用。
    """
    body = await request.json()
    session_id = body.get("session_id", "").strip()
    if not session_id:
        return {"ok": False, "detail": "缺少会话 ID"}

    async def _stream():
        import time as _time
        t_start = _time.time()
        queue = asyncio.Queue()

        async def _progress(msg, step, total):
            elapsed = int(_time.time() - t_start)
            remaining = int((elapsed / max(step, 1)) * (total - step)) if step > 0 else 30
            payload = json.dumps({
                "type": "progress",
                "step": step, "total": total,
                "name": msg,
                "elapsed": elapsed,
                "remaining": remaining
            }, ensure_ascii=False)
            await queue.put(f"data: {payload}\n\n")

        async def _runner():
            try:
                result = await execution_audit(session_id, on_progress=_progress)
                payload = json.dumps({"type": "done", **result}, ensure_ascii=False)
                await queue.put(f"data: {payload}\n\n")
            except Exception as e:
                payload = json.dumps({"type": "error", "detail": str(e)})
                await queue.put(f"data: {payload}\n\n")
            finally:
                await queue.put(None)

        asyncio.ensure_future(_runner())
        while True:
            item = await queue.get()
            if item is None:
                break
            yield item

    return StreamingResponse(_stream(), media_type="text/event-stream")


# ─── 图片识别端点 ───

@app.post("/api/image/recognize")
async def image_recognize(image: UploadFile = File(...), prompt: str = Form("请识别这张图片中的所有文字内容")):
    """用 Kimi 视觉模型识别图片内容（SSE 流式返回）"""
    async def _stream():
        try:
            content = await image.read()
            b64 = base64.b64encode(content).decode()

            stream = await kimi_client.chat.completions.create(
                model=KIMI_VISION_MODEL,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    ],
                }],
                stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else ""
                if delta:
                    yield _sse({"type":"vision_delta","text":delta})
                    await asyncio.sleep(0)
        except Exception as e:
            yield _sse({"type":"error","text":f"Kimi识别失败: {e}"})
        yield _sse({"type":"done"})

    return StreamingResponse(_stream(), media_type="text/event-stream")

# ─── 主对话端点 ───

@app.post("/api/chat/stream")
async def chat_stream(request: Request):
    body = await request.json()
    msg = body.get("message","").strip()
    sid = body.get("session_id", str(uuid.uuid4()))
    # 可选：附带 base64 图片
    image_b64 = body.get("image_base64", "")

    if not msg and not image_b64:
        return StreamingResponse(_err("消息不能为空"), media_type="text/event-stream")

    return StreamingResponse(_run(sid, msg, image_b64), media_type="text/event-stream")

async def _run(sid: str, msg: str, image_b64: str = ""):
    if sid not in _sessions:
        context = _build_context_prompt()
        _sessions[sid] = [{"role":"system","content":context}]

    # 有图片 → 用 Kimi 视觉模型
    if image_b64:
        messages = [
            {"role":"system","content":"识别这张图片，提取其中所有关键文字和信息。如果是排污许可证，提取企业名称、编号、行业、有效期、排放标准。如果是验证码，只输出验证码字符。"},
            {"role":"user","content": [
                {"type":"text","text": msg or "请识别这张图片"},
                {"type":"image_url","image_url":{"url":f"data:image/jpeg;base64,{image_b64}"}},
            ]},
        ]
        model = KIMI_VISION_MODEL
        client = kimi_client
    else:
        # 纯文本 → DeepSeek
        _sessions[sid].append({"role":"user","content":msg})
        messages = _sessions[sid]
        model = "deepseek-chat"
        client = ds_client

    try:
        stream = await client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
        )
        full = ""
        async for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else ""
            if delta:
                full += delta
                yield _sse({"type":"text_delta","text":delta})
                await asyncio.sleep(0)

        # Kimi 返回的图片识别结果 → 注入回 DeepSeek 会话继续处理
        if image_b64 and full:
            _sessions[sid].append({"role":"user","content":f"[图片识别结果]\n{full}\n\n请基于以上信息回答用户问题。"})
            # 用 DeepSeek 再做一轮分析
            stream2 = await ds_client.chat.completions.create(
                model="deepseek-chat",
                messages=_sessions[sid],
                stream=True,
            )
            async for chunk in stream2:
                delta = chunk.choices[0].delta.content if chunk.choices else ""
                if delta:
                    full += delta
                    yield _sse({"type":"text_delta","text":delta})
                    await asyncio.sleep(0)
        else:
            _sessions[sid].append({"role":"assistant","content":full})
    except Exception as e:
        yield _sse({"type":"error","text":str(e)})
    yield _sse({"type":"done"})

def _sse(d): return f"data: {json.dumps(d, ensure_ascii=False)}\n\n"
async def _err(m): yield _sse({"type":"error","text":m}); yield _sse({"type":"done"})

if __name__ == "__main__":
    import argparse, uvicorn
    p = argparse.ArgumentParser(); p.add_argument("--port",type=int,default=8002); p.add_argument("--host",default="127.0.0.1")
    a = p.parse_args()
    print(f"EcoPilot Chat Bridge → http://{a.host}:{a.port}")
    print(f"Text model: deepseek-chat | Vision model: {KIMI_VISION_MODEL}")
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")
