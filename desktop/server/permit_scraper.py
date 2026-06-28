"""
EcoPilot 排污许可平台浏览器自动化抓取器

使用 Playwright async API 登录 permit.mee.gov.cn 并提取排污许可证数据。
支持全模块自动巡检、菜单导航、数据提取。
"""

import base64
import time
import uuid
import re
import rsa
from dataclasses import dataclass, field
from typing import Optional
from playwright.async_api import async_playwright, Browser, BrowserContext, Page, TimeoutError as PwTimeout

# ─── 平台 URL 常量 ───
CAS_SERVICE = "https%3A%2F%2Fpermit.mee.gov.cn%2FpermitExt%2Foutside%2FLicenseRedirect"
CAS_LOGIN_URL = f"https://permit.mee.gov.cn/cas/login?service={CAS_SERVICE}"
LICENSE_REDIRECT = "https://permit.mee.gov.cn/permitExt/outside/LicenseRedirect"
ENTERPRISE_INFO_URL = "https://permit.mee.gov.cn/permitExt/outside/updateEnterMSG.jsp"

# ─── 侧边栏菜单模块 ───
MODULES = {
    "许可证申请": ("../outside/min_bctb.jsp", "xkzsq"),
    "许可证重新申请": ("../syssb/ckxm/ckxm!listCxsq.action?itemTypeID=XZXKTYPE_A&itemtype=TYPEI", "xkzzx"),
    "许可证变更": ("../outside/min_bcbg.jsp", "xkzzx"),
    "许可证调整": ("../syssb/ckxm/ckxm!listTz.action?itemTypeID=XZXKTYPE_A&itemtype=TYPEK", "xkzzx"),
    "许可证延续": ("../syssb/ckxm/ckxm!listBcyx.action?itemTypeID=XZXKTYPE_D&itemtype=TYPED", "xkzzx"),
    "许可证补办": ("../outside/min_xkzbb.jsp", "xkzbb"),
    "土壤管理": ("../outside/min_soil.jsp", "soil"),
    "信息公开": ("../syssb/xxgk/xxgk!list.action", ""),
    "台账记录": ("../outside/min_tzjl.jsp", "tzjl"),
    "执行报告": ("https://permit.mee.gov.cn/permitrep/autologin", "zxbg"),
    "改正规定": ("https://permit.mee.gov.cn/permitrep/correction/autologin", "gzgd"),
    "自动监控": ("../zdjk/zdjk!zdjk.action", "zdjkurl"),
    "统一报表": ("https://permit.mee.gov.cn/permitrep/unified/autologin", "zxbg"),
    "碳排放报送": ("http://114.251.10.30/#/login", "tzjl"),
}


@dataclass
class PermitLoginSession:
    """登录会话状态"""
    session_id: str
    browser: Browser
    context: BrowserContext
    page: Page
    # CAS 登录页提取的信息
    csrf_lt: str = ""
    csrf_execution: str = ""
    rsa_modulus_hex: str = ""
    rsa_exponent_hex: str = ""
    captcha_base64: str = ""
    # 登录状态
    logged_in: bool = False
    created_at: float = field(default_factory=time.time)


# ─── 全局会话存储 ───
_active_sessions: dict[str, PermitLoginSession] = {}


def _build_rsa_key(modulus_hex: str, exponent_hex: str) -> rsa.PublicKey:
    """从十六进制字符串构建 RSA 公钥（兼容 JSEncrypt）"""
    n = int(modulus_hex, 16)
    e = int(exponent_hex, 16)
    return rsa.PublicKey(n, e)


def _encrypt_password(password: str, pubkey: rsa.PublicKey) -> str:
    """使用 RSA PKCS#1 v1.5 加密密码，返回 base64"""
    encrypted = rsa.encrypt(password.encode("utf-8"), pubkey)
    return base64.b64encode(encrypted).decode("ascii")


