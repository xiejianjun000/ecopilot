#!/usr/bin/env python3.11
"""
EcoPilot 排污许可平台 MCP Server
持久浏览器会话、Cookie复用、一次登录重复使用
"""
import asyncio, json, os, base64
from pathlib import Path
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent
from playwright.async_api import async_playwright, Browser, BrowserContext, Page

# ─── 常量 ───
COOKIES_FILE = Path("/tmp/permit-cookies.json")
UID = "2d3ee2db-0e80-4ec4-a3d7-322aeafc580e"
MAIN_URL = "https://permit.mee.gov.cn/permitExt/outside/main"
CAS_URL = "https://permit.mee.gov.cn/cas/login?service=https%3A%2F%2Fpermit.mee.gov.cn%2FpermitExt%2Foutside%2FLicenseRedirect"
ENTERPRISE_INFO_URL = f"https://permit.mee.gov.cn/permitExt/outside/updateEnterMSG.jsp?username=yuanbin"

# ─── 全局浏览器状态 ───
_pw = None
_browser: Browser | None = None
_context: BrowserContext | None = None
_page: Page | None = None
_logged_in = False

server = Server("permit-platform")

async def _get_or_create_browser():
    """获取或创建浏览器实例"""
    global _pw, _browser, _context, _page
    if _pw is None:
        _pw = await async_playwright().start()
    if _browser is None:
        _browser = await _pw.chromium.launch(headless=True, args=['--no-sandbox'])
    if _context is None:
        _context = await _browser.new_context(
            viewport={"width": 1440, "height": 900},
            locale="zh-CN",
        )
    if _page is None:
        _page = await _context.new_page()
    return _page

async def _load_cookies():
    """尝试加载保存的cookies"""
    if COOKIES_FILE.exists():
        with open(COOKIES_FILE) as f:
            cookies = json.load(f)
        if cookies and _context:
            await _context.add_cookies(cookies)
            return True
    return False

async def _save_cookies():
    """保存cookies"""
    if _context:
        cookies = await _context.cookies()
        with open(COOKIES_FILE, "w") as f:
            json.dump(cookies, f)

async def _extract_page(page):
    """提取页面数据"""
    d = {"url": page.url}
    try: d["title"] = await page.title()
    except: pass
    try: d["body"] = await page.evaluate("document.body.innerText.slice(0,10000)")
    except: pass
    try:
        d["tables"] = await page.evaluate("""
        () => Array.from(document.querySelectorAll('table')).slice(0,6).map((t,i) => ({
            i, rows: Array.from(t.rows).slice(0,12).map(r =>
                Array.from(r.querySelectorAll('td,th')).map(c => c.innerText.trim()))
        }))
        """)
    except: pass
    try:
        d["links"] = await page.evaluate("""
        () => Array.from(document.querySelectorAll('a')).slice(0,30).map(a => ({
            text: a.innerText.trim().slice(0,50),
            href: (a.href||'').slice(0,200)
        })).filter(l => l.text)
        """)
    except: pass
    # Screenshot as base64
    try:
        img = await page.screenshot()
        d["screenshot_base64"] = base64.b64encode(img).decode()
    except:
        d["screenshot_base64"] = ""
    return json.dumps(d, ensure_ascii=False, indent=2)

# ─── Tools ───

@server.list_tools()
async def list_tools():
    return [
        Tool(name="permit_login", description="登录排污许可平台。首次需要验证码(base64图片), 返回验证码图片。登录后cookie自动保存。",
             inputSchema={"type": "object", "properties": {
                 "action": {"type": "string", "enum": ["start", "submit"], "description": "start: 获取验证码; submit: 提交登录"},
                 "captcha": {"type": "string", "description": "验证码(仅submit需要)"},
             }, "required": ["action"]}),
        Tool(name="permit_status", description="查询当前登录状态和主页信息",
             inputSchema={"type": "object", "properties": {}}),
        Tool(name="permit_navigate", description="导航到指定页面/模块并提取数据",
             inputSchema={"type": "object", "properties": {
                 "module": {"type": "string", "description": "模块名: 许可申请信息|执行报告信息|企业基本信息|主页"},
             }, "required": ["module"]}),
        Tool(name="permit_screenshot", description="截图当前页面, 返回base64",
             inputSchema={"type": "object", "properties": {}}),
        Tool(name="permit_explore", description="列出主页上所有可点击的菜单项和链接",
             inputSchema={"type": "object", "properties": {}}),
        Tool(name="permit_logout", description="登出并关闭浏览器",
             inputSchema={"type": "object", "properties": {}}),
    ]

