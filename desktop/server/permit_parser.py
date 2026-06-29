"""
许可证20项卡片数据 → PermitInfo 结构化解析器

从 license_reader 返回的 20 张卡片 raw text + tables 中，
用正则和表格分析提取结构化字段，输出符合前端 PermitInfo 类型。
"""

import re
import json

def parse_permit_from_cards(cards: dict) -> dict:
    """
    从 20 张卡的 raw text/tables 中提取结构化 PermitInfo。
    cards: {card1: {name, text, tables, ...}, ...}
    返回: PermitInfo 兼容 dict
    """
    result = {
        "enterpriseName": "",
        "creditCode": "",
        "permitNumber": "",
        "issuingAuthority": "",
        "issueDate": "",
        "validFrom": "",
        "validTo": "",
        "industryCategory": "",
        "industryCode": "",
        "managementLevel": "未知",
        "address": "",
        "legalRepresentative": "",
        "phone": "",
        "email": "",
        "postalCode": "",
        "province": "",
        "city": "",
        "county": "",
        "secondaryIndustry": "",
        "enterpriseId": "",
        "executionReportStatus": "",
        "permitStatus": "",
        "permitApplyDate": "",
        "monitoringStatus": "",
        "rectificationStatus": "",
        "emissionOutlets": [],
        "managementRequirements": [],
        "reapplicationHistory": [],
        "renewalHistory": [],
        "publicInfoHistory": [],
    }

    for card_id, card_data in cards.items():
        text = card_data.get("text", "")
        tables = card_data.get("tables", [])

        if card_id == "card1":
            _parse_card1(text, tables, result)
        elif card_id in ("card6", "card7"):
            _parse_air_emission(text, tables, result)
        elif card_id in ("card10", "card11"):
            _parse_water_emission(text, tables, result)
        elif card_id == "card14":
            _parse_monitoring_req(text, tables, result)
        elif card_id == "card15":
            _parse_record_req(text, tables, result)

    # 推断 managementLevel
    _infer_mgmt_level(result)

    return result


def _extract_by_regex(text: str, patterns: list[str], group: int = 1) -> str:
    """遍历多个正则提取字段"""
    for pat in patterns:
        m = re.search(pat, text)
        if m:
            return m.group(group).strip()
    return ""


def _parse_card1(text: str, tables: list, result: dict):
    """card1: 排污单位基本情况"""
    result["enterpriseName"] = _extract_by_regex(text, [
        r'(?:排污单位名称|企业名称|单位名称)[：:\s]*([^\n]{2,40})',
    ])
    result["creditCode"] = _extract_by_regex(text, [
        r'(?:统一社会信用代码|信用代码|社会信用代码)[：:\s]*(\w{18})',
        r'(\w{18})',
    ])
    result["permitNumber"] = _extract_by_regex(text, [
        r'(?:许可证编号|排污许可证编号|证书编号)[：:\s]*(\S{10,30})',
        r'(\d{18}\w{5})',
    ])
    result["issuingAuthority"] = _extract_by_regex(text, [
        r'(?:发证机关|发证部门|审批机关)[：:\s]*([^\n]{4,30})',
    ])
    result["legalRepresentative"] = _extract_by_regex(text, [
        r'(?:法定代表人|法人代表|负责人)[：:\s]*([^\n]{2,10})',
    ])
    result["address"] = _extract_by_regex(text, [
        r'(?:生产经营场所地址|单位地址|地址)[：:\s]*([^\n]{5,80})',
    ])
    result["industryCategory"] = _extract_by_regex(text, [
        r'(?:行业类别|所属行业)[：:\s]*([^\n]{2,30})',
    ])
    result["industryCode"] = _extract_by_regex(text, [
        r'(?:行业代码)[：:\s]*([A-Z]\d{2,4})',
    ])

    # 有效期
    vm = re.search(r'(?:有效期限|有效期)[：:\s]*(\d{4}[-./年]\d{1,2}[-./月]\d{1,2})[日]?\s*[至到~\-]\s*(\d{4}[-./年]\d{1,2}[-./月]\d{1,2})', text)
    if vm:
        result["validFrom"] = vm.group(1).replace("年", "-").replace("月", "-").replace(".", "-").replace("/", "-")
        result["validTo"] = vm.group(2).replace("年", "-").replace("月", "-").replace(".", "-").replace("/", "-")

    # 发证日期
    result["issueDate"] = _extract_by_regex(text, [
        r'(?:发证日期|签发日期|批准日期)[：:\s]*(\d{4}[-./]\d{1,2}[-./]\d{1,2})',
    ])

    # 管理类别
    if "重点管理" in text:
        result["managementLevel"] = "重点管理"
    elif "简化管理" in text:
        result["managementLevel"] = "简化管理"

    # 联系方式 - 从文本或表格中提取
    if not result["phone"]:
        result["phone"] = _extract_by_regex(text, [
            r'(?:电话|手机|联系电话|手机号码)[：:\s]*(\d{3,4}[-]?\d{7,8})',
            r'(?:电话|手机|联系电话|手机号码)[：:\s]*(1\d{10})',
            r'(1\d{10})',
        ])
    if not result["email"]:
        result["email"] = _extract_by_regex(text, [
            r'(?:邮箱|电子邮箱|电子邮件|Email|E-mail)[：:\s]*([\w.@]+)',
        ])
    if tables:
        for t in tables:
            for row in t.get("rows", []):
                row_str = " ".join(row)
                if not result["phone"] and ("电话" in row_str or "手机" in row_str):
                    phone_m = re.search(r'(1\d{10})', row_str)
                    if phone_m:
                        result["phone"] = phone_m.group(1)
                if not result["email"] and "邮箱" in row_str:
                    email_m = re.search(r'([\w.]+@[\w.]+)', row_str)
                    if email_m:
                        result["email"] = email_m.group(1)

    # 从表格行提取更多字段
    if tables:
        for t in tables:
            for row in t.get("rows", []):
                cells = [c.strip() for c in row if c.strip()]
                if len(cells) >= 2:
                    label, value = cells[0], cells[1]
                    if not result["province"] and "省" in label and value:
                        result["province"] = value
                    if not result["city"] and ("市" in label or "城市" in label) and value:
                        result["city"] = value
                    if not result["county"] and ("区" in label or "县" in label) and value:
                        result["county"] = value
                    if not result["enterpriseId"] and ("编码" in label or "ID" in label) and len(value) > 20:
                        result["enterpriseId"] = value

    # 从 text 补充省市区
    loc = _extract_by_regex(text, [r'(..省)[^省]*?(..市)[^市]*?(..[区县])'])
    if loc:
        parts = loc.split()
        if len(parts) >= 1: result["province"] = result["province"] or parts[0]
        if len(parts) >= 2: result["city"] = result["city"] or parts[1]
        if len(parts) >= 3: result["county"] = result["county"] or parts[2]

    # 邮政编码
    result["postalCode"] = _extract_by_regex(text, [
        r'(?:邮政编码|邮编)[：:\s]*(\d{6})',
    ])