async def start_login_session() -> PermitLoginSession:
    """
    启动 headless Chromium，导航到 CAS 登录页，
    提取 CSRF 令牌、RSA 公钥参数和验证码图片。
    """
    pw = await async_playwright().start()
    browser = await pw.chromium.launch(
        headless=True,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--disable-dev-shm-usage",
        ],
    )
    context = await browser.new_context(
        viewport={"width": 1440, "height": 900},
        user_agent=(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/131.0.0.0 Safari/537.36"
        ),
        locale="zh-CN",
    )
    page = await context.new_page()

    sid = str(uuid.uuid4())
    session = PermitLoginSession(
        session_id=sid,
        browser=browser,
        context=context,
        page=page,
    )

    try:
        # 1. 导航到 CAS 登录页
        print("[PermitScraper] 正在导航到 CAS 登录页...")
        await page.goto(CAS_LOGIN_URL, wait_until="domcontentloaded", timeout=25000)
        print(f"[PermitScraper] 页面加载完成: {page.url}")
        await page.wait_for_timeout(2000)
        await page.wait_for_selector("#username", timeout=12000)
        print("[PermitScraper] 找到 #username 元素")

        # 2. 提取 CSRF 隐藏字段（CAS 使用 name 属性，不是 id）
        for field, selector in [
            ("csrf_lt", 'input[name="lt"]'),
            ("csrf_execution", 'input[name="execution"]'),
        ]:
            el = await page.query_selector(selector)
            if el:
                val = await el.get_attribute("value") or ""
                setattr(session, field, val)
                print(f"[PermitScraper] {field}={val[:40]}...")

        # 3. 提取 RSA 公钥参数
        mod_el = await page.query_selector("#hid_modulus")
        exp_el = await page.query_selector("#hid_exponent")
        if mod_el:
            session.rsa_modulus_hex = await mod_el.get_attribute("value") or ""
        if exp_el:
            session.rsa_exponent_hex = await exp_el.get_attribute("value") or ""
        print(f"[PermitScraper] RSA modulus_len={len(session.rsa_modulus_hex)}, exponent={session.rsa_exponent_hex}")

        # 4. 截取验证码图片
        captcha_el = await page.query_selector("#kaptchaImage")
        if captcha_el:
            screenshot = await captcha_el.screenshot()
            session.captcha_base64 = base64.b64encode(screenshot).decode("ascii")

    except PwTimeout as e:
        await _cleanup_browser(session)
        raise RuntimeError(f"平台连接超时: {e}")
    except Exception as e:
        await _cleanup_browser(session)
        raise RuntimeError(f"平台访问失败: {e}")

    _active_sessions[sid] = session
    return session


async def submit_login(session_id: str, username: str, password: str, captcha: str) -> dict:
    """提交 CAS 登录表单（使用 RSA 加密密码）"""
    session = _active_sessions.get(session_id)
    if not session:
        return {"ok": False, "detail": "会话已过期，请重新开始"}

    page = session.page

    try:
        # CAS 页面的 JSEncrypt 会自动加密密码，我们只需填明文
        # 先刷新 CSRF token（可能已过期）
        lt_el = await page.query_selector('input[name="lt"]')
        exec_el = await page.query_selector('input[name="execution"]')
        if lt_el:
            session.csrf_lt = await lt_el.get_attribute("value") or ""
        if exec_el:
            session.csrf_execution = await exec_el.get_attribute("value") or ""

        # 填入用户名（明文）
        await page.fill("#username", username)
        # 填入密码（明文，页面 JSEncrypt 提交时自动加密）
        await page.fill("#password", password)
        # 填入验证码
        await page.fill("#verCode", captcha)

        # 点击登录按钮 — 页面 JS 会 RSA 加密密码后提交表单
        await page.click("#loginBtn")

        # 等待响应 — 成功后跳转到 permitExt
        await page.wait_for_timeout(4000)

        current_url = page.url
        page_title = await page.title()
        print(f"[PermitScraper] 提交后 URL: {current_url}, title: {page_title}")

        # CAS 成功后跳转到 permitExt（不带 cas 路径即为成功）
        if "permitExt" in current_url and "cas" not in current_url:
            await page.wait_for_timeout(2000)
            final_url = page.url
            print(f"[PermitScraper] 登录成功，最终 URL: {final_url}")
            session.logged_in = True
            return {"ok": True, "detail": "登录成功"}

        # 检查错误提示
        error_text = ""
        for err_sel in ["#loginMsg", ".errorMsg", "#msg", ".msg", "#error", ".error"]:
            err_el = await page.query_selector(err_sel)
            if err_el:
                t = (await err_el.inner_text()).strip()
                if t:
                    error_text = t
                    break

        print(f"[PermitScraper] 错误信息: {error_text}")

        if "验证码" in error_text:
            return {"ok": False, "detail": "验证码错误"}
        elif "密码" in error_text or "用户" in error_text or "账号" in error_text:
            return {"ok": False, "detail": "用户名或密码错误"}
        elif "锁定" in error_text or "限制" in error_text:
            return {"ok": False, "detail": error_text}
        elif error_text:
            return {"ok": False, "detail": error_text}

        # 没找到错误信息但也没跳转 — 可能是验证码错误（CAS 不提示）
        return {"ok": False, "detail": "验证码错误，请刷新后重试"}

    except Exception as e:
        return {"ok": False, "detail": f"登录提交失败: {e}"}


