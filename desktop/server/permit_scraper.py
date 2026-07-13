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
import asyncio
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
    playwright: object = None  # 保存 Playwright 实例，退出时调用 stop() 释放 chromium 子进程
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
        playwright=pw,
    )

    try:
        # 1. 导航到 CAS 登录页（多级降级策略：domcontentloaded → commit → 重试）
        print("[PermitScraper] 正在导航到 CAS 登录页...")
        loaded = False
        for nav_attempt, wait_mode in enumerate(
            [("domcontentloaded", 25000), ("commit", 30000)], 1
        ):
            try:
                await page.goto(CAS_LOGIN_URL, wait_until=wait_mode[0],
                                timeout=wait_mode[1])
                loaded = True
                break
            except PwTimeout:
                print(f"[PermitScraper] {wait_mode[0]} 超时，尝试下一级...")
                continue
            except Exception as ex:
                if nav_attempt == 1:
                    continue
                raise

        if not loaded:
            raise RuntimeError("CAS 登录页无法加载，请检查网络")

        print(f"[PermitScraper] 页面加载完成: {page.url}")
        await page.wait_for_timeout(2000)

        # 等待关键元素（更宽容的超时）
        for el_id, el_timeout in [("#username", 20000), ("#kaptchaImage", 15000)]:
            try:
                await page.wait_for_selector(el_id, timeout=el_timeout)
            except PwTimeout:
                pass
        print("[PermitScraper] 页面元素已就绪")

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

        # 4. 获取验证码图片（截图方式最可靠，不受 URL 跨域影响）
        captcha_el = await page.query_selector("#kaptchaImage")
        if captcha_el:
            screenshot = await captcha_el.screenshot()
            session.captcha_base64 = base64.b64encode(screenshot).decode("ascii")
            print(f"[PermitScraper] 验证码获取成功 ({len(session.captcha_base64)} chars)")

    except PwTimeout as e:
        await _cleanup_browser(session)
        raise RuntimeError(f"平台连接超时: {e}")
    except Exception as e:
        await _cleanup_browser(session)
        raise RuntimeError(f"平台访问失败: {e}")

    _active_sessions[sid] = session
    return session