def _parse_table_rows(tables: list) -> list[list[str]]:
    """展开表格为行列表"""
    rows = []
    for t in tables:
        for r in t.get("rows", []):
            cells = [c.strip() for c in r if c.strip() and len(c.strip()) > 1]
            if cells:
                rows.append(cells)
    return rows


def _parse_air_emission(text: str, tables: list, result: dict):
    """card6/7: 大气排放口信息 + 有组织排放限值"""
    rows = _parse_table_rows(tables)
    outlets = result.setdefault("emissionOutlets", [])
    seen_codes = set(o.get("code", "") for o in outlets)

    # 先从表格行提取
    for cells in rows:
        row_str = " ".join(cells)
        code_m = re.search(r'(D[AQF]\d{3})', row_str)
        if not code_m or code_m.group(1) in seen_codes:
            continue
        code = code_m.group(1)
        seen_codes.add(code)
        outlet = {
            "code": code,
            "name": _find_outlet_name(row_str, code),
            "type": "主要", "latitude": None, "longitude": None, "limits": [],
        }
        outlet["limits"] = _extract_limits_from_text(row_str)
        outlets.append(outlet)

    # 再从纯文本提取（兼容无表格格式）— 按排放口分割，为每个口提取其附近文本的限值
    lines = text.split('\n')
    # 先找所有排放口代码位置
    outlet_positions = []
    for idx, line in enumerate(lines):
        cm = re.search(r'(D[AQF]\d{3})\s+([^\s]{2,10})', line)
        if cm:
            outlet_positions.append((idx, cm.group(1), cm.group(2)))

    for i, (line_idx, code, name) in enumerate(outlet_positions):
        if code in seen_codes:
            continue
        seen_codes.add(code)
        # 取本排放口到下一个排放口之间的文本段落
        next_idx = outlet_positions[i+1][0] if i+1 < len(outlet_positions) else len(lines)
        segment = '\n'.join(lines[line_idx:next_idx])
        outlet = {
            "code": code, "name": name,
            "type": "主要", "latitude": None, "longitude": None, "limits": [],
        }
        outlet["limits"] = _extract_limits_from_text(segment)
        outlets.append(outlet)