async def navigate_to_permit_detail(session_id: str) -> bool:
    """登录成功后直接导航到许可证信息页"""
    session = _active_sessions.get(session_id)
    if not session or not session.logged_in:
        return False

    page = session.page
    print(f"[PermitScraper] navigate_to_permit_detail, 当前 URL: {page.url}")

    try:
        # 1. 登录后 CAS 跳转的页面通常返回错误页
        #    直接导航到许可证信息页，利用 CAS session cookie
        print("[PermitScraper] 直接导航到许可证信息页...")
        await page.goto(
            "https://permit.mee.gov.cn/permitExt/defaults/default-index!getInformation.action",
            wait_until="domcontentloaded",
            timeout=20000
        )
        await page.wait_for_timeout(3000)
        print(f"[PermitScraper] 信息页 URL: {page.url}, title: {await page.title()}")

        body = await page.inner_text("body")
        print(f"[PermitScraper] 信息页文本长度: {len(body)}")

        # 2. 如果信息页被重定向回 CAS 登录（session无效），返回失败
        if "cas/login" in page.url:
            print("[PermitScraper] Session 失效，被重定向回登录页")
            return False

        # 3. 如果页面只有少量文本，可能是错误页，尝试备用路径
        if len(body) < 200:
            print("[PermitScraper] 页面文本过少，尝试备用路径...")
            for path in [
                "/permitExt/outside/main",
                "/permitExt/outside/enterpriseInfo",
                "/permitExt/defaults/default-index!getEnterpriseInfo.action",
            ]:
                try:
                    await page.goto(f"https://permit.mee.gov.cn{path}",
                                   wait_until="domcontentloaded", timeout=10000)
                    await page.wait_for_timeout(2000)
                    body = await page.inner_text("body")
                    if len(body) > 200 and ("企业" in body or "许可" in body or "排放" in body):
                        print(f"[PermitScraper] 备用路径 {path} 成功, 文本: {len(body)}")
                        break
                except Exception:
                    continue

        print(f"[PermitScraper] 最终页面: {page.url}, 文本长度: {len(body)}")
        return True

    except Exception as e:
        print(f"[PermitScraper] navigate_to_permit_detail error: {e}")
        import traceback; traceback.print_exc()
        return False