@server.call_tool()
async def call_tool(name: str, args: dict) -> list[TextContent]:
    global _logged_in, _page

    try:
        page = await _get_or_create_browser()

        if name == "permit_login":
            action = args.get("action", "start")
            if action == "start":
                await page.goto(CAS_URL, wait_until="domcontentloaded", timeout=20000)
                await asyncio.sleep(2)

                # Check if already logged in via cookies
                if "cas/login" not in page.url:
                    _logged_in = True
                    await _save_cookies()
                    return [TextContent(text="✅ 已登录(cookie有效), 无需重复登录")]

                await page.fill("#username", "yuanbin")
                await page.fill("#password", "432502@Bin")

                # Get captcha
                captcha_el = await page.query_selector("#kaptchaImage")
                if captcha_el:
                    img = await captcha_el.screenshot()
                    b64 = base64.b64encode(img).decode()
                    return [TextContent(text=f"🔐 请输入验证码:\n\n验证码图片(base64):\n{b64}\n\n然后调用 permit_login action=submit captcha=XXXX")]
                return [TextContent(text="❌ 未找到验证码元素")]

            elif action == "submit":
                captcha = args.get("captcha", "").strip()
                if not captcha:
                    return [TextContent(text="❌ 请提供验证码")]

                await page.fill("#verCode", captcha)
                await page.click("#loginBtn")
                await asyncio.sleep(5)

                if "cas/login" not in page.url:
                    _logged_in = True
                    await _save_cookies()
                    await asyncio.sleep(3)
                    # Close overlays
                    await page.evaluate("document.querySelectorAll('a').forEach(a=>{if(a.innerText.trim()==='×')a.click()})")
                    data = await _extract_page(page)
                    return [TextContent(text=f"✅ 登录成功!\n\n主页数据:\n{data}")]
                else:
                    error = ""
                    try:
                        err = await page.query_selector("#dError")
                        if err: error = (await err.inner_text()).strip()
                    except: pass
                    return [TextContent(text=f"❌ 登录失败: {error or '验证码错误'}")]

        elif name == "permit_status":
            if not _logged_in:
                # Try cookies
                await page.goto(MAIN_URL, wait_until="networkidle", timeout=20000)
                await asyncio.sleep(3)
                if "cas/login" in page.url:
                    _logged_in = False
                    return [TextContent(text="❌ 未登录。请先调用 permit_login action=start")]
                _logged_in = True
                await _save_cookies()

            await page.evaluate("document.querySelectorAll('a').forEach(a=>{if(a.innerText.trim()==='×')a.click()})")
            await asyncio.sleep(1)
            data = await _extract_page(page)
            return [TextContent(text=f"✅ 已登录 | 企业: 冷水江钢铁有限责任公司\n\n{data}")]

        elif name == "permit_navigate":
            module = args.get("module", "")
            if not _logged_in:
                return [TextContent(text="❌ 请先登录")]

            if module == "企业基本信息":
                await page.goto(ENTERPRISE_INFO_URL, wait_until="domcontentloaded", timeout=15000)
                await asyncio.sleep(3)
                await page.evaluate("document.querySelectorAll('a').forEach(a=>{if(a.innerText.trim()==='×')a.click()})")

                fields = await page.evaluate("""
                () => Array.from(document.querySelectorAll('input,select,textarea')).slice(0,30)
                    .map(f => ({name: f.name||f.id, value: (f.value||'').slice(0,80)}))
                    .filter(f => f.value)
                """)
                data = await _extract_page(page)
                result = f"📋 企业基本信息 ({len(fields)}字段):\n"
                for f in fields:
                    result += f"  {f['name']}: {f['value']}\n"
                result += f"\n原始数据:\n{data}"
                return [TextContent(text=result)]

            elif module in ("许可申请信息", "执行报告信息"):
                await page.goto(MAIN_URL, wait_until="networkidle", timeout=20000)
                await asyncio.sleep(4)
                func = "gotoMore()" if module == "许可申请信息" else "gotoReportMore()"
                await page.evaluate(f"{func}")
                await asyncio.sleep(4)
                data = await _extract_page(page)
                return [TextContent(text=f"📋 {module}:\n{data}")]

            elif module == "主页":
                await page.goto(MAIN_URL, wait_until="networkidle", timeout=20000)
                await asyncio.sleep(3)
                data = await _extract_page(page)
                return [TextContent(text=f"📋 主页:\n{data}")]

            else:
                return [TextContent(text=f"❌ 未知模块: {module}")]

        elif name == "permit_screenshot":
            img = await page.screenshot()
            b64 = base64.b64encode(img).decode()
            return [TextContent(text=f"📸 截图:\n{b64}")]

        elif name == "permit_explore":
            if not _logged_in:
                return [TextContent(text="❌ 请先登录")]

            await page.goto(MAIN_URL, wait_until="networkidle", timeout=20000)
            await asyncio.sleep(4)
            await page.evaluate("document.querySelectorAll('a').forEach(a=>{if(a.innerText.trim()==='×')a.click()})")

            # Get all menu items
            menus = await page.evaluate("""
            () => {
                const r = [];
                document.querySelectorAll('li, a, [onclick]').forEach(el => {
                    const t = el.innerText.trim().slice(0,40).replace(/\\n.*/,'');
                    const onclick = (el.getAttribute('onclick')||'').slice(0,180);
                    if (t && t.length > 1 && !r.some(x => x.text === t))
                        r.push({text: t, tag: el.tagName, onclick, href: (el.href||'').slice(0,120)});
                });
                return r.slice(0,40);
            }
            """)

            result = f"🔍 页面可交互元素 ({len(menus)}个):\n"
            for m in menus:
                action = m['onclick'][:60] or m['href'][:60] or "(无动作)"
                result += f"  [{m['tag']}] {m['text'][:40]} | {action}\n"

            data = await _extract_page(page)
            result += f"\n页面数据:\n{data}"
            return [TextContent(text=result)]

        elif name == "permit_logout":
            try:
                await _save_cookies()
                if _context: await _context.close()
                if _browser: await _browser.close()
            except: pass
            _logged_in = False
            return [TextContent(text="✅ 已登出")]

        return [TextContent(text=f"未知工具: {name}")]

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        return [TextContent(text=f"❌ 错误: {e}\n{tb}")]

async def main():
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