def _find_outlet_name(row_str: str, code: str) -> str:
    """从行中提取排放口名称"""
    # 格式: DA001 烧结机头烟囱
    m = re.search(rf'{re.escape(code)}\s+([^\s]{{2,10}})', row_str)
    if m:
        return m.group(1)
    # 格式: 烧结机头烟囱 (DA001)
    m = re.search(r'([^\s]{2,10})\s*[\(（]{re.escape(code)}[\)）]', row_str)
    if m:
        return m.group(1)
    return f"排放口{code}"


def _extract_limits_from_text(text: str) -> list:
    """从文本中提取排放限值"""
    limits = []
    # 兼容 ≤ <= = 各种格式，兼容 SO2、NOx 各种写法
    pattern = re.compile(
        r'(SO[₂2]|NOx|NO[₂xX]|颗粒物|COD|NH[₃3][-]?N|总氮|总磷|氨氮|氟化物|石油类|挥发酚|'
        r'氰化物|砷|铅|汞|镉|六价铬|总铬|总铜|总锌|总镍|色度|SS|BOD|pH|'
        r'汞及其化合物|镉及其化合物|铅及其化合物|砷及其化合物|铬及其化合物)'
        r'\s*[≤<=<>]=\s*(\d+(?:\.\d+)?)\s*(mg/m[³3]|mg/L|μg/m[³3]|ng/m[³3]|μg/L|mg/Nm[³3])'
    )
    for m in pattern.finditer(text):
        factor = m.group(1).replace("2", "₂").replace("3", "₃").replace("NH-N", "NH₃-N")
        limits.append({
            "factor": factor,
            "limit": float(m.group(2)),
            "unit": m.group(3),
            "standardSource": "",
        })
    return limits


def _parse_water_emission(text: str, tables: list, result: dict):
    """card10/11: 水排放口信息"""
    rows = _parse_table_rows(tables)
    outlets = result.setdefault("emissionOutlets", [])
    seen_codes = set(o.get("code", "") for o in outlets)

    for cells in rows:
        row_str = " ".join(cells)
        code_m = re.search(r'(DW\d{3})', row_str)
        if not code_m:
            continue
        code = code_m.group(1)
        if code in seen_codes:
            continue
        seen_codes.add(code)
        outlet = {
            "code": code,
            "name": _find_outlet_name(row_str, code),
            "type": "主要", "latitude": None, "longitude": None,
            "limits": _extract_limits_from_text(row_str) or _extract_limits_from_text(text),
        }
        outlets.append(outlet)

    # 从纯文本补充水排放口
    lines = text.split('\n')
    for i, line in enumerate(lines):
        cm = re.search(r'(DW\d{3})\s+([^\s]{2,10})', line)
        if not cm or cm.group(1) in seen_codes:
            continue
        code = cm.group(1)
        seen_codes.add(code)
        # 限值找本行附近文本
        seg = '\n'.join(lines[i:i+5])
        outlets.append({
            "code": code, "name": cm.group(2),
            "type": "主要", "latitude": None, "longitude": None,
            "limits": _extract_limits_from_text(seg),
        })


def _parse_monitoring_req(text: str, tables: list, result: dict):
    """card14: 自行监测要求"""
    rows = _parse_table_rows(tables)
    content_parts = []
    for cells in rows:
        content_parts.append(" ".join(cells))

    content = "; ".join(content_parts[:5]) if content_parts else text[:200]
    reqs = result.setdefault("managementRequirements", [])
    if content:
        # 去重
        if not any(r["category"] == "自行监测" for r in reqs):
            reqs.append({
                "category": "自行监测",
                "content": content[:300],
                "frequency": "按许可证规定",
            })


def _parse_record_req(text: str, tables: list, result: dict):
    """card15: 台账记录要求"""
    rows = _parse_table_rows(tables)
    content_parts = []
    for cells in rows:
        content_parts.append(" ".join(cells))

    content = "; ".join(content_parts[:5]) if content_parts else text[:200]
    reqs = result.setdefault("managementRequirements", [])
    if content:
        if not any(r["category"] == "台账记录" for r in reqs):
            reqs.append({
                "category": "台账记录",
                "content": content[:300],
                "frequency": "按许可证规定",
            })


def _infer_mgmt_level(result: dict):
    """推断管理类别"""
    if result.get("managementLevel") and result["managementLevel"] != "未知":
        return
    industry = (result.get("industryCategory") or "") + (result.get("enterpriseName") or "")
    # 钢铁、火电、水泥→重点管理
    if any(k in industry for k in ["钢铁", "火电", "水泥", "黑色金属", "化工"]):
        result["managementLevel"] = "重点管理"
    elif any(k in industry for k in ["热力", "食品", "印刷"]):
        result["managementLevel"] = "简化管理"
    else:
        result["managementLevel"] = "重点管理"