async def extract_permit_data(session_id: str) -> dict:
    """从当前页面提取排污许可证结构化数据（DOM + 坐标）"""
    session = _active_sessions.get(session_id)
    if not session or not session.logged_in:
        return {"ok": False, "data": None, "raw_text": "", "detail": "未登录"}

    page = session.page
    current_url = page.url
    import re

    try:
        # 获取页面全部文本（供 DeepSeek fallback 使用）
        raw_text = await page.inner_text("body")
        raw_html = await page.content()
        print(f"[PermitScraper] 页面文本长度: {len(raw_text)}, HTML: {len(raw_html)}")

        # ── 从 HTML 中提取所有表格数据 ──
        tables_data = await page.evaluate("""
        () => {
            const tables = document.querySelectorAll('table');
            return Array.from(tables).map((t, i) => {
                const rows = t.querySelectorAll('tr');
                return {
                    index: i,
                    rows: Array.from(rows).map(r => {
                        const cells = r.querySelectorAll('td, th');
                        return Array.from(cells).map(c => c.innerText.trim());
                    })
                };
            });
        }
        """)
        print(f"[PermitScraper] 共找到 {len(tables_data)} 个表格")

        # ── 从全页文本提取（更鲁棒） ──
        data: dict = {
            "enterpriseName": _extract_field(raw_text, [
                r'单位名称[：:]\s*(.+)',
                r'企业名称[：:]\s*(.+)',
                r'排污单位名称[：:]\s*(.+)',
            ]),
            "permitNumber": _extract_field(raw_text, [
                r'许可证编号[：:]\s*(.+)',
                r'(\d{18}[A-Za-z0-9]{5})',
            ]),
            "creditCode": _extract_field(raw_text, [
                r'统一社会信用代码[：:]\s*(\d{18})',
            ]),
            "issuingAuthority": _extract_field(raw_text, [
                r'发证机关[：:]\s*(.+)',
                r'发证部门[：:]\s*(.+)',
            ]),
            "industryCategory": _extract_field(raw_text, [
                r'行业类别[：:]\s*(.+)',
                r'所属行业[：:]\s*(.+)',
            ]),
            "managementLevel": _extract_field(raw_text, [
                r'管理类别[：:]\s*(.+)',
            ]),
            "address": _extract_field(raw_text, [
                r'生产经营场所地址[：:]\s*(.+)',
                r'地址[：:]\s*(.+)',
            ]),
            "legalRepresentative": _extract_field(raw_text, [
                r'法定代表人[：:]\s*(.+)',
            ]),
            "validFrom": "",
            "validTo": "",
            "issueDate": "",
            "emissionOutlets": [],
            "managementRequirements": [],
        }

        # 提取有效期
        valid_match = re.search(
            r'有效期限[：:]\s*(\d{4}[-./]\d{1,2}[-./]\d{1,2})\s*[至到~-]\s*(\d{4}[-./]\d{1,2}[-./]\d{1,2})',
            raw_text
        )
        if valid_match:
            data["validFrom"] = valid_match.group(1)
            data["validTo"] = valid_match.group(2)
        else:
            dates = re.findall(r'(\d{4}[-./]\d{1,2}[-./]\d{1,2})', raw_text)
            if len(dates) >= 2:
                data["validFrom"] = dates[0]
                data["validTo"] = dates[-1]
            elif len(dates) == 1:
                data["issueDate"] = dates[0]

        # 管理类别判定
        if not data["managementLevel"]:
            if '重点管理' in raw_text: data["managementLevel"] = '重点管理'
            elif '简化管理' in raw_text: data["managementLevel"] = '简化管理'
            elif '登记管理' in raw_text: data["managementLevel"] = '登记管理'

        # ── 提取排放口（含坐标） ──
        data["emissionOutlets"] = await _extract_outlets_with_coords(page, raw_text, raw_html)

        # ── 提取管理要求 ──
        data["managementRequirements"] = _extract_requirements(raw_text)

        has_core = bool(data.get("enterpriseName") or data.get("permitNumber"))
        if not has_core:
            print("[PermitScraper] DOM/文本提取不完整，标记需要 DeepSeek 解析")

        print(f"[PermitScraper] 提取结果: name={data.get('enterpriseName')}, permit={data.get('permitNumber')}, outlets={len(data.get('emissionOutlets',[]))}")

        return {
            "ok": True,
            "data": data,
            "raw_text": raw_text,
            "has_core_data": has_core,
            "url": current_url,
        }

    except Exception as e:
        print(f"[PermitScraper] extract error: {e}")
        import traceback; traceback.print_exc()
        return {"ok": False, "data": None, "raw_text": "", "detail": f"数据提取失败: {e}"}


def _extract_field(text: str, patterns: list[str]) -> str:
    """从文本中用正则匹配字段值"""
    import re
    for pat in patterns:
        m = re.search(pat, text)
        if m:
            return m.group(1).strip()
    return ""


