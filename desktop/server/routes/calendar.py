"""
EcoPilot 合规日历/日程/台账 API

提取自 chat_api.py (v1.1)
"""

import json as _json
import time as _time
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from logging_config import get_logger
from core.config import HERMES_HOME

_log = get_logger("calendar")

router = APIRouter(prefix="/api", tags=["calendar"])

# ── 内联工具 ──

def _load_json_dict(filename: str) -> dict:
    import json as _j
    fpath = HERMES_HOME / filename
    if fpath.exists():
        try: return _j.loads(fpath.read_text())
        except: pass
    return {}

def _save_json_dict(filename: str, data: dict):
    import json as _j
    HERMES_HOME.mkdir(parents=True, exist_ok=True)
    tmp = HERMES_HOME / f".{filename}.tmp"
    tmp.write_text(_j.dumps(data, ensure_ascii=False, indent=2))
    tmp.replace(HERMES_HOME / filename)

async def _parse_json(request: Request):
    try:
        return await request.json(), None
    except:
        from fastapi.responses import JSONResponse as JR
        return None, JR(status_code=400, content={"ok": False, "detail": "JSON parse failed"})

# ─── 日历/日程/台账 API ───

_calendar_tasks: dict[str, list[dict]] = _load_json_dict("calendar_tasks.json")  # {enterprise_id: [tasks]}

def _save_calendar_tasks():
    _save_json_dict("calendar_tasks.json", _calendar_tasks)

