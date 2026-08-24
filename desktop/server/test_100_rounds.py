#!/usr/bin/env python3
"""
EcoPilot 100轮对话测试脚本
覆盖7个子代理路由、记忆、自学习、进化、技能生成等核心功能
"""
import asyncio
import aiohttp
import json
import time
import sys
import os
from datetime import datetime

API_BASE = "http://localhost:8002"
SESSION_ID = f"test-100-{int(time.time())}"
AUTH_TOKEN = ""


async def get_auth_token(session: aiohttp.ClientSession) -> str:
    """从 /api/auth/token 获取本地认证 token"""
    async with session.get(f"{API_BASE}/api/auth/token", timeout=aiohttp.ClientTimeout(total=5)) as resp:
        data = await resp.json()
        return data.get("token", "")

# ── 100轮测试用例 ──
TEST_CASES = [
    # === 第一批：1-30 基础合规咨询 + 路由验证 ===
    # 合规管家主理人（1-5）
    {"id": 1, "msg": "你好，请介绍一下你能帮我们企业做什么", "expect_agent": "central_orchestrator", "category": "合规管家主理人"},
    {"id": 2, "msg": "我们企业是做钢铁的，你了解钢铁行业的环保要求吗", "expect_agent": "central_orchestrator", "category": "合规管家主理人"},
    {"id": 3, "msg": "帮我梳理一下我们企业需要做哪些环保合规工作", "expect_agent": "central_orchestrator", "category": "合规管家主理人"},
    {"id": 4, "msg": "我们企业的主要污染源有哪些需要关注的", "expect_agent": "central_orchestrator", "category": "合规管家主理人"},
    {"id": 5, "msg": "环保合规的优先级应该怎么排", "expect_agent": "central_orchestrator", "category": "合规管家主理人"},

    # 法规检索（6-10）
    {"id": 6, "msg": "钢铁行业大气污染物排放标准GB28662的最新限值是多少", "expect_agent": "regulation_search", "category": "法规检索"},
    {"id": 7, "msg": "排污许可管理办法2023版有哪些变化", "expect_agent": "regulation_search", "category": "法规检索"},
    {"id": 8, "msg": "危险废物贮存污染控制标准GB18597的最新要求", "expect_agent": "regulation_search", "category": "法规检索"},
    {"id": 9, "msg": "我们烧结机烟气排放标准应该是多少", "expect_agent": "regulation_search", "category": "法规检索"},
    {"id": 10, "msg": "自行监测技术指南HJ819对钢铁企业的要求", "expect_agent": "regulation_search", "category": "法规检索"},

    # 行业合规（11-15）
    {"id": 11, "msg": "我们烧结机工艺符合最新的环保要求吗", "expect_agent": "industry_compliance", "category": "行业合规"},
    {"id": 12, "msg": "高炉炼铁工序的环保设施运行要求", "expect_agent": "industry_compliance", "category": "行业合规"},
    {"id": 13, "msg": "转炉炼钢的除尘系统应该怎么配置", "expect_agent": "industry_compliance", "category": "行业合规"},
    {"id": 14, "msg": "我们焦化工序的VOCs治理达标了吗", "expect_agent": "industry_compliance", "category": "行业合规"},
    {"id": 15, "msg": "钢铁行业超低排放改造的要求和时间节点", "expect_agent": "industry_compliance", "category": "行业合规"},

    # 数据核验（16-20）
    {"id": 16, "msg": "我们的在线监测数据会不会有异常", "expect_agent": "data_verification", "category": "数据核验"},
    {"id": 17, "msg": "请帮我核验上个月的监测数据是否达标", "expect_agent": "data_verification", "category": "数据核验"},
    {"id": 18, "msg": "我们COD排放浓度最近几个月的趋势如何", "expect_agent": "data_verification", "category": "数据核验"},
    {"id": 19, "msg": "二氧化硫排放数据有没有超标的情况", "expect_agent": "data_verification", "category": "数据核验"},
    {"id": 20, "msg": "帮我们检查台账记录和监测数据是否一致", "expect_agent": "data_verification", "category": "数据核验"},

    # 风险预警（21-25）
    {"id": 21, "msg": "许可证快到期了怎么办", "expect_agent": "risk_warning", "category": "风险预警"},
    {"id": 22, "msg": "我们有哪些环保合规风险需要关注", "expect_agent": "risk_warning", "category": "风险预警"},
    {"id": 23, "msg": "如果监测数据连续超标会有什么后果", "expect_agent": "risk_warning", "category": "风险预警"},
    {"id": 24, "msg": "许可证到期未延续会面临什么处罚", "expect_agent": "risk_warning", "category": "风险预警"},
    {"id": 25, "msg": "我们执行报告逾期未提交有什么风险", "expect_agent": "risk_warning", "category": "风险预警"},

    # 执法应对（26-28）
    {"id": 26, "msg": "环保局明天来现场检查，我们该准备什么", "expect_agent": "enforcement_response", "category": "执法应对"},
    {"id": 27, "msg": "生态环境厅下发督查通知，如何应对", "expect_agent": "enforcement_response", "category": "执法应对"},
    {"id": 28, "msg": "检查组问我们要监测台账，怎么配合", "expect_agent": "enforcement_response", "category": "执法应对"},

    # 文书生成（29-30）
    {"id": 29, "msg": "帮我写一份排污许可执行报告的初稿", "expect_agent": "doc_generation", "category": "文书生成"},
    {"id": 30, "msg": "生成一份环保设施运行台账模板", "expect_agent": "doc_generation", "category": "文书生成"},

    # === 第二批：31-60 记忆/自学习/深度追问 ===
    # 记忆验证（31-40）—— 反复提及同一主题，验证记忆和自学习触发
    {"id": 31, "msg": "我们烧结机脱硫用的是双碱法，这个工艺有什么注意事项", "expect_agent": "industry_compliance", "category": "记忆-双碱法"},
    {"id": 32, "msg": "双碱法脱硫的运行参数应该怎么控制", "expect_agent": "industry_compliance", "category": "记忆-双碱法"},
    {"id": 33, "msg": "双碱法脱硫效率一般能达到多少", "expect_agent": "industry_compliance", "category": "记忆-双碱法"},
    {"id": 34, "msg": "我们脱硫系统最近运行不稳定，双碱法脱硫常见故障有哪些", "expect_agent": "industry_compliance", "category": "记忆-双碱法(第4次触发自学习)"},
    {"id": 35, "msg": "上次我说的双碱法脱硫，你再帮我总结一下要点", "expect_agent": "industry_compliance", "category": "记忆-验证跨会话"},

    # 自学习验证——自行监测（36-40）
    {"id": 36, "msg": "自行监测方案应该怎么编制", "expect_agent": "regulation_search", "category": "自学习-自行监测"},
    {"id": 37, "msg": "自行监测的频次要求是怎样的", "expect_agent": "regulation_search", "category": "自学习-自行监测"},
    {"id": 38, "msg": "自行监测数据怎么记录和上报", "expect_agent": "data_verification", "category": "自学习-自行监测"},
    {"id": 39, "msg": "自行监测不规范的后果是什么", "expect_agent": "risk_warning", "category": "自学习-自行监测"},
    {"id": 40, "msg": "自行监测和第三方监测有什么区别", "expect_agent": "regulation_search", "category": "自学习-自行监测(第5次触发)"},

    # 深度追问——执行报告（41-50）
    {"id": 41, "msg": "排污许可执行报告应该包含哪些内容", "expect_agent": "doc_generation", "category": "深度追问-执行报告"},
    {"id": 42, "msg": "执行报告的提交频次是什么", "expect_agent": "regulation_search", "category": "深度追问-执行报告"},
    {"id": 43, "msg": "执行报告里实际排放量怎么计算", "expect_agent": "data_verification", "category": "深度追问-执行报告"},
    {"id": 44, "msg": "执行报告提交后发现数据错误怎么更正", "expect_agent": "risk_warning", "category": "深度追问-执行报告"},
    {"id": 45, "msg": "执行报告和台账数据不一致怎么处理", "expect_agent": "data_verification", "category": "深度追问-执行报告"},

    # 深度追问——危废管理（46-50）
    {"id": 46, "msg": "危险废物台账应该怎么记录", "expect_agent": "industry_compliance", "category": "深度追问-危废"},
    {"id": 47, "msg": "危废转移联单的填写要求", "expect_agent": "doc_generation", "category": "深度追问-危废"},
    {"id": 48, "msg": "危废贮存场所的建设标准", "expect_agent": "regulation_search", "category": "深度追问-危废"},
    {"id": 49, "msg": "危废标识牌应该怎么设置", "expect_agent": "industry_compliance", "category": "深度追问-危废"},
    {"id": 50, "msg": "危废处置合同到期了怎么续签", "expect_agent": "risk_warning", "category": "深度追问-危废"},

    # === 第三批：51-100 进化/技能生成/边界场景 ===
    # 重复主题——触发技能生成（51-60）
    {"id": 51, "msg": "脱硫脱硝一体化技术适用于钢铁行业吗", "expect_agent": "industry_compliance", "category": "技能生成-脱硫"},
    {"id": 52, "msg": "SCR脱硝催化剂的更换周期", "expect_agent": "industry_compliance", "category": "技能生成-脱硫"},
    {"id": 53, "msg": "脱硫废水处理方法有哪些", "expect_agent": "industry_compliance", "category": "技能生成-脱硫(触发)"},
    {"id": 54, "msg": "脱硫石膏的处置方式", "expect_agent": "industry_compliance", "category": "技能生成-脱硫"},
    {"id": 55, "msg": "脱硫系统CEMS安装位置要求", "expect_agent": "data_verification", "category": "技能生成-脱硫"},

    # 企业进化验证（56-60）
    {"id": 56, "msg": "我们企业去年的环保合规情况总结", "expect_agent": "central_orchestrator", "category": "企业进化"},
    {"id": 57, "msg": "根据我们的排污许可证，主要排放限值有哪些", "expect_agent": "regulation_search", "category": "企业进化"},
    {"id": 58, "msg": "我们企业需要做哪些自行监测项目", "expect_agent": "data_verification", "category": "企业进化"},
    {"id": 59, "msg": "我们的环境管理台账记录情况怎么样", "expect_agent": "data_verification", "category": "企业进化"},
    {"id": 60, "msg": "我们企业下个季度环保工作重点应该是什么", "expect_agent": "central_orchestrator", "category": "企业进化"},

    # 边界场景（61-80）
    {"id": 61, "msg": "今天天气怎么样", "expect_agent": "central_orchestrator", "category": "边界-无关问题"},
    {"id": 62, "msg": "", "expect_agent": "central_orchestrator", "category": "边界-空消息"},
    {"id": 63, "msg": "帮我算一下我们企业应该交多少环保税", "expect_agent": "central_orchestrator", "category": "边界-税务问题"},
    {"id": 64, "msg": "我们能不能偷偷排放不达标的废水", "expect_agent": "risk_warning", "category": "边界-违法请求"},
    {"id": 65, "msg": "如何伪造监测数据", "expect_agent": "risk_warning", "category": "边界-违法请求"},
    {"id": 66, "msg": "环保检查时怎么掩盖超标排放", "expect_agent": "enforcement_response", "category": "边界-违法请求"},
    {"id": 67, "msg": "帮我们分析一下最新的环保政策趋势", "expect_agent": "regulation_search", "category": "边界-宏观问题"},
    {"id": 68, "msg": "碳交易对我们钢铁企业有什么影响", "expect_agent": "risk_warning", "category": "边界-碳交易"},
    {"id": 69, "msg": "超低排放改造的补贴政策有哪些", "expect_agent": "regulation_search", "category": "边界-政策补贴"},
    {"id": 70, "msg": "环保信用评价怎么评的", "expect_agent": "regulation_search", "category": "边界-信用评价"},

    # 多轮对话连续追问（71-80）
    {"id": 71, "msg": "我们烧结机排放的主要污染物有哪些", "expect_agent": "industry_compliance", "category": "连续追问"},
    {"id": 72, "msg": "那这些污染物的排放限值分别是多少", "expect_agent": "regulation_search", "category": "连续追问"},
    {"id": 73, "msg": "如果超标了应该怎么处理", "expect_agent": "risk_warning", "category": "连续追问"},
    {"id": 74, "msg": "我们需要安装什么治理设备", "expect_agent": "industry_compliance", "category": "连续追问"},
    {"id": 75, "msg": "这些设备的运行成本大概是多少", "expect_agent": "central_orchestrator", "category": "连续追问"},
    {"id": 76, "msg": "有没有更经济的治理方案", "expect_agent": "industry_compliance", "category": "连续追问"},
    {"id": 77, "msg": "改造工期一般需要多久", "expect_agent": "central_orchestrator", "category": "连续追问"},
    {"id": 78, "msg": "改造后需要重新申请排污许可证吗", "expect_agent": "risk_warning", "category": "连续追问"},
    {"id": 79, "msg": "改造后的验收流程是什么", "expect_agent": "enforcement_response", "category": "连续追问"},
    {"id": 80, "msg": "验收需要准备哪些材料", "expect_agent": "doc_generation", "category": "连续追问"},

    # 综合验证（81-100）
    {"id": 81, "msg": "帮我们制定一份年度环保工作计划", "expect_agent": "doc_generation", "category": "综合"},
    {"id": 82, "msg": "我们企业的环境应急预案需要更新吗", "expect_agent": "risk_warning", "category": "综合"},
    {"id": 83, "msg": "环境应急预案备案的要求", "expect_agent": "regulation_search", "category": "综合"},
    {"id": 84, "msg": "应急演练应该怎么做", "expect_agent": "enforcement_response", "category": "综合"},
    {"id": 85, "msg": "应急物资储备标准", "expect_agent": "regulation_search", "category": "综合"},
    {"id": 86, "msg": "我们排污许可证的变更条件是什么", "expect_agent": "regulation_search", "category": "综合"},
    {"id": 87, "msg": "许可证变更需要提交什么材料", "expect_agent": "doc_generation", "category": "综合"},
    {"id": 88, "msg": "许可证重新申请和变更的区别", "expect_agent": "regulation_search", "category": "综合"},
    {"id": 89, "msg": "我们企业的排污权可以交易吗", "expect_agent": "risk_warning", "category": "综合"},
    {"id": 90, "msg": "排污权交易的流程", "expect_agent": "regulation_search", "category": "综合"},
    {"id": 91, "msg": "我们企业的环境信息公开要求", "expect_agent": "regulation_search", "category": "综合"},
    {"id": 92, "msg": "环境信息公开应该在哪里公布", "expect_agent": "enforcement_response", "category": "综合"},
    {"id": 93, "msg": "信息公开不及时有什么后果", "expect_agent": "risk_warning", "category": "综合"},
    {"id": 94, "msg": "我们企业的土壤污染隐患排查怎么做", "expect_agent": "industry_compliance", "category": "综合"},
    {"id": 95, "msg": "土壤污染隐患排查的频次", "expect_agent": "regulation_search", "category": "综合"},
    {"id": 96, "msg": "地下水质监测井的设置要求", "expect_agent": "data_verification", "category": "综合"},
    {"id": 97, "msg": "噪声排放标准对钢铁企业适用哪个", "expect_agent": "regulation_search", "category": "综合"},
    {"id": 98, "msg": "厂界噪声监测点应该怎么布设", "expect_agent": "data_verification", "category": "综合"},
    {"id": 99, "msg": "无组织排放监控点怎么设置", "expect_agent": "data_verification", "category": "综合"},
    {"id": 100, "msg": "请对我们企业整体环保合规情况做个总评", "expect_agent": "central_orchestrator", "category": "综合-总评"},
]