async def _extract_outlets_with_coords(page, raw_text: str, raw_html: str) -> list[dict]:
    """提取排放口信息（含经纬度坐标）"""
    import re
    outlets = []

    # 从表格行提取排放口
    # 匹配格式: DA001 烧结机头烟囱 主要 ... 坐标或经纬度
    outlet_blocks = re.findall(
        r'(D[AW]\d{3})\s*[：:]?\s*(.+?)(?=\nD[AW]\d{3}|\n\n(?:管理|自行|执行|信息)|\Z)',
        raw_text, re.DOTALL
    )

    for code, block in outlet_blocks:
        name = block.strip().split('\n')[0][:60] if block else ""
        outlet_type = _extract_field(block, [r'(主要|一般|特殊)排放口'])

        # 提取坐标
        lat, lng = _extract_coordinates(block)

        # 提取排放限值
        limits = []
        limit_matches = re.findall(
            r'(SO[₂2]|NOx|颗粒物|COD|NH[₃3]-?N|总氮|总磷|粉尘|VOCs|汞|\w+)\s*[≤<=]\s*([\d.]+)\s*(mg/m[³3]|mg/L|t/a)?',
            block
        )
        for factor, limit_val, unit in limit_matches:
            limits.append({
                "factor": factor,
                "limit": float(limit_val),
                "unit": unit or "mg/m³",
                "standardSource": "",
            })

        outlets.append({
            "code": code,
            "name": name,
            "type": outlet_type or "主要",
            "latitude": lat,
            "longitude": lng,
            "limits": limits,
        })

    # 如果没有找到 DA/DW 格式，尝试从 HTML 表格提取
    if not outlets:
        outlets = await _extract_outlets_from_tables(page)

    return outlets


def _extract_coordinates(text: str) -> tuple:
    """从文本中提取经纬度坐标"""
    import re
    lat, lng = 0.0, 0.0
    # 格式1: 27.xxxx, 111.xxxx (纬度, 经度)
    m = re.search(r"(\d{2}\.\d{4,})\s*[,，]\s*(\d{2,3}\.\d{4,})", text)
    if m:
        lat = float(m.group(1))
        lng = float(m.group(2))
    # 格式2: 东经/北纬 度分秒
    m = re.search(r"东经[：:]?\s*(\d{2,3})[度]\s*(\d{1,2})[分]\s*(\d{1,2}(?:\.\d+)?)[秒]", text)
    if m:
        lng = float(m.group(1)) + float(m.group(2)) / 60 + float(m.group(3)) / 3600
    m = re.search(r"北纬[：:]?\s*(\d{1,2})[度]\s*(\d{1,2})[分]\s*(\d{1,2}(?:\.\d+)?)[秒]", text)
    if m:
        lat = float(m.group(1)) + float(m.group(2)) / 60 + float(m.group(3)) / 3600
    return round(lat, 6), round(lng, 6)


async def _extract_outlets_from_tables(page) -> list[dict]:
    """从 HTML 表格中提取排放口"""
    import re
    outlets = []
    try:
        rows = await page.query_selector_all("table tr")
        for row in rows:
            cells = await row.query_selector_all("td")
            if len(cells) < 3:
                continue
            texts = []
            for c in cells:
                t = (await c.inner_text()).strip()
                texts.append(t)
            if not texts or texts[0] in ("序号", "编号", "代码", ""):
                continue
            code = texts[0] if len(texts) > 0 else ""
            name = texts[1] if len(texts) > 1 else ""
            if not re.match(r"D[AW]\d{3}", code):
                continue
            lat, lng = _extract_coordinates(" ".join(texts))
            outlets.append({
                "code": code, "name": name, "type": "主要",
                "latitude": lat, "longitude": lng, "limits": [],
            })
    except Exception as e:
        print(f"[PermitScraper] table extraction error: {e}")
    return outlets


def _extract_requirements(raw_text: str) -> list[dict]:
    """从文本中提取管理要求"""
    import re
    reqs = []
    categories = ['自行监测', '台账记录', '执行报告', '信息公开', '其他']
    for cat in categories:
        m = re.search(f'{cat}[：:]?\s*(.+?)(?=\n|$)', raw_text)
        if m:
            reqs.append({"category": cat, "content": m.group(1).strip()[:200], "frequency": ""})
    return reqs