async def submit_login(session_id: str, username: str, password: str, captcha: str) -> dict:
    """提交 CAS 登录表单（RSAUtils 加密 + salt r0qj）

    CAS 登录使用自定义 RSAUtils.encryptedString() 加密密码，
    密码加盐 "r0qj" 后才加密。headless 模式下 jQuery 可能不加载，
    因此手动调用 RSAUtils 设置隐藏字段。
    """
    session = _active_sessions.get(session_id)
    if not session:
        return {"ok": False, "detail": "会话已过期，请重新开始"}

    page = session.page

    try:
        # 刷新 CSRF token（可能已过期）
        lt_el = await page.query_selector('input[name="lt"]')
        exec_el = await page.query_selector('input[name="execution"]')
        if lt_el:
            session.csrf_lt = await lt_el.get_attribute("value") or ""
        if exec_el:
            session.csrf_execution = await exec_el.get_attribute("value") or ""

        # 填入用户名和密码（明文）
        await page.fill("#username", username)
        await page.fill("#password", password)
        await page.fill("#verCode", captcha)

        # 手动调用 RSAUtils 设置加密隐藏字段
        # CAS 页面 jQuery submit handler 会做这事，但 headless 下 jQuery 可能不加载
        # 加密算法: RSAUtils.encryptedString(key, value + "r0qj") — 输出 hex，非 PKCS#1
        try:
            await page.wait_for_function(
                '() => typeof RSAUtils !== "undefined"', timeout=5000
            )
            import json as _js_pw
            pw_js = _js_pw.dumps(password + "r0qj")
            un_js = _js_pw.dumps(username + "r0qj")
            await page.evaluate(
                "(function() {"
                "var m = document.getElementById('hid_modulus').value;"
                "var e = document.getElementById('hid_exponent').value;"
                "var key = RSAUtils.getKeyPair(e, '', m);"
                "document.getElementById('hidepassword').value ="
                "    RSAUtils.encryptedString(key, " + pw_js + ");"
                "document.getElementById('hideusername').value ="
                "    RSAUtils.encryptedString(key, " + un_js + ");"
                "})()"
            )
            print("[PermitScraper] RSAUtils 手动加密完成")
        except Exception as enc_err:
            print(f"[PermitScraper] RSAUtils 不可用，依赖 jQuery handler: {enc_err}")

        # 监听弹窗（CAS 用 alert() 报错）
        dialogs = []
        def _on_dialog(dialog):
            dialogs.append(dialog.message)
            try:
                dialog.dismiss()
            except Exception:
                pass
        page.on("dialog", _on_dialog)

        # 点击登录按钮（使用 JS click，headless 兼容性更好）
        try:
            await page.evaluate('() => document.getElementById("loginBtn").click()')
        except Exception:
            await page.click("#loginBtn", no_wait_after=True)

        # 等待响应
        await page.wait_for_timeout(8000)

        # 移除监听
        try:
            page.remove_listener("dialog", _on_dialog)
        except Exception:
            pass

        current_url = page.url
        page_title = await page.title()
        print(f"[PermitScraper] 提交后 URL: {current_url}, title: {page_title}")

        # CAS 成功后跳转到 permitExt
        if ("permitExt" in current_url and "cas" not in current_url):
            await page.wait_for_timeout(5000)
            final_url = page.url
            print(f"[PermitScraper] 登录成功，最终 URL: {final_url}")
            session.logged_in = True
            return {"ok": True, "detail": "登录成功"}

        # 检查弹窗错误
        if dialogs:
            alert_msg = dialogs[0]
            print(f"[PermitScraper] alert: {alert_msg}")
            if "验证码" in alert_msg:
                return {"ok": False, "detail": "验证码错误"}
            elif "凭证" in alert_msg or "密码" in alert_msg or "用户" in alert_msg:
                return {"ok": False, "detail": "用户名或密码错误"}
            else:
                return {"ok": False, "detail": alert_msg}

        # 检查页面错误提示
        error_text = ""
        for err_sel in ["#dError", "#loginMsg", ".errorMsg", "#msg", ".msg", "#error", ".error"]:
            err_el = await page.query_selector(err_sel)
            if err_el:
                t = (await err_el.inner_text()).strip()
                if t:
                    error_text = t
                    break

        print(f"[PermitScraper] 错误信息: {error_text}")

        if "验证码" in error_text:
            return {"ok": False, "detail": "验证码错误"}
        elif "密码" in error_text or "用户" in error_text or "账号" in error_text or "凭证" in error_text:
            return {"ok": False, "detail": "用户名或密码错误"}
        elif "锁定" in error_text or "限制" in error_text:
            return {"ok": False, "detail": error_text}
        elif error_text:
            return {"ok": False, "detail": error_text}

        # 没找到错误但也没跳转 — 验证码错误（CAS 有时不提示）
        return {"ok": False, "detail": "验证码错误，请刷新后重试"}

    except Exception as e:
        return {"ok": False, "detail": f"登录提交失败: {e}"}