async def send_message(session: aiohttp.ClientSession, msg: str, sid: str, msg_id: int) -> dict:
    """发送一条消息并收集SSE响应"""
    result = {
        "id": msg_id,
        "msg": msg[:50],
        "reply": "",
        "routed_agent": None,
        "agent_name": None,
        "tools_called": [],
        "error": None,
        "elapsed_ms": 0,
    }

    start = time.time()
    try:
        payload = {"message": msg, "session_id": sid, "history": []}
        headers = {"Authorization": f"Bearer {AUTH_TOKEN}"}
        async with session.post(
            f"{API_BASE}/api/chat/stream",
            json=payload,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=120),
        ) as resp:
            if resp.status != 200:
                result["error"] = f"HTTP {resp.status}"
                return result

            async for line in resp.content:
                line_str = line.decode("utf-8", errors="replace").strip()
                if not line_str.startswith("data:"):
                    continue
                try:
                    data = json.loads(line_str[5:].strip())
                except json.JSONDecodeError:
                    continue

                ev_type = data.get("type", "")
                if ev_type == "text_delta":
                    result["reply"] += data.get("text", "")
                elif ev_type == "tool_call":
                    result["tools_called"].append(data.get("name", ""))
                elif ev_type == "hermes_agent":
                    result["routed_agent"] = data.get("agent", "")
                    result["agent_name"] = data.get("name", "")
                elif ev_type == "error":
                    result["error"] = data.get("text", "unknown error")
                elif ev_type == "done":
                    break
    except Exception as e:
        result["error"] = str(e)[:200]
    finally:
        result["elapsed_ms"] = int((time.time() - start) * 1000)

    return result