# ─── 侧边栏菜单导航 ───

async def click_menu_item(session_id: str, item_text: str) -> dict:
    """
    点击侧边栏菜单项。菜单由 easyui-tree 动态渲染，
    实际点击的是 <li.hrefli> 内的 <img> 标签上的 onclick。
    """
    session = _active_sessions.get(session_id)
    if not session:
        return {"ok": False, "detail": "会话不存在"}

    page = session.page
    try:
        result = await page.evaluate(f"""(function() {{
            const lis = document.querySelectorAll('li.hrefli');
            for (const li of lis) {{
                if (li.innerText.trim().includes('{item_text}')) {{
                    const img = li.querySelector('img');
                    if (img && img.getAttribute('onclick')) {{
                        img.click();
                        return img.getAttribute('onclick').substring(0, 200);
                    }}
                    // fallback: try parent click
                    const parent = li.parentElement;
                    if (parent) {{
                        parent.click();
                        return 'parent clicked';
                    }}
                    return 'no onclick found';
                }}
            }}
            return 'not found';
        }})()""")
        await page.wait_for_timeout(4000)
        return {"ok": True, "clicked": result, "url": page.url, "title": await page.title()}

    except Exception as e:
        return {"ok": False, "detail": str(e)}


async def navigate_module(session_id: str, module_key: str) -> dict:
    """
    导航到指定模块并提取页面数据。
    支持 MODULES 字典中定义的所有模块。
    """
    session = _active_sessions.get(session_id)
    if not session or not session.logged_in:
        return {"ok": False, "detail": "未登录"}

    page = session.page
    enterprise_id = "2d3ee2db-0e80-4ec4-a3d7-322aeafc580e"

    # 先回到 Dashboard 以确保菜单可用
    await page.goto(LICENSE_REDIRECT, wait_until="domcontentloaded", timeout=20000)
    await page.wait_for_timeout(2000)

    # 点击菜单项
    click_result = await click_menu_item(session_id, module_key)
    if not click_result.get("ok"):
        return click_result

    await page.wait_for_timeout(3000)

    url = page.url
    title = await page.title()
    body = await page.inner_text("body")

    # 提取表格数据
    tables = await page.evaluate("""() => {
        return Array.from(document.querySelectorAll('table')).map((t, i) => ({
            index: i,
            rows: Array.from(t.querySelectorAll('tr')).slice(0, 60).map(r =>
                Array.from(r.querySelectorAll('td, th')).map(c => c.innerText.trim())
            )
        })).filter(t => t.rows.length > 1 && t.rows.some(r => r.some(c => c.length > 0)));
    }""")

    return {
        "ok": True,
        "module": module_key,
        "url": url,
        "title": title,
        "text": body[:5000],
        "tables": tables,
    }


