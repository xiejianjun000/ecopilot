"""
服务边界动态调整 — 根据企业管理等级 + 行业类别生成动态能力边界

管理等级（排污许可管理条例）:
  - 重点: 全功能合规服务（执行报告/自行监测/台账/危废/碳排放）
  - 简化: 精简合规服务（执行报告年报 + 基本台账）
  - 登记: 基础合规服务（基本信息登记 + 排污登记）

行业类别（国民经济行业代码）:
  C31 钢铁 / C301 水泥 / D4411 火电 / C26 化工 / C27 制药
  C17 纺织 / C22 造纸 / C13 食品加工 / A03 畜禽养殖
  D462 污水处理 / N782 垃圾焚烧
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_HERMES_HOME = Path.home() / ".ecopilot-home"

# ── 管理等级 → 服务范围 ──────────────────────────────────

LEVEL_BOUNDARY = {
    "重点": {
        "scope": "全功能合规服务",
        "includes": [
            "执行报告（年报/季报/月报）",
            "自行监测（自动监控 + 手工监测）",
            "环境管理台账记录",
            "危废管理（台账/转移联单/贮存）",
            "碳排放报送",
            "改正规定跟踪",
            "信息公开",
        ],
        "excludes": [],
        "report_freq": "年报 + 季报（重点水/大气污染物）",
    },
    "简化": {
        "scope": "精简合规服务",
        "includes": [
            "执行报告（年报）",
            "基本环境管理台账",
            "自行监测（简化方案）",
            "基本信息变更",
        ],
        "excludes": ["碳排放报送", "改正规定跟踪", "自动监控"],
        "report_freq": "年报",
    },
    "登记": {
        "scope": "基础合规服务",
        "includes": [
            "基本信息登记",
            "排污登记",
            "年度执行报告（简化）",
        ],
        "excludes": [
            "自行监测",
            "危废管理",
            "碳排放报送",
            "改正规定跟踪",
            "自动监控",
            "信息公开",
        ],
        "report_freq": "年度执行报告（简化）",
    },
}

# ── 行业代码 → 行业专家模式 ──────────────────────────────

INDUSTRY_EXPERT = {
    "C31": {
        "name": "钢铁",
        "mode": "钢铁行业专家模式",
        "key_standards": "HJ 846（钢铁工业）、超低排放（环大气〔2019〕35号）",
        "key_processes": "烧结/球团、炼铁、炼钢、轧钢",
        "focus": "烧结机头烟气脱硫脱硝、高炉煤气除尘、转炉二次除尘、无组织排放控制",
    },
    "C301": {
        "name": "水泥",
        "mode": "水泥行业专家模式",
        "key_standards": "HJ 848（水泥工业）、超低排放（环大气〔2020〕47号）",
        "key_processes": "生料制备、熟料煅烧、水泥粉磨",
        "focus": "窑尾电除尘/袋除尘、窑头除尘、无组织粉尘控制、氨逃逸",
    },
    "D4411": {
        "name": "火电",
        "mode": "火电行业专家模式",
        "key_standards": "HJ 820（火电厂）、超低排放（环大气〔2014〕177号）",
        "key_processes": "燃煤锅炉、燃气轮机、循环流化床",
        "focus": "烟气脱硫（湿法/半干法）、脱硝（SCR/SNCR）、除尘（电除尘/袋除尘）、汞排放控制",
    },
    "C26": {
        "name": "化工",
        "mode": "化工行业专家模式",
        "key_standards": "GB 31571（石化）、HJ 863（化学原料药）",
        "key_processes": "反应、分离、精馏、合成",
        "focus": "VOCs治理、废水处理（特征污染物）、危险废物管理、突发环境事件应急",
    },
    "C27": {
        "name": "制药",
        "mode": "制药行业专家模式",
        "key_standards": "HJ 863（化学原料药）、HJ 1062（发酵类）",
        "key_processes": "发酵、合成、提取、制剂",
        "focus": "发酵尾气、VOCs、废水（高COD/特征污染物）、药渣危废",
    },
    "C17": {
        "name": "纺织",
        "mode": "纺织行业专家模式",
        "key_standards": "GB 4287（纺织染整）",
        "key_processes": "前处理、染色/印花、后整理",
        "focus": "废水（色度/COD/苯胺类）、定型机油烟、污泥处置",
    },
    "C22": {
        "name": "造纸",
        "mode": "造纸行业专家模式",
        "key_standards": "GB 3544（制浆造纸）",
        "key_processes": "制浆、抄纸、涂布",
        "focus": "废水（COD/BOD/SS/AOX）、碱回收、白水回用、污泥",
    },
    "C13": {
        "name": "食品加工",
        "mode": "食品加工行业专家模式",
        "key_standards": "GB 25461（淀粉）、GB 27631（发酵酒精）",
        "key_processes": "原料处理、加工、包装",
        "focus": "废水（高BOD/COD/SS/氨氮）、恶臭、锅炉烟气",
    },
    "A03": {
        "name": "畜禽养殖",
        "mode": "畜禽养殖行业专家模式",
        "key_standards": "HJ 1029（畜禽养殖业）",
        "key_processes": "养殖、粪污处理",
        "focus": "粪污资源化利用、恶臭（氨/硫化氢）、废水（高氨氮/总磷）、病死畜禽无害化",
    },
    "D462": {
        "name": "污水处理",
        "mode": "污水处理行业专家模式",
        "key_standards": "GB 18918（城镇污水处理厂）",
        "key_processes": "预处理、生化处理、深度处理、污泥处置",
        "focus": "出水水质（COD/氨氮/总磷/总氮）、恶臭（硫化氢）、污泥处置路径",
    },
    "N782": {
        "name": "垃圾焚烧",
        "mode": "垃圾焚烧行业专家模式",
        "key_standards": "GB 18485（生活垃圾焚烧）",
        "key_processes": "垃圾接收、焚烧、烟气净化、飞灰处置",
        "focus": "烟气（二噁英/重金属/HCl/SO2/NOx）、飞灰危废、渗滤液处理",
    },
}

# 行业名 → 行业代码的反向映射（用于从许可证数据的行业名推导代码）
INDUSTRY_NAME_TO_CODE = {
    "钢铁": "C31",
    "黑色金属": "C31",
    "炼铁": "C31",
    "炼钢": "C31",
    "轧钢": "C31",
    "钢压延": "C31",
    "铁合金": "C31",
    "水泥": "C301",
    "火电": "D4411",
    "电力": "D4411",
    "热力": "D4411",
    "化工": "C26",
    "化学": "C26",
    "制药": "C27",
    "医药": "C27",
    "纺织": "C17",
    "印染": "C17",
    "造纸": "C22",
    "纸浆": "C22",
    "食品": "C13",
    "农副食品": "C13",
    "畜禽": "A03",
    "养殖": "A03",
    "畜牧": "A03",
    "污水处理": "D462",
    "水务": "D462",
    "垃圾焚烧": "N782",
    "环境治理": "N782",
}


def resolve_industry_code(industry_name: str, industry_code: str = "") -> str:
    """从行业名或行业代码推导标准行业代码"""
    if industry_code:
        for code in INDUSTRY_EXPERT:
            if industry_code.startswith(code):
                return code
    if industry_name:
        for name, code in INDUSTRY_NAME_TO_CODE.items():
            if name in industry_name:
                return code
    return ""


def _load_enterprise_profile() -> dict:
    """加载企业画像"""
    try:
        f = _HERMES_HOME / "enterprise.json"
        if f.exists():
            return json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _load_permit_data() -> dict:
    """加载排污许可证解析数据"""
    try:
        f = _HERMES_HOME / "permit-data.json"
        if f.exists():
            obj = json.loads(f.read_text(encoding="utf-8"))
            return obj.get("parsed", {}) if isinstance(obj, dict) else {}
    except Exception:
        pass
    return {}


def get_enterprise_context() -> dict:
    """获取当前企业上下文（行业 + 管理等级）"""
    profile = _load_enterprise_profile()
    permit = _load_permit_data()

    industry_name = (
        permit.get("industryCategory")
        or permit.get("industry")
        or profile.get("industry")
        or profile.get("industryCategory")
        or ""
    )
    industry_code_input = (
        permit.get("industryCode")
        or permit.get("industry_code")
        or profile.get("industryCode")
        or ""
    )
    management_level = (
        permit.get("managementLevel")
        or permit.get("management_level")
        or profile.get("managementLevel")
        or profile.get("management_level")
        or "重点"
    )

    industry_code = resolve_industry_code(industry_name, industry_code_input)

    return {
        "industry_name": industry_name,
        "industry_code": industry_code,
        "management_level": management_level,
    }


def build_service_boundary(
    management_level: Optional[str] = None,
    industry_code: Optional[str] = None,
) -> str:
    """根据管理等级 + 行业生成动态服务边界文本

    Args:
        management_level: 管理等级（重点/简化/登记），不传则从企业数据读取
        industry_code: 行业代码，不传则从企业数据读取

    Returns:
        注入到系统提示词的服务边界段
    """
    ctx = get_enterprise_context()
    mgmt = management_level or ctx.get("management_level", "重点")
    code = industry_code or ctx.get("industry_code", "")

    # 归一化管理等级
    if "重点" in mgmt:
        mgmt_key = "重点"
    elif "简化" in mgmt:
        mgmt_key = "简化"
    elif "登记" in mgmt:
        mgmt_key = "登记"
    else:
        mgmt_key = "重点"

    level_cfg = LEVEL_BOUNDARY.get(mgmt_key, LEVEL_BOUNDARY["重点"])
    industry_cfg = INDUSTRY_EXPERT.get(code)

    parts = [
        f"【服务边界 — 动态调整】",
        f"管理等级: {mgmt} → {level_cfg['scope']}",
        f"可用功能: {', '.join(level_cfg['includes'])}",
        f"执行报告频次: {level_cfg['report_freq']}",
    ]

    if level_cfg["excludes"]:
        parts.append(f"不适用功能: {', '.join(level_cfg['excludes'])}")

    if industry_cfg:
        parts.extend([
            f"",
            f"【行业专家模式 — {industry_cfg['name']}】",
            f"行业标准: {industry_cfg['key_standards']}",
            f"关键工艺: {industry_cfg['key_processes']}",
            f"监管重点: {industry_cfg['focus']}",
        ])

    parts.extend([
        f"",
        f"【越界处理规则】",
        f"用户询问超出 {mgmt} 管理等级的功能时，委婉说明：",
        f"\"当前企业管理等级为{mgmt}，该功能适用于{mgmt_key}等级以上企业。\"",
        f"并引导到当前等级可用的服务。",
    ])

    return "\n".join(parts)


def get_boundary_summary() -> dict:
    """获取服务边界摘要（供前端展示）"""
    ctx = get_enterprise_context()
    mgmt = ctx.get("management_level", "重点")
    code = ctx.get("industry_code", "")

    if "重点" in mgmt:
        mgmt_key = "重点"
    elif "简化" in mgmt:
        mgmt_key = "简化"
    elif "登记" in mgmt:
        mgmt_key = "登记"
    else:
        mgmt_key = "重点"

    level_cfg = LEVEL_BOUNDARY.get(mgmt_key, LEVEL_BOUNDARY["重点"])
    industry_cfg = INDUSTRY_EXPERT.get(code, {})

    return {
        "management_level": mgmt,
        "scope": level_cfg["scope"],
        "includes": level_cfg["includes"],
        "excludes": level_cfg["excludes"],
        "report_freq": level_cfg["report_freq"],
        "industry_code": code,
        "industry_name": industry_cfg.get("name", ""),
        "industry_mode": industry_cfg.get("mode", ""),
        "industry_standards": industry_cfg.get("key_standards", ""),
        "industry_focus": industry_cfg.get("focus", ""),
    }