@router.post("/calendar/tasks")
async def calendar_tasks(request: Request):
    """获取或创建日历任务
    POST {action: 'list'|'add'|'remove'|'suggest'}
    """
    body, err = await _parse_json(request)
    if err is not None: return err
    action = body.get("action", "list")

    if action == "suggest":
        # AI 建议日程：根据许可证数据生成建议任务列表
        enterprise = body.get("enterprise", {})
        permit_data = body.get("permitData", {})
        suggestions = _suggest_schedule_tasks(enterprise, permit_data)
        return {"ok": True, "suggestions": suggestions}

    if action == "add":
        task = body.get("task", {})
        eid = body.get("enterpriseId", "default")
        tasks = _calendar_tasks.setdefault(eid, [])
        task["id"] = f"sch-{int(time.time())}-{random.randint(1000, 9999)}"
        task["createdAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        tasks.append(task)
        return {"ok": True, "task": task}

    if action == "remove":
        eid = body.get("enterpriseId", "default")
        tid = body.get("taskId", "")
        tasks = _calendar_tasks.get(eid, [])
        _calendar_tasks[eid] = [t for t in tasks if t.get("id") != tid]
        return {"ok": True}

    # list — 返回所有任务
    eid = body.get("enterpriseId", "default")
    return {"ok": True, "tasks": _calendar_tasks.get(eid, [])}


def _suggest_schedule_tasks(enterprise: dict, permit_data: dict) -> list[dict]:
    """根据许可证数据生成 AI 建议的日程任务"""
    tasks = []
    today = time.strftime("%Y-%m-%d")

    # 1. 许可证到期提醒（到期前 30 天）
    valid_to = permit_data.get("validTo", "")
    if valid_to:
        try:
            from datetime import datetime, timedelta
            vt = datetime.strptime(valid_to[:10], "%Y-%m-%d")
            days_left = (vt - datetime.now()).days
            if 0 < days_left <= 90:
                tasks.append({
                    "title": "排污许可证到期",
                    "description": f"许可证将于 {valid_to[:10]} 到期，剩余 {days_left} 天。请尽快启动延续程序。",
                    "date": valid_to[:10],
                    "repeat": "once",
                    "color": "#dc2626",
                    "source": "system",
                    "category": "permit_expiry",
                })
        except Exception: pass

    # 2. 执行报告截止日
    report_due = [
        (f"{today[:4]}-03-31", "Q1执行报告", "monthly"),
        (f"{today[:4]}-06-30", "Q2执行报告", "monthly"),
        (f"{today[:4]}-09-30", "Q3执行报告", "monthly"),
        (f"{today[:4]}-12-31", "Q4执行报告", "monthly"),
        (f"{int(today[:4])+1}-01-31", "年度执行报告", "annual"),
    ]
    for date, title, freq in report_due:
        if date > today:
            tasks.append({
                "title": title,
                "description": f"执行报告提交截止日：{date}（HJ 944 第5.4节）",
                "date": date,
                "repeat": "once",
                "color": "#d97706",
                "source": "system",
                "category": "report_due",
            })

    # 3. 台账每周检查提醒
    tasks.append({
        "title": "台账记录周检",
        "description": "检查5类台账本周是否全部记录完毕（HJ 944 第4.3节）。生产设施/治污设施按日记录，原辅材料按批次，固废每次发生，监测每次后。",
        "date": today,
        "repeat": "weekly",
        "color": "#059669",
        "source": "system",
        "category": "ledger_weekly",
    })

    # 4. 应急预案年度演练
    tasks.append({
        "title": "应急预案年度演练",
        "description": "按《突发环境事件应急管理办法》要求每年至少一次实战演练",
        "date": f"{today[:4]}-09-01",
        "repeat": "annual",
        "color": "#7c3aed",
        "source": "system",
        "category": "emergency_drill",
    })

    # 5. 信息公开
    tasks.append({
        "title": "环境信息公开",
        "description": "按规定公开企业环境信息（基础信息/排放信息/固废信息/应急信息）",
        "date": f"{today[:4]}-06-30",
        "repeat": "annual",
        "color": "#0891b2",
        "source": "system",
        "category": "info_disclosure",
    })

    return tasks


@router.post("/calendar/ledger")
async def calendar_ledger(request: Request):
    """台账记录管理
    POST {action: 'list'|'update'}
    """
    body, err = await _parse_json(request)
    if err is not None: return err
    action = body.get("action", "list")

    if action == "update":
        ledger_type = body.get("type", "")
        status = body.get("status", "missing")
        return {"ok": True, "type": ledger_type, "status": status}

    # 返回5类台账的模板信息
    return {
        "ok": True,
        "ledgers": [
            {"type": "production", "label": "生产设施运行状况", "freq": "按日/班次", "rule": "HJ 944 第4.3节"},
            {"type": "treatment", "label": "治污设施运行情况", "freq": "按日/班次", "rule": "HJ 944 第4.3节"},
            {"type": "materials", "label": "原辅材料及燃料消耗", "freq": "按批次", "rule": "HJ 944 第4.3节"},
            {"type": "solid_waste", "label": "固废产生与处置", "freq": "每次发生", "rule": "HJ 944 第4.3节"},
            {"type": "monitoring", "label": "自行监测结果", "freq": "按监测频次", "rule": "HJ 944 第4.3节"},
        ],
    }

# ─── 合规日历模板系统 + 文档处理 API ───

# 内存中存储用户编辑的文档（服务重启后丢失，前端 localStorage 做主存储）
_calendar_docs: dict[str, dict] = _load_json_dict("calendar_docs.json")  # {docId: ...}

def _save_calendar_docs():
    _save_json_dict("calendar_docs.json", _calendar_docs)

# 合规工作流模板库（台账/监测/报告，含 Markdown 占位符供 AI 填充）
_CALENDAR_TEMPLATES: list[dict] = [
    {
        "id": "tpl-ledger-production",
        "name": "生产设施运行台账",
        "category": "ledger",
        "description": "记录生产设施每日运行时长、停机原因、运行状态，依据 HJ 944 第4.3节。",
        "icon": "Factory",
        "content": """# 生产设施运行台账

> 依据：HJ 944《排污单位自行监测技术指南 总则》第4.3节

- **企业名称**：{{enterprise_name}}
- **排污许可证编号**：{{permit_number}}
- **记录日期**：{{date}}
- **记录人**：{{operator}}

## 运行记录

| 序号 | 设施名称 | 规格型号 | 开始时间 | 结束时间 | 运行时长(h) | 运行状态 | 停机原因 |
|------|----------|----------|----------|----------|-------------|----------|----------|
| 1 | {{facility_name}} | {{model}} | {{start_time}} | {{end_time}} | {{duration}} | 正常/异常 | {{downtime_reason}} |

## 备注事项

{{remarks}}

> 提示：生产设施运行状况应按日或按班次记录，异常停机须在备注中详细说明原因及处置情况。
""",
    },
    {
        "id": "tpl-ledger-treatment",
        "name": "治污设施运行台账",
        "category": "ledger",
        "description": "记录治污设施处理效率、药剂消耗及异常情况，依据 HJ 944 第4.3节。",
        "icon": "Recycle",
        "content": """# 治污设施运行台账

> 依据：HJ 944《排污单位自行监测技术指南 总则》第4.3节

- **企业名称**：{{enterprise_name}}
- **排污许可证编号**：{{permit_number}}
- **记录日期**：{{date}}
- **记录人**：{{operator}}

## 运行记录

| 序号 | 设施名称 | 处理工艺 | 处理量(t/d) | 处理效率(%) | 药剂名称 | 药剂消耗(kg) | 是否正常 | 异常记录 |
|------|----------|----------|-------------|-------------|----------|--------------|----------|----------|
| 1 | {{facility_name}} | {{process}} | {{capacity}} | {{efficiency}} | {{reagent}} | {{reagent_amount}} | 正常/异常 | {{anomaly}} |

## 异常处置

{{anomaly_handling}}

> 提示：治污设施异常停运或效率下降时，应在 24 小时内启动应急处置并报告生态环境主管部门。
""",
    },
    {
        "id": "tpl-ledger-materials",
        "name": "原辅材料消耗台账",
        "category": "ledger",
        "description": "记录原辅材料及燃料消耗、批次与库存，依据 HJ 944 第4.3节。",
        "icon": "PackageOpen",
        "content": """# 原辅材料消耗台账

> 依据：HJ 944《排污单位自行监测技术指南 总则》第4.3节

- **企业名称**：{{enterprise_name}}
- **排污许可证编号**：{{permit_number}}
- **记录日期**：{{date}}
- **记录人**：{{operator}}

## 消耗记录

| 序号 | 材料名称 | 规格/型号 | 批次号 | 采购量(t) | 消耗量(t) | 库存量(t) | 用途 | 备注 |
|------|----------|-----------|--------|-----------|-----------|-----------|------|------|
| 1 | {{material_name}} | {{spec}} | {{batch}} | {{purchased}} | {{consumed}} | {{stock}} | {{usage}} | {{remarks}} |

> 提示：原辅材料按批次记录，有毒有害物料消耗须与产排污节点对应。
""",
    },
    {
        "id": "tpl-ledger-solid-waste",
        "name": "固废产生处置台账",
        "category": "ledger",
        "description": "记录固废类型、产生量、处置方式及处置量，依据 HJ 944 第4.3节 及《固废法》。",
        "icon": "Trash2",
        "content": """# 固废产生与处置台账

> 依据：HJ 944《排污单位自行监测技术指南 总则》第4.3节、《固废法》

- **企业名称**：{{enterprise_name}}
- **排污许可证编号**：{{permit_number}}
- **记录日期**：{{date}}
- **记录人**：{{operator}}

## 固废记录

| 序号 | 固废类型 | 类别(危/一/二) | 产生量(t) | 综合利用量(t) | 处置量(t) | 处置方式 | 接收单位 | 转移联单号 |
|------|----------|----------------|-----------|----------------|-----------|----------|----------|------------|
| 1 | {{waste_type}} | {{category}} | {{produced}} | {{reused}} | {{disposed}} | {{method}} | {{receiver}} | {{manifest_no}} |

## 合规说明

{{compliance_notes}}

> 提示：危险废物须填写转移联单并纳入国家固废管理信息系统；处置方式须符合许可证要求。
""",
    },
    {
        "id": "tpl-monitor-self",
        "name": "自行监测记录表",
        "category": "monitor",
        "description": "记录监测点位、监测因子、频次与结果，依据 HJ 944 及行业自行监测技术指南。",
        "icon": "Activity",
        "content": """# 自行监测记录表

> 依据：HJ 944《排污单位自行监测技术指南 总则》及行业自行监测技术指南

- **企业名称**：{{enterprise_name}}
- **排污许可证编号**：{{permit_number}}
- **监测日期**：{{date}}
- **监测类型**：{{monitor_type}}（手工/自动）

## 监测结果

| 序号 | 监测点位 | 监测因子 | 单位 | 频次 | 实测值 | 标准限值 | 是否达标 | 备注 |
|------|----------|----------|------|------|--------|----------|----------|------|
| 1 | {{point}} | {{factor}} | {{unit}} | {{frequency}} | {{measured}} | {{limit}} | 是/否 | {{remarks}} |

## 异常说明

{{anomaly_notes}}

> 提示：监测结果超标时，须在 24 小时内向生态环境主管部门报告并查明原因。
""",
    },
    {
        "id": "tpl-report-quarterly",
        "name": "季度执行报告",
        "category": "report",
        "description": "季度排污许可证执行报告，数据来源于本季度3个月的月度执行报告和台账记录汇总。每季度结束后15日内提交。",
        "icon": "FileText",
        "content": """# 排污许可证季度执行报告

> 依据：HJ 944《排污单位自行监测技术指南 总则》第5.4节、《排污许可管理办法》

## 一、企业基本信息

- **企业名称**：{{enterprise_name}}
- **统一社会信用代码**：{{credit_code}}
- **排污许可证编号**：{{permit_number}}
- **报告周期**：{{period}}（{{date}}）

## 二、排污情况

### 2.1 排放口情况

{{outfall_summary}}

### 2.2 排放情况

| 排放口 | 主要污染物 | 许可排放量(t) | 实际排放量(t) | 是否达标 |
|--------|------------|----------------|----------------|----------|
| {{outfall}} | {{pollutant}} | {{permitted}} | {{actual}} | 是/否 |

## 三、合规分析

{{compliance_analysis}}

## 四、存在的主要问题

{{issues}}

## 五、整改措施

| 问题描述 | 整改措施 | 责任人 | 完成时限 |
|----------|----------|--------|----------|
| {{issue}} | {{measure}} | {{owner}} | {{deadline}} |

## 六、其他事项

{{others}}

> 提示：季度执行报告应于每季度结束后 30 日内提交至全国排污许可证管理信息平台。
""",
    },
    {
        "id": "tpl-report-monthly",
        "name": "月度执行报告",
        "category": "report",
        "description": "月度排污许可证执行报告，数据来源于当月5类台账记录汇总。重点管理企业每月10日前提交。",
        "icon": "FileText",
        "content": """# 排污许可证月度执行报告

> 依据：HJ 944-2018《排污单位自行监测技术指南 总则》第5.4节、《排污许可管理条例》第22条
> **数据来源**：本月生产设施运行台账 + 治污设施运行台账 + 原辅材料消耗台账 + 固废产生处置台账 + 自行监测记录

## 一、企业基本信息

- **企业名称**：{{enterprise_name}}
- **统一社会信用代码**：{{credit_code}}
- **排污许可证编号**：{{permit_number}}
- **管理类别**：{{management_level}}（重点/简化/登记）
- **报告月份**：{{year}}年{{month}}月

## 二、生产情况

### 2.1 主要产品产量

| 产品名称 | 设计产能 | 本月产量 | 上月产量 | 环比变化(%) |
|----------|----------|----------|----------|-------------|
| {{product}} | {{capacity}} | {{monthly_output}} | {{prev_output}} | {{change_rate}} |

### 2.2 生产设施运行情况

> 数据来源：生产设施运行台账（按日记录汇总）

| 设施编号 | 设施名称 | 本月运行天数 | 本月运行时长(h) | 停机次数 | 停机原因 |
|----------|----------|-------------|-----------------|----------|----------|
| {{facility_id}} | {{facility_name}} | {{run_days}} | {{run_hours}} | {{stop_count}} | {{stop_reason}} |

## 三、治污设施运行情况

> 数据来源：治污设施运行台账

| 设施编号 | 设施名称 | 处理工艺 | 运行天数 | 运行率(%) | 异常次数 | 异常处置 |
|----------|----------|----------|----------|-----------|----------|----------|
| {{treatment_id}} | {{treatment_name}} | {{process}} | {{treat_days}} | {{operation_rate}} | {{anomaly_count}} | {{anomaly_handling}} |

## 四、污染物排放情况

> 数据来源：自行监测记录台账 + CEMS 在线数据

### 4.1 有组织排放

| 排放口编号 | 监测因子 | 许可排放浓度(mg/m³) | 本月实测均值 | 最大值 | 最小值 | 超标次数 | 是否达标 |
|-----------|----------|---------------------|-------------|--------|--------|----------|----------|
| {{outfall}} | {{pollutant}} | {{permitted_limit}} | {{avg_value}} | {{max_value}} | {{min_value}} | {{exceed_count}} | 是/否 |

### 4.2 月度排放量

| 排放口 | 主要污染物 | 本月排放量(t) | 累计排放量(t) | 许可年排放量(t) | 占比(%) |
|--------|------------|-------------|-------------|-----------------|---------|
| {{outfall}} | {{pollutant}} | {{monthly_emission}} | {{cumulative_emission}} | {{annual_limit}} | {{usage_rate}} |

## 五、自行监测执行情况

> 数据来源：自行监测记录表

| 监测类型 | 应测次数 | 实测次数 | 完成率(%) | 超标次数 |
|----------|----------|----------|-----------|----------|
| 手工监测 | {{manual_required}} | {{manual_done}} | {{manual_rate}} | {{manual_exceed}} |
| 自动监测 | {{auto_required}} | {{auto_done}} | {{auto_rate}} | {{auto_exceed}} |

## 六、原辅材料消耗

> 数据来源：原辅材料消耗台账

| 材料名称 | 本月消耗量(t) | 累计消耗量(t) | 主要用途 |
|----------|-------------|-------------|----------|
| {{material_name}} | {{monthly_consumption}} | {{cumulative_consumption}} | {{usage}} |

## 七、固体废物产生与处置

> 数据来源：固废产生处置台账

| 固废类型 | 本月产生量(t) | 本月处置量(t) | 处置方式 | 是否合规 |
|----------|-------------|-------------|----------|----------|
| {{waste_type}} | {{monthly_produced}} | {{monthly_disposed}} | {{method}} | 是/否 |

## 八、本月合规情况

### 8.1 异常事件

{{anomaly_summary}}

### 8.2 整改措施

| 问题描述 | 整改措施 | 完成情况 |
|----------|----------|----------|
| {{issue}} | {{measure}} | {{status}} |

## 九、其他事项

{{others}}

> **提交要求**：重点管理企业每月10日前提交上月月度执行报告至全国排污许可证管理信息平台。
> **数据逻辑**：月度报告所有数据应与当月5类台账记录一致，台账是月报的数据源头。
""",
    },
    {
        "id": "tpl-report-annual",
        "name": "年度执行报告",
        "category": "report",
        "description": "年度排污许可证执行报告，数据来源于全年4个季度执行报告和12个月台账记录汇总。次年1月31日前提交。",
        "icon": "ClipboardList",
        "content": """# 排污许可证年度执行报告

> 依据：HJ 944《排污单位自行监测技术指南 总则》第5.4节、《排污许可管理办法》

## 一、企业基本信息

- **企业名称**：{{enterprise_name}}
- **统一社会信用代码**：{{credit_code}}
- **排污许可证编号**：{{permit_number}}
- **报告年度**：{{year}}

## 二、生产情况

### 2.1 主要产品产量

| 产品名称 | 设计产能 | 实际产量 | 主要原辅材料 | 消耗量 |
|----------|----------|----------|--------------|--------|
| {{product}} | {{capacity}} | {{output}} | {{material}} | {{consumption}} |

### 2.2 主要生产工艺与产排污节点

{{process_description}}

## 三、排污情况

### 3.1 年度排放情况

| 排放口 | 主要污染物 | 全年许可排放量(t) | 全年实际排放量(t) | 达标率(%) |
|--------|------------|--------------------|--------------------|-----------|
| {{outfall}} | {{pollutant}} | {{permitted}} | {{actual}} | {{compliance_rate}} |

### 3.2 台账记录情况

| 台账类型 | 应记录天数 | 实际记录天数 | 完整率(%) |
|----------|------------|--------------|-----------|
| 生产设施运行 | {{required_days}} | {{actual_days}} | {{completeness}} |

## 四、自行监测情况

{{monitoring_summary}}

## 五、合规分析

{{compliance_analysis}}

## 六、存在的主要问题及整改措施

| 序号 | 问题描述 | 原因分析 | 整改措施 | 责任人 | 完成情况 |
|------|----------|----------|----------|--------|----------|
| 1 | {{issue}} | {{cause}} | {{measure}} | {{owner}} | {{status}} |

## 七、其他需要报告的事项

{{others}}

> 提示：年度执行报告应于次年 1 月 31 日前提交至全国排污许可证管理信息平台。
""",
    },
]


@router.get("/calendar/templates")
async def calendar_templates():
    """返回合规工作流模板列表（台账/监测/报告）
    GET 请求，无需认证
    """
    return {"ok": True, "templates": _CALENDAR_TEMPLATES}


@router.post("/calendar/doc/save")
async def calendar_doc_save(request: Request):
    """保存用户编辑后的文档内容
    POST {templateId, content, title, date}
    返回 {ok: true, docId: "..."}
    """
    body, err = await _parse_json(request)
    if err is not None: return err

    template_id = body.get("templateId", "")
    content = body.get("content", "")
    title = body.get("title", "")
    date = body.get("date", "")

    if not template_id:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": "templateId 不能为空"},
        )

    doc_id = f"doc-{int(time.time())}-{random.randint(1000, 9999)}"
    doc = {
        "docId": doc_id,
        "templateId": template_id,
        "title": title,
        "content": content,
        "date": date,
        "savedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    _calendar_docs[doc_id] = doc

    return {"ok": True, "docId": doc_id}


@router.post("/calendar/doc/ai-fill")
async def calendar_doc_ai_fill(request: Request):
    """AI 真实填充模板 — 调用 DeepSeek 流式返回填充后的完整文档内容
    POST {templateId, content, title}
    SSE 流式返回：
      data: {"type":"progress","step":1,"name":"读取企业信息"}
      data: {"type":"text_delta","text":"..."}  // AI 逐字返回的填充内容
      data: {"type":"done"}
    """
    body, err = await _parse_json(request)
    if err is not None:
        return err

    template_id = body.get("templateId", "")
    content = body.get("content", "")
    title = body.get("title", "")

    if not content:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": "文档内容不能为空"},
        )

    # 检查 API Key
    if not os.environ.get("DEEPSEEK_API_KEY", ""):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": "DeepSeek API Key 未配置，无法调用 AI 填充"},
        )

    async def stream():
        def _sse(obj):
            return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"
        try:
            # Step 1: 读取企业信息
            yield _sse({"type": "progress", "step": 1, "name": "读取企业信息"})

            enterprise = _load_enterprise_info() or {}
            ent_name = enterprise.get("name", "[未配置企业名称]")
            permit_no = enterprise.get("permitNumber", "[未配置许可证编号]")
            credit_code = enterprise.get("creditCode", "[未配置统一社会信用代码]")
            industry = enterprise.get("industryCategory", "[未配置行业类别]")
            address = enterprise.get("address", "[未配置地址]")

            today_str = time.strftime("%Y-%m-%d")
            year_str = str(time.localtime().tm_year)
            month_str = str(time.localtime().tm_mon)
            quarter_str = str((time.localtime().tm_mon - 1) // 3 + 1)

            # ─── 台账数据汇总 ───
            # 当模板是月度/季度/年度执行报告时，自动读取已保存的台账数据
            ledger_context = ""
            is_report = "report" in template_id
            if is_report:
                yield _sse({"type": "progress", "step": 1.5, "name": "汇总台账数据"})

                # 从 _calendar_docs 读取台账类文档
                ledger_docs = [
                    d for d in _calendar_docs.values()
                    if "ledger" in d.get("templateId", "") or "monitor" in d.get("templateId", "")
                ]

                if ledger_docs:
                    ledger_summaries = []
                    for d in ledger_docs:
                        title = d.get("title", "未命名")
                        content_preview = d.get("content", "")[:2000]
                        saved_at = d.get("savedAt", "")
                        ledger_summaries.append(f"### {title}（保存于 {saved_at}）\n{content_preview}")

                    ledger_context = f"""

## 当月已录入的台账数据（真实数据源）
以下是企业已录入的台账记录，请基于这些真实数据填充执行报告，不要用示例值：

{chr(10).join(ledger_summaries)}
"""
                else:
                    ledger_context = f"""

## 台账数据状态
当前月度暂无已保存的台账记录。请用合理的示例值填充，并在该值后用括号标注"(示例值，请核实)"。
提示用户：先完成当月5类台账记录后，可重新生成月度报告以获得真实数据。
"""

            # Step 2: 构造 AI prompt
            yield _sse({"type": "progress", "step": 2, "name": "AI 智能填充中"})

            system_prompt = f"""你是 EcoPilot 合规文档自动填写助手。你的任务是根据企业真实信息和台账数据，智能填充模板中的占位符 {{占位符}}，生成可直接使用的合规文档。

## 企业真实信息
- 企业名称: {ent_name}
- 许可证编号: {permit_no}
- 统一社会信用代码: {credit_code}
- 行业类别: {industry}
- 注册地址: {address}
- 当前日期: {today_str}
- 当前年份: {year_str}
- 当前月份: {month_str}月
- 当前季度: Q{quarter_str}
{ledger_context}

## 填充规则
1. 将所有 {{占位符}} 替换为真实值（如 {{enterprise_name}} → 企业名称）
2. **优先使用台账数据中的真实数值**，不要用示例值替代已有台账记录
3. 对台账中缺失的数据，用合理的示例值填充，并在该值后用括号标注"(示例值，请核实)"
4. 保持原有 Markdown 格式、表格结构、标题层级完全不变
5. 不要添加任何解释性文字，直接返回填充后的完整文档
6. 对于表格中的数值字段，如台账有记录则直接引用，无记录则给出符合行业惯例的合理示例值
7. 输出必须与输入模板结构完全一致，仅替换占位符部分

## 输出要求
- 直接输出填充后的 Markdown 文档全文
- 不要包裹在代码块中
- 不要输出"以下是填充后的文档"等引导语
- 保持原有的空行和段落结构"""

            user_prompt = f"""请填充以下合规文档模板（标题：{title or "未命名"}）：

---
{content}
---

请根据上述企业真实信息智能填充所有占位符，直接返回填充后的完整文档。"""

            # Step 3: 调用 DeepSeek 流式
            stream = await ds_client.chat.completions.create(
                model=TEXT_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                stream=True,
            )

            async for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else ""
                if delta:
                    yield _sse({"type": "text_delta", "text": delta})
                    await asyncio.sleep(0)

            yield _sse({"type": "done"})

        except Exception as e:
            yield _sse({"type": "error", "detail": f"AI 填充失败: {str(e)}"})

    return StreamingResponse(stream(), media_type="text/event-stream")