async def full_audit(session_id: str) -> dict:
    """
    全模块自动巡检：遍历侧边栏所有模块，收集状态数据。
    返回结构化的审计报告。
    """
    session = _active_sessions.get(session_id)
    if not session or not session.logged_in:
        return {"ok": False, "detail": "未登录"}

    page = session.page
    results = {}

    audit_modules = [
        "许可证申请", "许可证重新申请", "许可证变更", "许可证调整",
        "许可证延续", "许可证补办", "土壤管理", "排污登记",
        "信息公开", "台账记录", "执行报告", "监测记录",
        "改正规定", "自动监控", "统一报表", "碳排放报送",
    ]

    for mod in audit_modules:
        try:
            mod_result = await navigate_module(session_id, mod)
            results[mod] = {
                "ok": mod_result.get("ok", False),
                "url": mod_result.get("url", ""),
                "title": mod_result.get("title", ""),
                "text_preview": (mod_result.get("text", "") or "")[:1000],
                "tables": mod_result.get("tables", []),
            }
        except Exception as e:
            results[mod] = {"ok": False, "error": str(e)}

    # 提取企业信息
    try:
        await page.goto(f"{ENTERPRISE_INFO_URL}?username=yuanbin",
                         wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(5000)
        enterprise_data = await page.evaluate("""() => {
            const r = {};
            document.querySelectorAll('input, select').forEach(el => {
                if (el.tagName === 'SELECT' && el.selectedIndex >= 0) {
                    r[el.id || el.name] = el.options[el.selectedIndex].text;
                } else if (el.value && el.value.length > 0) {
                    r[el.id || el.name] = el.value;
                }
            });
            return r;
        }""")
        results["_enterprise_info"] = enterprise_data
    except Exception as e:
        results["_enterprise_info"] = {"error": str(e)}

    return {"ok": True, "modules": results}


async def quick_login(username: str, password: str,
                      kimi_api_key: str = None,
                      kimi_base_url: str = "https://api.moonshot.cn/v1") -> dict:
    """
    一键自动登录：启动会话 → Kimi 识别验证码 → 提交登录。
    返回 session_id 和登录状态。

    Args:
        username: 平台账号
        password: 平台密码
        kimi_api_key: Kimi API key（可选，默认用 chat_api 内置的）
        kimi_base_url: Kimi API base URL
    """
    try:
        session = await start_login_session()
    except RuntimeError as e:
        return {"ok": False, "session_id": None, "detail": str(e)}

    sid = session.session_id

    # 如果没有提供 kimi key，用 chat_api 里的
    key = kimi_api_key or "sk-6eHDJCmvmbAMkgxflrS1dILTeIkZV8zMGObJbuFk4HWcHBFm"

    try:
        from openai import OpenAI
        client = OpenAI(api_key=key, base_url=kimi_base_url)

        for attempt in range(6):
            # Kimi 识别验证码
            resp = client.chat.completions.create(
                model="moonshot-v1-32k-vision-preview",
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{session.captcha_base64}"}},
                        {"type": "text", "text": "Read the 4 alphanumeric characters from this CAPTCHA. Output exactly 4 characters only."},
                    ]
                }],
                max_tokens=10,
            )
            captcha = resp.choices[0].message.content.strip()

            # 提交登录
            result = await submit_login(sid, username, password, captcha)
            if result.get("ok"):
                return {"ok": True, "session_id": sid, "detail": "登录成功"}

            if "验证码" not in result.get("detail", ""):
                await close_session(sid)
                return {"ok": False, "session_id": None, "detail": result.get("detail", "登录失败")}

            # 刷新验证码，重试
            await refresh_captcha(sid)

        await close_session(sid)
        return {"ok": False, "session_id": None, "detail": "验证码识别失败，已重试6次"}

    except Exception as e:
        await close_session(sid)
        return {"ok": False, "session_id": None, "detail": f"自动登录异常: {e}"}


async def refresh_captcha(session_id: str) -> dict:
    """刷新验证码图片"""
    session = _active_sessions.get(session_id)
    if not session:
        return {"ok": False, "captcha_base64": None, "detail": "会话已过期"}

    page = session.page
    try:
        await page.click("#kaptchaImage")
        await page.wait_for_timeout(500)
        captcha_el = await page.query_selector("#kaptchaImage")
        if captcha_el:
            screenshot = await captcha_el.screenshot()
            b64 = base64.b64encode(screenshot).decode("ascii")
            session.captcha_base64 = b64
            return {"ok": True, "captcha_base64": b64}
        return {"ok": False, "captcha_base64": None, "detail": "刷新验证码失败"}
    except Exception as e:
        return {"ok": False, "captcha_base64": None, "detail": str(e)}


async def close_session(session_id: str) -> dict:
    """关闭浏览器会话，释放资源"""
    session = _active_sessions.pop(session_id, None)
    if not session:
        return {"ok": True, "detail": "会话不存在"}

    await _cleanup_browser(session)
    return {"ok": True, "detail": "会话已关闭"}


async def _cleanup_browser(session: PermitLoginSession):
    """清理浏览器资源"""
    try:
        await session.context.close()
    except Exception:
        pass
    try:
        await session.browser.close()
    except Exception:
        pass


async def cleanup_stale_sessions(max_age_seconds: int = 600) -> int:
    """清理超时会话，返回清理数量"""
    now = time.time()
    stale_ids = [
        sid for sid, s in _active_sessions.items()
        if now - s.created_at > max_age_seconds
    ]
    for sid in stale_ids:
        await close_session(sid)
    return len(stale_ids)