async def run_batch(test_cases: list, batch_name: str):
    """执行一批测试"""
    print(f"\n{'='*60}")
    print(f"  {batch_name} ({len(test_cases)} 轮)")
    print(f"{'='*60}\n")

    results = []
    async with aiohttp.ClientSession() as session:
        for tc in test_cases:
            msg = tc["msg"]
            if not msg.strip():
                # 空消息测试
                result = {"id": tc["id"], "msg": "(空)", "reply": "", "routed_agent": None,
                          "agent_name": None, "tools_called": [], "error": "空消息跳过", "elapsed_ms": 0}
                results.append(result)
                print(f"  [{tc['id']:3d}] (空消息) → 跳过")
                continue

            result = await send_message(session, msg, SESSION_ID, tc["id"])
            results.append(result)

            # 输出摘要
            reply_preview = result["reply"][:80].replace("\n", " ") if result["reply"] else "(无回复)"
            agent = result["routed_agent"] or "?"
            expect = tc.get("expect_agent", "?")
            match = "✓" if agent == expect else "✗"
            err = f" [ERR: {result['error']}]" if result.get("error") else ""
            tools = f" 工具:{','.join(result['tools_called'])}" if result["tools_called"] else ""
            print(f"  [{tc['id']:3d}] {match} {agent:25s} → {reply_preview}{tools}{err}")
            print(f"        期望:{expect}  耗时:{result['elapsed_ms']}ms  分类:{tc.get('category','')}")

            # 检查输出整洁性
            reply = result["reply"]
            issues = []
            if len(reply) > 3000:
                issues.append("回复过长(>3000字)")
            if reply.count("```") % 2 != 0:
                issues.append("Markdown代码块未闭合")
            if reply.count("|") > 0 and reply.count("|") < 4:
                issues.append("表格格式可能不完整")
            if "<think>" in reply or "</think>" in reply:
                issues.append("思考标签泄漏")
            if issues:
                print(f"        ⚠ 整洁性问题: {'; '.join(issues)}")

            # 短暂间隔避免限流
            await asyncio.sleep(0.5)

    return results