async def navigate_to_permit_detail(session_id: str) -> bool:
    """
    登录成功后导航到企业信息页和许可证重新申请列表。
    注意：平台在2024年1月升级HTTPS后，旧的 .action URL 返回错误页，
    必须通过 JSP 页面和侧边栏菜单导航。
    """
    session = _active_sessions.get(session_id)
    if not session or not session.logged_in:
        return False

    page = session.page
    username = "yuanbin"  # 从 session 读取或默认
    print(f"[PermitScraper] navigate_to_permit_detail, 当前 URL: {page.url}")

    try:
        # 1. 导航到企业基本信息页（唯一直接可访问的页面）
        info_url = f"https://permit.mee.gov.cn/permitExt/outside/updateEnterMSG.jsp?username={username}"
        print(f"[PermitScraper] 导航到企业信息页: {info_url}")
        await page.goto(info_url, wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(3000)

        if "cas/login" in page.url:
            print("[PermitScraper] Session 失效，被重定向回登录页")
            return False

        body = await page.inner_text("body")
        print(f"[PermitScraper] 企业信息页文本长度: {len(body)}")

        if len(body) < 200:
            print("[PermitScraper] 企业信息页文本过少，回退到仪表盘")
            await page.goto(LICENSE_REDIRECT, wait_until="domcontentloaded", timeout=20000)
            await page.wait_for_timeout(2000)

        return True

    except Exception as e:
        print(f"[PermitScraper] navigate_to_permit_detail error: {e}")
        import traceback; traceback.print_exc()
        # 回退到仪表盘
        try:
            await page.goto(LICENSE_REDIRECT, wait_until="domcontentloaded", timeout=20000)
            await page.wait_for_timeout(2000)
        except:
            pass
        return True  # 即使导航失败，仪表盘仍有部分数据


async def extract_permit_data(session_id: str) -> dict:
    """
    多页汇聚提取排污许可证数据。
    1. 企业信息页 → 企业名称、地址、信用代码、行业等
    2. 仪表盘 → 合规状态（执行报告逾期、许可申请状态等）
    3. 重新申请列表 → 许可编号、审批历史
    4. 延续列表 → 有效期信息
    """
    session = _active_sessions.get(session_id)
    if not session or not session.logged_in:
        return {"ok": False, "data": None, "raw_text": "", "detail": "未登录"}

    page = session.page
    raw_text_parts = []
    data = {
        "enterpriseName": "", "permitNumber": "", "creditCode": "",
        "issuingAuthority": "", "issueDate": "", "validFrom": "", "validTo": "",
        "industryCategory": "", "managementLevel": "", "address": "",
        "legalRepresentative": "", "phone": "", "email": "", "postalCode": "",
        "province": "", "city": "", "county": "",
        "secondaryIndustry": "",
        "enterpriseId": "2d3ee2db-0e80-4ec4-a3d7-322aeafc580e",
        "permitStatus": "",  # 当前许可状态
        "permitApplyDate": "",  # 最近申请日期
        "executionReportStatus": "",  # 执行报告状态
        "monitoringStatus": "",  # 监测状态
        "rectificationStatus": "",  # 改正规定状态
        "reapplicationHistory": [],  # 重新申请历史
        "renewalHistory": [],  # 延续历史
        "publicInfoHistory": [],  # 信息公开历史
        "emissionOutlets": [],
        "managementRequirements": [],
    }

    async def safe_goto(url, step_name):
        """安全导航，不因单次失败中断整体流程"""
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=25000)
            await page.wait_for_timeout(2000)
            # 检查页面是否可用
            if "chrome-error" in page.url or not page.url.startswith("http"):
                raise Exception(f"页面不可用: {page.url}")
            return await page.inner_text("body")
        except Exception as e:
            print(f"[PermitScraper] {step_name} 导航失败: {e}")
            return ""

    try:
        # ── 第一步：提取仪表盘合规状态 ──
        print("[PermitScraper] Step 1: 读取仪表盘...")
        dashboard_text = await safe_goto(LICENSE_REDIRECT, "仪表盘")

        # 排污单位编码
        code_match = re.search(r'排污单位编码[：:]\s*(\d+\w+)', dashboard_text)
        if code_match:
            full_code = code_match.group(1)
            data["creditCode"] = full_code[:18]
            if len(full_code) > 18:
                data["permitNumber"] = full_code

        # 执行报告状态
        report_match = re.search(r'执行报告信息\s*(.+?)\s*(\d{4}-\d{2}-\d{2})', dashboard_text, re.DOTALL)
        if report_match:
            data["executionReportStatus"] = report_match.group(1).strip()[:80] + " " + report_match.group(2)

        # 许可申请状态
        apply_match = re.search(r'许可申请信息\s*(.+?)\s*(\d{4}-\d{2}-\d{2})', dashboard_text, re.DOTALL)
        if apply_match:
            raw_status = apply_match.group(1).strip()[:80]
            data["permitStatus"] = raw_status
            data["permitApplyDate"] = apply_match.group(2)

        # 监测/改正状态
        mon_match = re.search(r'监测业务信息\s*(.+?)(?=\n|改正|$)', dashboard_text)
        if mon_match: data["monitoringStatus"] = mon_match.group(1).strip()[:50]
        rec_match = re.search(r'改正规定消息\s*(.+?)$', dashboard_text)
        if rec_match: data["rectificationStatus"] = rec_match.group(1).strip()[:50]

        # ── 第二步：提取企业基本信息 ──
        print("[PermitScraper] Step 2: 读取企业信息...")
        try:
            # 尝试通过仪表盘的"修改企业基本信息"链接进入
            enterprise_url = None
            links = await page.query_selector_all('a')
            for link in links:
                href = await link.get_attribute('href') or ''
                if 'updateEnterMSG' in href:
                    if href.startswith('http'):
                        enterprise_url = href
                    elif href.startswith('/'):
                        enterprise_url = 'https://permit.mee.gov.cn' + href
                    else:
                        enterprise_url = 'https://permit.mee.gov.cn/permitExt/outside/' + href
                    break

            if not enterprise_url:
                enterprise_url = "https://permit.mee.gov.cn/permitExt/outside/updateEnterMSG.jsp?username=yuanbin"

            info_text = await safe_goto(enterprise_url, "企业信息")
            raw_text_parts.append(info_text)

            # 只有页面正常才提取表单值
            if len(info_text) > 200:
                form_values = await page.evaluate("""() => {
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

                data["enterpriseName"] = form_values.get("EnterName", data.get("enterpriseName",""))
                data["creditCode"] = form_values.get("SocietyCode", data.get("creditCode",""))
                data["address"] = form_values.get("EnterAddress", data.get("address",""))
                data["phone"] = form_values.get("Telephone", "")
                data["email"] = form_values.get("MailAddr", "")
                data["postalCode"] = form_values.get("ZipCode", "")
                data["province"] = form_values.get("province", "")
                data["city"] = form_values.get("city", "")
                data["county"] = form_values.get("counties", "")
                data["industryCategory"] = form_values.get("industryName", "")
                data["secondaryIndustry"] = form_values.get("qtindustryName", "")
                data["managementLevel"] = "重点管理"  # C31 钢铁行业
            else:
                print(f"[PermitScraper] 企业信息页获取失败({len(info_text)}字符)，从其他页面汇总")
        except Exception as e:
            print(f"[PermitScraper] 企业信息提取异常: {e}")

        # ── 第三步：提取重新申请历史 ──
        async def safe_step(step_name, menu_text, extract_fn):
            """执行一个菜单点击+数据提取步骤，自动处理页面恢复"""
            print(f"[PermitScraper] {step_name}...")
            text = await safe_goto(LICENSE_REDIRECT, f"{step_name}-回仪表盘")
            if not text or len(text) < 100:
                # 页面死了，重试一次
                print(f"[PermitScraper] {step_name} 仪表盘不可用，重试...")
                text = await safe_goto(LICENSE_REDIRECT, f"{step_name}-重试")
            if not text or len(text) < 100:
                print(f"[PermitScraper] {step_name} 跳过（页面不可用）")
                return
            try:
                await _click_menu_img(page, menu_text)
                await asyncio.sleep(4)
                result_text = await page.inner_text("body")
            except Exception as e:
                print(f"[PermitScraper] {step_name} 点击菜单失败: {e}")
                return
            raw_text_parts.append(result_text)
            extract_fn(result_text)

        # 重新申请
        def parse_reapply(text):
            reapply_rows = re.findall(
                r'(\d+)\s+(冷水江\S+)\s+(审批通过|补正|不予受理|审批不通过|未提交|已提交等待受理|审批中)\s*(\d{4}-\d{2}-\d{2})?\s*(.+?)(?=\n\d|\n页|$)',
                text
            )
            for r in reapply_rows:
                data["reapplicationHistory"].append({
                    "index": r[0], "name": r[1], "status": r[2].strip(),
                    "date": r[3], "actions": r[4].strip()[:200]
                })
            approved = [r for r in data["reapplicationHistory"] if r["status"] == "审批通过"]
            if approved:
                approved.sort(key=lambda r: r.get("date", ""), reverse=True)
                data["validFrom"] = approved[-1].get("date", "") if approved else ""
                data["validTo"] = approved[0].get("date", "") if approved else ""

        await safe_step("Step 3: 重新申请列表", "许可证重新申请", parse_reapply)

        # 延续
        def parse_renew(text):
            renew_rows = re.findall(
                r'(\d+)\s+(冷水江\S+)\s+(审批通过|补正|不予受理|审批不通过)\s*(\d{4}-\d{2}-\d{2})?\s*(.+?)(?=\n\d|\n页|$)',
                text
            )
            for r in renew_rows:
                data["renewalHistory"].append({
                    "index": r[0], "name": r[1], "status": r[2].strip(),
                    "date": r[3], "actions": r[4].strip()[:200]
                })

        await safe_step("Step 4: 延续列表", "许可证延续", parse_renew)

        # 信息公开
        def parse_pub(text):
            pub_rows = re.findall(r'(\d+)\s+(取消发布|发布结束|发布中)\s+(\d{4}-\d{2}-\d{2})', text)
            for r in pub_rows:
                data["publicInfoHistory"].append({"index": r[0], "status": r[1], "date": r[2]})

        await safe_step("Step 5: 信息公开", "信息公开", parse_pub)

        # ── 第六步：执行报告明细（permitrep SPA）──
        print("[PermitScraper] Step 6: 执行报告明细...")
        data["executionReports"] = []
        try:
            permit_code = data.get("permitNumber") or data.get("creditCode","") + "001P"
            city_code = "431300000000"
            await page.goto(
                f"https://permit.mee.gov.cn/permitrep/autologin?userAccount=yuanbin&permitCode={permit_code}&cityCode={city_code}",
                wait_until="networkidle", timeout=45000
            )
            await asyncio.sleep(4)
            # Click "执行报告" in SPA menu
            await page.evaluate("""() => {
                document.querySelectorAll('*').forEach(el => {
                    if(el.innerText && el.innerText.trim()==='执行报告' && el.children.length<=1) el.click();
                });
            }""")
            await asyncio.sleep(4)
            spa_text = await page.inner_text("body")
            raw_text_parts.append(spa_text)

            # Extract yearly report status
            for year in [2026, 2025, 2024, 2023, 2022]:
                try:
                    await page.evaluate(f"""(function() {{
                        document.querySelectorAll('*').forEach(el => {{
                            if(el.innerText && el.innerText.trim()==='{year}') el.click();
                        }});
                    }})()""")
                    await asyncio.sleep(2)
                    year_text = await page.inner_text("body")

                    year_data = {"year": year, "monthly": [], "quarterly": [], "annual": None}

                    # Extract monthly
                    for m in range(1, 13):
                        pattern = rf'{m}月\s*(已提交|办理记录)?'
                        mm = re.search(pattern, year_text)
                        if mm:
                            status = mm.group(1) if mm.group(1) else "未创建"
                            year_data["monthly"].append({"month": m, "status": status})

                    # Extract quarterly
                    for q in range(1, 5):
                        pattern = rf'{q}季度\s*(?:状态[：:]?\s*)?(已提交|待提交|办理记录)?[^\n]*?(?:提交时间[：:]\s*(\S+))?'
                        mm = re.search(pattern, year_text, re.DOTALL)
                        if mm:
                            status = mm.group(1) if mm.group(1) else "未创建"
                            date = mm.group(2) if mm.group(2) else ""
                            year_data["quarterly"].append({"quarter": q, "status": status, "submitDate": date})

                    # Annual
                    am = re.search(rf'年报\s*{year}\s*(?:状态[：:]?\s*)?(已提交|办理记录|待提交)?[^\n]*?(?:提交时间[：:]\s*(\S+))?', year_text, re.DOTALL)
                    if am:
                        year_data["annual"] = {"status": am.group(1) or "未创建", "submitDate": am.group(2) or ""}

                    data["executionReports"].append(year_data)
                except Exception as e:
                    data["executionReports"].append({"year": year, "error": str(e)})

        except Exception as e:
            print(f"[PermitScraper] 执行报告明细提取异常: {e}")

        # 也查统一报表
        try:
            await page.evaluate("""() => {
                document.querySelectorAll('*').forEach(el => {
                    if(el.innerText && el.innerText.trim()==='统一报表' && el.children.length<=1) el.click();
                });
            }""")
            await asyncio.sleep(4)
            ut = await page.inner_text("body")
            raw_text_parts.append(ut)
            # 提取统一报表状态
            data["unifiedReportStatus"] = {}
            for q in range(1, 5):
                up = re.search(rf'{q}季度\s*(?:状态[：:]?\s*)?(已提交|待提交|办理记录)?[^\n]*?(?:提交时间[：:]\s*(\S+))?', ut, re.DOTALL)
                if up:
                    data["unifiedReportStatus"][f"Q{q}"] = {"status": up.group(1) or "", "submitDate": up.group(2) or ""}
        except Exception as e:
            print(f"[PermitScraper] 统一报表提取异常: {e}")

        # ── 组装最终数据 ──
        raw_text = "\n---PAGE---\n".join(raw_text_parts)
        has_core = bool(data.get("enterpriseName"))

        print(f"[PermitScraper] 提取完成: name={data['enterpriseName']}, "
              f"credit={data['creditCode']}, permit={data['permitNumber']}, "
              f"reapply={len(data['reapplicationHistory'])}条, "
              f"renew={len(data['renewalHistory'])}条")

        return {
            "ok": True,
            "data": data,
            "raw_text": raw_text,
            "has_core_data": has_core,
            "url": LICENSE_REDIRECT,
        }

    except Exception as e:
        print(f"[PermitScraper] extract error: {e}")
        import traceback; traceback.print_exc()
        return {"ok": False, "data": data, "raw_text": "\n".join(raw_text_parts), "detail": str(e)}


async def _click_menu_img(page, item_text: str) -> bool:
    """点击侧边栏菜单项的 <img> 标签"""
    return await page.evaluate(f"""(function() {{
        const lis = document.querySelectorAll('li.hrefli');
        for (const li of lis) {{
            if (li.innerText.trim().includes('{item_text}')) {{
                const img = li.querySelector('img');
                if (img && img.getAttribute('onclick')) {{
                    img.click();
                    return true;
                }}
            }}
        }}
        return false;
    }})()""")


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


async def full_audit(session_id: str, on_progress=None) -> dict:
    """
    全模块自动巡检：遍历侧边栏所有模块，收集状态数据。
    返回结构化的审计报告。
    on_progress(name, step, total) — 可选进度回调
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
    total = len(audit_modules)

    for idx, mod in enumerate(audit_modules):
        if on_progress:
            try:
                await on_progress(mod, idx + 1, total)
            except Exception:
                pass
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
                      kimi_base_url: str = "https://api.moonshot.cn/v1",
                      vision_model: str = None,
                      prefer_vision: bool = False) -> dict:
    """
    一键自动登录：启动会话 → 验证码识别 → 提交登录。
    返回 session_id 和登录状态。

    Args:
        username: 平台账号
        password: 平台密码
        kimi_api_key: Kimi API key（可选，默认用 chat_api 内置的）
        kimi_base_url: Kimi API base URL
        vision_model: 用户在 onboarding 选择的视觉模型 ID（如 moonshot-v1-32k-vision-preview）
        prefer_vision: True 时优先使用视觉大模型识别验证码（onboarding 流程必传 True）
    """
    try:
        session = await start_login_session()
    except RuntimeError as e:
        return {"ok": False, "session_id": None, "detail": str(e)}

    sid = session.session_id

    # 初始化 ddddocr（备选；onboarding 流程中 prefer_vision=True 时跳过）
    dddd_ocr = None
    if not prefer_vision:
        try:
            import ddddocr
            dddd_ocr = ddddocr.DdddOcr(show_ad=False)
            print("[PermitScraper] ddddocr 就绪")
        except ImportError:
            print("[PermitScraper] ddddocr 未安装，使用 Kimi Vision")
    else:
        print(f"[PermitScraper] 优先使用视觉模型识别验证码: {vision_model or '默认'}")

    # Kimi 客户端（备选）
    import os
    key = kimi_api_key or os.environ.get("KIMI_API_KEY", "")

    def _recognize_captcha(captcha_b64: str) -> str:
        """识别验证码：根据 onboarding 用户选择，优先视觉模型 or ddddocr"""
        import base64
        img_bytes = base64.b64decode(captcha_b64)

        # 1. onboarding 流程：优先视觉大模型
        if prefer_vision and key:
            try:
                from openai import OpenAI
                client = OpenAI(api_key=key, base_url=kimi_base_url)
                use_model = vision_model or "moonshot-v1-32k-vision-preview"
                resp = client.chat.completions.create(
                    model=use_model,
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{captcha_b64}"}},
                            {"type": "text", "text": "Read the 4 alphanumeric characters from this CAPTCHA. Output exactly 4 characters only."},
                        ]
                    }],
                    max_tokens=10,
                )
                result = resp.choices[0].message.content.strip()
                if result and len(result) >= 3:
                    return result
            except Exception as e:
                print(f"[PermitScraper] 视觉模型 {vision_model} 识别失败: {e}，回退到 ddddocr")

        # 2. 备选：ddddocr
        if dddd_ocr:
            try:
                result = dddd_ocr.classification(img_bytes)
                if result and len(result) >= 3:
                    return result.strip()
            except Exception as e:
                print(f"[PermitScraper] ddddocr 识别失败: {e}")

        # 3. 最终回退：默认 Kimi Vision（若无 ddddocr）
        if not prefer_vision and key:
            try:
                from openai import OpenAI
                client = OpenAI(api_key=key, base_url=kimi_base_url)
                resp = client.chat.completions.create(
                    model="moonshot-v1-32k-vision-preview",
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{captcha_b64}"}},
                            {"type": "text", "text": "Read the 4 alphanumeric characters from this CAPTCHA. Output exactly 4 characters only."},
                        ]
                    }],
                    max_tokens=10,
                )
                return resp.choices[0].message.content.strip()
            except Exception as e:
                print(f"[PermitScraper] Kimi 识别失败: {e}")
        return ""

    try:
        for attempt in range(8):  # 最多8次重试
            captcha = _recognize_captcha(session.captcha_base64)
            print(f"[PermitScraper] 验证码识别: \"{captcha}\" (attempt {attempt+1}/8)")

            if not captcha or len(captcha) < 3:
                await refresh_captcha(sid)
                continue

            # 提交登录（已修复：手动 RSAUtils 加密）
            result = await submit_login(sid, username, password, captcha)
            if result.get("ok"):
                return {"ok": True, "session_id": sid, "detail": "登录成功"}

            detail = result.get("detail", "")
            if "验证码" not in detail:
                await close_session(sid)
                return {"ok": False, "session_id": None, "detail": detail}

            # 验证码错误，刷新重试
            await refresh_captcha(sid)

        await close_session(sid)
        return {"ok": False, "session_id": None, "detail": "验证码识别失败，已重试8次"}

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
            captcha_src = await captcha_el.get_attribute("src") or ""
            if captcha_src and not captcha_src.startswith("data:"):
                if captcha_src.startswith("/"):
                    captcha_src = "https://permit.mee.gov.cn" + captcha_src
                try:
                    resp = await page.request.get(captcha_src)
                    img_bytes = await resp.body()
                    b64 = base64.b64encode(img_bytes).decode("ascii")
                    session.captcha_base64 = b64
                    return {"ok": True, "captcha_base64": b64}
                except:
                    pass
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
    """清理浏览器资源（含 Playwright 实例，防止 chromium 子进程泄漏）"""
    try:
        await session.context.close()
    except Exception:
        pass
    try:
        await session.browser.close()
    except Exception:
        pass
    # 关闭 Playwright 实例，释放 chromium 子进程
    pw = getattr(session, "playwright", None)
    if pw is not None:
        try:
            await pw.stop()
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
