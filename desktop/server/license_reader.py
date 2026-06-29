"""
许可证20项完整数据快速读取器 v2.0
直接导航每张卡URL → 提取内容，无需DOM事件
"""
import asyncio, re
from permit_scraper import _active_sessions

LICENSE_CARDS = [
    ("card50", "阅读填报指南",      "hpsp!guid.action"),
    ("card1",  "排污单位基本情况",   "hpsp!pwxkInfo.action"),
    ("card2",  "主要产品及产能",     "cpcn!product.action"),
    ("card3",  "产品及产能补充",     "cpcn-extend!product.action"),
    ("card4",  "原辅材料及燃料",     "hpsp/yfrl/yuan-fu-ran-liao!fuel.action"),
    ("card5",  "排污节点及治理设施", "hpsp!zlss.action"),
    ("card6",  "大气排放口",         "hpsp/dqinfo!airDischargePort.action"),
    ("card7",  "有组织排放信息",     "hpsp/airyzz!gasGroup.action"),
    ("card8",  "无组织排放信息",     "hpsp/wzzpfxx/wzzpfxx!noGroupDischarge.action"),
    ("card9",  "大气排放总许可量",   "hpsp!gasEnterprise.action"),
    ("card10", "水排放口",           "hpsp/fsinfo!swrwInfo.action"),
    ("card11", "水排放信息",         "hpsp/waterpfxx!waterGroup.action"),
    ("card12", "固体废物管理信息",   "hpsp/gtfw/gtfw!gtfqwpfInfo.action"),
    ("card13", "工业噪声排放信息",   "hpsp/sound/sound!soundInfo.action"),
    ("card14", "自行监测要求",       "hpsp/zxjc/zxjc!waterFqwrw.action"),
    ("card15", "台账记录要求",       "hpsp/hjgltz/hjgltz!account.action"),
    ("card16", "补充登记信息",       "hpsp/bcdj!registration.action"),
    ("card17", "地方增加内容",       "hpsp!partContent.action"),
    ("card18", "相关附件",           "../filecontrol/file-control!sbclopen.action?wysbtype=PWXKZFILE"),
    ("card19", "提交申请",           "hpsp!accept.action"),
]

BASE = "https://permit.mee.gov.cn/permitExt"
# 每个 action 的完整基路径（相对于 permitExt）
# hpsp/... 在 syssb/wysb/hpsp/ 下
# cpcn/... 在 syssb/cpcn/ 下
# 其他在各自的 syssb/wysb/子目录 下
def _card_url(action_path):
    """构建卡片完整URL"""
    if action_path.startswith("hpsp!"):
        return f"{BASE}/syssb/wysb/hpsp/{action_path}"
    elif action_path.startswith("cpcn"):
        return f"{BASE}/syssb/cpcn/{action_path}"
    elif action_path.startswith("hpsp/"):
        return f"{BASE}/syssb/wysb/{action_path}"
    elif action_path.startswith("../"):
        return f"{BASE}/common/{action_path[3:]}"
    else:
        return f"{BASE}/syssb/wysb/hpsp/{action_path}"


async def _get_dataid(page):
    """从变更列表获取最新审批通过的 dataid"""
    # 先回到仪表盘再导航到变更列表（避免直接导航被拦截）
    try:
        await page.goto("https://permit.mee.gov.cn/permitExt/outside/LicenseRedirect",
                         wait_until="domcontentloaded", timeout=20000)
        await page.wait_for_timeout(2000)
    except:
        pass
    await page.goto(f"https://permit.mee.gov.cn/permitExt/syssb/ckxm/ckxm!listBcbg.action"
                     "?itemTypeID=XZXKTYPE_A&itemtype=TYPEC&searchItem=TYPEC_1",
                     wait_until="domcontentloaded", timeout=45000)
    await page.wait_for_timeout(4000)

    dataid = await page.evaluate(
        "()=>{const a=document.querySelectorAll('a');"
        "for(const el of a){const h=el.href||'';if(!h.includes('zxtb'))continue;"
        "const m=h.match(/'([a-zA-Z0-9-]{30,40})'/);if(m&&m[1].length>30)return m[1];}"
        "return ''}"
    )
    return dataid