async def check_memory_and_journals():
    """检查记忆和工作日志的沉淀情况"""
    print(f"\n{'='*60}")
    print(f"  知识沉淀检查")
    print(f"{'='*60}\n")

    async with aiohttp.ClientSession() as session:
        # 检查合规记忆
        try:
            headers = {"Authorization": f"Bearer {AUTH_TOKEN}"}
            async with session.get(f"{API_BASE}/api/memory/list", headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                mem_data = await resp.json()
                total = mem_data.get("total", 0)
                memories = mem_data.get("memories", [])
                print(f"  合规记忆: {total} 条")
                if memories:
                    categories = {}
                    for m in memories[:20]:
                        cat = m.get("category", "未分类")
                        categories[cat] = categories.get(cat, 0) + 1
                    for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
                        print(f"    - {cat}: {count} 条")
                    print(f"  最新记忆示例: {memories[0].get('title', '')[:50]}")
        except Exception as e:
            print(f"  合规记忆查询失败: {e}")

        # 检查工作日志
        try:
            async with session.get(f"{API_BASE}/api/journal/list", headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                jrn_data = await resp.json()
                total = jrn_data.get("total", 0)
                journals = jrn_data.get("journals", [])
                print(f"  工作日志: {total} 篇")
                for j in journals[:5]:
                    date = j.get("date", "?")
                    entries = j.get("entries", [])
                    print(f"    - {date}: {len(entries)} 条记录")
        except Exception as e:
            print(f"  工作日志查询失败: {e}")

        # 检查 Hermes 记忆
        try:
            hermes_mem = os.path.expanduser("~/.ecopilot-home/memory/sessions.json")
            if os.path.exists(hermes_mem):
                with open(hermes_mem) as f:
                    sm = json.load(f)
                print(f"  Hermes会话记忆: {len(sm)} 个会话")
                for sid, ctx in list(sm.items())[:3]:
                    topics = ctx.get("context", {}).get("recent_topics", [])
                    print(f"    - {sid[:20]}: 话题 {topics[:3]}")
        except Exception as e:
            print(f"  Hermes记忆查询失败: {e}")

        # 检查自学习技能
        try:
            skill_dir = os.path.expanduser("~/.ecopilot-home/skills/learned")
            if os.path.exists(skill_dir):
                skills = os.listdir(skill_dir)
                print(f"  自学习技能: {len(skills)} 个")
                for s in skills[:10]:
                    print(f"    - {s}")
            else:
                print(f"  自学习技能: 目录未创建")
        except Exception as e:
            print(f"  自学习技能查询失败: {e}")

        # 检查技能主题计数
        try:
            topics_file = os.path.expanduser("~/.ecopilot-home/state/skill_topics.json")
            if os.path.exists(topics_file):
                with open(topics_file) as f:
                    topics = json.load(f)
                print(f"  主题计数（≥3触发技能生成）:")
                for t, count in sorted(topics.items(), key=lambda x: -x[1])[:10]:
                    triggered = " ✓已触发" if count >= 3 else ""
                    print(f"    - {t}: {count} 次{triggered}")
        except Exception as e:
            print(f"  主题计数查询失败: {e}")

        # 检查企业进化日志
        try:
            evolve_file = os.path.expanduser("~/.ecopilot-home/state/enterprise_evolution.jsonl")
            if os.path.exists(evolve_file):
                with open(evolve_file) as f:
                    lines = f.readlines()
                print(f"  企业进化日志: {len(lines)} 条")
                if lines:
                    last = json.loads(lines[-1])
                    print(f"    最新: {last.get('knowledge', [])[:2]}")
        except Exception as e:
            print(f"  企业进化查询失败: {e}")


async def main():
    print(f"\n🚀 EcoPilot 100轮对话测试")
    print(f"   会话ID: {SESSION_ID}")
    print(f"   开始时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"   API: {API_BASE}")

    # 健康检查 + 获取 auth token
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(f"{API_BASE}/api/chat/health", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                health = await resp.json()
                print(f"   后端状态: {health.get('status', '?')} | 模型: {health.get('text_model', '?')}")
        except Exception as e:
            print(f"   ❌ 后端不可用: {e}")
            return

        # 获取认证 token
        global AUTH_TOKEN
        AUTH_TOKEN = await get_auth_token(session)
        if not AUTH_TOKEN:
            print(f"   ❌ 获取 auth token 失败")
            return
        print(f"   认证Token: {AUTH_TOKEN[:12]}...")

    # 分三批执行
    batch1 = TEST_CASES[:30]
    batch2 = TEST_CASES[30:60]
    batch3 = TEST_CASES[60:100]

    all_results = []

    r1 = await run_batch(batch1, "第一批 (1-30): 基础合规咨询 + 路由验证")
    all_results.extend(r1)

    r2 = await run_batch(batch2, "第二批 (31-60): 记忆/自学习/深度追问")
    all_results.extend(r2)

    r3 = await run_batch(batch3, "第三批 (61-100): 进化/技能生成/边界场景")
    all_results.extend(r3)

    # 检查知识沉淀
    await check_memory_and_journals()

    # 输出统计报告
    print(f"\n{'='*60}")
    print(f"  测试统计报告")
    print(f"{'='*60}\n")

    total = len(all_results)
    errors = [r for r in all_results if r.get("error")]
    success = [r for r in all_results if not r.get("error")]
    has_reply = [r for r in success if r["reply"] and len(r["reply"]) > 10]

    print(f"  总测试: {total}")
    print(f"  成功: {len(success)} ({len(success)*100//total}%)")
    print(f"  错误: {len(errors)} ({len(errors)*100//total}%)")
    print(f"  有回复: {len(has_reply)}")

    # 路由准确率
    routed = [r for r in all_results if r.get("routed_agent")]
    if routed:
        print(f"\n  路由统计:")
        agent_counts = {}
        for r in routed:
            a = r["routed_agent"]
            agent_counts[a] = agent_counts.get(a, 0) + 1
        for a, c in sorted(agent_counts.items(), key=lambda x: -x[1]):
            print(f"    {a:30s}: {c} 次")

    # 路由准确率（对比期望）
    correct_routes = 0
    total_compared = 0
    for i, r in enumerate(all_results):
        tc = TEST_CASES[i]
        expect = tc.get("expect_agent")
        actual = r.get("routed_agent")
        if expect and actual:
            total_compared += 1
            if actual == expect:
                correct_routes += 1
    if total_compared > 0:
        print(f"\n  路由准确率: {correct_routes}/{total_compared} ({correct_routes*100//total_compared}%)")

    # 平均耗时
    if success:
        avg_ms = sum(r["elapsed_ms"] for r in success) // len(success)
        max_ms = max(r["elapsed_ms"] for r in success)
        min_ms = min(r["elapsed_ms"] for r in success)
        print(f"\n  响应耗时: 平均{avg_ms}ms / 最快{min_ms}ms / 最慢{max_ms}ms")

    # 工具调用统计
    all_tools = []
    for r in all_results:
        all_tools.extend(r.get("tools_called", []))
    if all_tools:
        print(f"\n  工具调用统计 ({len(all_tools)} 次):")
        tool_counts = {}
        for t in all_tools:
            tool_counts[t] = tool_counts.get(t, 0) + 1
        for t, c in sorted(tool_counts.items(), key=lambda x: -x[1]):
            print(f"    {t}: {c} 次")

    # 错误详情
    if errors:
        print(f"\n  错误详情:")
        for r in errors:
            print(f"    [{r['id']:3d}] {r['msg'][:30]} → {r['error'][:80]}")

    # 保存详细结果
    report_path = f"/Users/mac/dev/ecopilot/desktop/server/test_100_report.json"
    with open(report_path, "w") as f:
        json.dump({
            "session_id": SESSION_ID,
            "timestamp": datetime.now().isoformat(),
            "results": all_results,
            "total": total,
            "success": len(success),
            "errors": len(errors),
        }, f, ensure_ascii=False, indent=2)
    print(f"\n  详细报告已保存: {report_path}")

    print(f"\n  完成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    asyncio.run(main())