async def read_license_full(session_id: str, dataid: str = None,
                          on_progress=None) -> dict:
    """一次性读取许可证全部20项（每张卡独立导航，稳定可靠）
    on_progress(step, total, card_name) — 可选进度回调
    """
    session = _active_sessions.get(session_id)
    if not session or not session.logged_in:
        return {"ok": False, "detail": "未登录"}

    page = session.page
    total = len(LICENSE_CARDS)
    try:
        if not dataid:
            if on_progress: await on_progress("获取许可数据...", 0, total)
            dataid = await _get_dataid(page)
            if not dataid:
                return {"ok": False, "detail": "未找到审批通过的许可记录"}

        print(f"[LicenseReader] dataid={dataid[:20]}...")
        result = {"ok": True, "dataid": dataid, "cards": {}}

        for idx, (card_id, name, action_path) in enumerate(LICENSE_CARDS):
            # 推送进度
            if on_progress:
                await on_progress(f"读取 {name}", idx + 1, total)

            num = card_id.replace("card", "")
            base_url = _card_url(action_path)
            url = (f"{base_url}?dataid={dataid}&operate=readonly"
                   f"&cardid={card_id}&itemtypeid=XZXKTYPE_A")
            print(f"[LicenseReader] {card_id}: {name} → {action_path[:40]}")

            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=20000)
                await page.wait_for_timeout(2500)
                t = await page.inner_text("body")

                tables = await page.evaluate(
                    "()=>{return Array.from(document.querySelectorAll('table')).map(t=>({"
                    "rows:Array.from(t.querySelectorAll('tr')).slice(0,100).map(r=>"
                    "Array.from(r.querySelectorAll('td,th')).map(c=>c.innerText.trim().substring(0,150)))"
                    "})).filter(t=>t.rows.length>1&&t.rows.some(r=>r.some(c=>c.length>2)))}"
                )

                result["cards"][card_id] = {
                    "name": name, "text": t[:6000], "tables": tables[:30]
                }
            except Exception as e:
                result["cards"][card_id] = {"name": name, "error": str(e), "text": "", "tables": []}

        if on_progress:
            await on_progress("数据整理完成 ✓", total, total)

        print(f"[LicenseReader] 完成: {len(result['cards'])} 项")
        return result
    except Exception as e:
        import traceback; traceback.print_exc()
        return {"ok": False, "detail": str(e)}


async def read_license_card(session_id: str, card_number: int, dataid: str = None) -> dict:
    """读取单张卡片"""
    session = _active_sessions.get(session_id)
    if not session:
        return {"ok": False, "detail": "未登录"}

    card = next((c for c in LICENSE_CARDS if int(c[0].replace("card", "")) == card_number), None)
    if not card:
        return {"ok": False, "detail": f"无效卡号 {card_number} (0-19)"}

    page = session.page
    try:
        if not dataid:
            dataid = await _get_dataid(page)

        base_url = _card_url(card[2])
        url = (f"{base_url}?dataid={dataid}&operate=readonly"
               f"&cardid={card[0]}&itemtypeid=XZXKTYPE_A")

        await page.goto(url, wait_until="domcontentloaded", timeout=20000)
        await page.wait_for_timeout(3000)
        t = await page.inner_text("body")

        tables = await page.evaluate(
            "()=>{return Array.from(document.querySelectorAll('table')).map(t=>({"
            "rows:Array.from(t.querySelectorAll('tr')).slice(0,100).map(r=>"
            "Array.from(r.querySelectorAll('td,th')).map(c=>c.innerText.trim().substring(0,150)))"
            "})).filter(t=>t.rows.length>1&&t.rows.some(r=>r.some(c=>c.length>2)))}"
        )

        return {"ok": True, "dataid": dataid, "card": card[0], "name": card[1],
                "text": t[:6000], "tables": tables}
    except Exception as e:
        return {"ok": False, "detail": str(e)}


async def quick_check(session_id: str) -> dict:
    """快速巡检（仅仪表盘状态）"""
    session = _active_sessions.get(session_id)
    if not session:
        return {"ok": False, "detail": "未登录"}

    page = session.page
    try:
        await page.goto("https://permit.mee.gov.cn/permitExt/outside/LicenseRedirect",
                         wait_until="domcontentloaded", timeout=20000)
        await page.wait_for_timeout(3000)
        t = await page.inner_text("body")

        def _find(pat, group=1, default=""):
            m = re.search(pat, t, re.DOTALL)
            return m.group(group).strip() if m else default

        return {
            "ok": True,
            "report_status": _find(r'执行报告信息\s*(.+?)\s*(\d{4}-\d{2}-\d{2})'),
            "report_date": _find(r'执行报告信息\s*(.+?)\s*(\d{4}-\d{2}-\d{2})', 2),
            "permit_status": _find(r'许可申请信息\s*(.+?)\s*(\d{4}-\d{2}-\d{2})'),
            "permit_date": _find(r'许可申请信息\s*(.+?)\s*(\d{4}-\d{2}-\d{2})', 2),
            "monitoring": _find(r'监测业务信息\s*\n?(.+)', 1, "暂无数据"),
            "rectification": _find(r'改正规定消息\s*\n?(.+)', 1, "暂无数据"),
        }
    except Exception as e:
        return {"ok": False, "detail": str(e)}
