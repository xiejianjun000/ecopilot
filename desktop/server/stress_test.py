"""
EcoPilot 对话流压力测试脚本 — 100+轮端到端测试

测试目标：
1. API 健康检查
2. 认证 Token 获取
3. 流式对话响应
4. 错误处理和边界情况
5. 并发请求处理

运行方式：
1. 先启动后端服务：python chat_api.py --port 8002
2. 运行测试：python stress_test.py

测试指标：
- 成功率 > 95%
- 平均响应时间 < 5s
- 最大响应时间 < 30s
"""

import asyncio
import json
import time
import random
import sys
import os
from typing import List, Dict, Tuple, Optional
from datetime import datetime

try:
    import httpx
except ImportError:
    print("安装依赖：pip install httpx")
    sys.exit(1)

BASE_URL = "http://127.0.0.1:8002"

# 测试用问题库 — 覆盖合规助手常见使用场景
TEST_QUESTIONS = [
    "你好",
    "介绍一下你自己",
    "排污许可证到期了怎么办",
    "执行报告什么时候提交",
    "台账需要记录哪些内容",
    "自行监测的频次要求是什么",
    "固废管理计划怎么编",
    "应急预案需要包含哪些内容",
    "清洁生产审核多久做一次",
    "环保税怎么申报",
    "信息公开需要公开哪些内容",
    "排放口规范化要求有哪些",
    "废气排放标准是什么",
    "废水排放标准是什么",
    "噪声排放标准是什么",
    "危险废物转移联单怎么填",
    "环评批复有效期是多久",
    "竣工环保验收需要哪些材料",
    "排污许可证变更需要什么手续",
    "许可证延续需要提前多久申请",
    "超标排放会有什么处罚",
    "在线监测数据怎么上报",
    "监测设备校准周期要求",
    "自动监控设备怎么验收",
    "数据异常怎么处理",
    "环保处罚记录怎么查询",
    "合规检查有哪些要点",
    "环境管理体系怎么建立",
    "ISO14001认证流程",
    "碳达峰碳中和目标是什么",
    "碳排放报告怎么编制",
    "温室气体排放核算方法",
    "碳交易市场怎么参与",
    "环保专项资金怎么申请",
    "绿色信贷政策是什么",
    "环境信用评价怎么评",
    "生态环境法典有哪些变化",
    "新环保法的主要特点",
    "水污染防治法要点",
    "大气污染防治法要点",
    "固体废物污染环境防治法要点",
    "环境影响评价法要点",
    "排污许可管理条例要点",
    "突发环境事件应急管理办法",
    "环境行政处罚办法",
    "环境监测管理办法",
    "企业环境信息依法披露管理办法",
    "排污单位自行监测技术指南",
    "排污许可证申请与核发技术规范",
    "危险废物经营许可证管理办法",
    "废弃电器电子产品处理资格管理办法",
    "化学品环境管理登记办法",
    "放射性同位素与射线装置安全许可管理办法",
    "建设项目环境影响评价分类管理名录",
    "生态环境监测质量管理办法",
    "环境信息公开办法",
    "环境信访办法",
    "环境行政复议办法",
    "环境行政诉讼办法",
    "环境民事公益诉讼办法",
    "生态环境损害赔偿制度",
    "环境污染强制责任保险",
    "生态环境监测数据弄虚作假行为判定及处理办法",
    "排污单位台账管理技术规范",
    "排污许可证执行报告技术规范",
    "企业环境风险分级管控指南",
    "突发环境事件应急预案编制导则",
    "危险废物规范化管理指标体系",
    "一般工业固体废物贮存和填埋污染控制标准",
    "危险废物贮存污染控制标准",
    "危险废物焚烧污染控制标准",
    "危险废物填埋污染控制标准",
    "挥发性有机物无组织排放控制标准",
    "大气污染物综合排放标准",
    "污水综合排放标准",
    "工业企业厂界环境噪声排放标准",
    "建筑施工场界环境噪声排放标准",
    "社会生活环境噪声排放标准",
    "锅炉大气污染物排放标准",
    "火电厂大气污染物排放标准",
    "钢铁工业大气污染物排放标准",
    "水泥工业大气污染物排放标准",
    "石油炼制工业污染物排放标准",
    "合成树脂工业污染物排放标准",
    "制药工业污染物排放标准",
    "纺织染整工业水污染物排放标准",
    "造纸工业水污染物排放标准",
    "食品工业水污染物排放标准",
    "畜禽养殖业污染物排放标准",
    "医疗机构水污染物排放标准",
    "城镇污水处理厂污染物排放标准",
    "生活垃圾填埋场污染控制标准",
    "生活垃圾焚烧污染控制标准",
    "电子废物污染控制标准",
    "铅酸蓄电池生产污染防治技术政策",
    "废弃电器电子产品污染防治技术政策",
    "危险废物污染防治技术政策",
    "水污染防治技术政策",
    "大气污染防治技术政策",
    "清洁生产审核暂行办法",
    "循环经济促进法要点",
    "节约能源法要点",
]

# 边界测试用例
EDGE_CASES = [
    "",
    " ",
    "a" * 5000,
    "测试" * 1000,
    "\x00\x01\x02\x03",
    "<script>alert(1)</script>",
    "SELECT * FROM users",
    "DROP TABLE users",
    "' OR 1=1 --",
    "; DROP TABLE users;",
]


class StressTestResult:
    """测试结果统计"""

    def __init__(self):
        self.total = 0
        self.success = 0
        self.failure = 0
        self.errors: List[Dict] = []
        self.latencies: List[float] = []
        self.throughput = 0.0

    @property
    def success_rate(self) -> float:
        return self.success / self.total * 100 if self.total > 0 else 0

    @property
    def avg_latency(self) -> float:
        return sum(self.latencies) / len(self.latencies) if self.latencies else 0

    @property
    def min_latency(self) -> float:
        return min(self.latencies) if self.latencies else 0

    @property
    def max_latency(self) -> float:
        return max(self.latencies) if self.latencies else 0

    @property
    def p95_latency(self) -> float:
        if not self.latencies:
            return 0
        sorted_latencies = sorted(self.latencies)
        idx = int(len(sorted_latencies) * 0.95)
        return sorted_latencies[idx] if idx < len(sorted_latencies) else sorted_latencies[-1]

    def print_summary(self):
        print("\n" + "=" * 70)
        print("                    EcoPilot 对话流压力测试报告")
        print("=" * 70)
        print(f"测试时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"测试轮数: {self.total}")
        print(f"成功轮数: {self.success}")
        print(f"失败轮数: {self.failure}")
        print(f"成功率:   {self.success_rate:.2f}%")
        print(f"吞吐量:   {self.throughput:.2f} 请求/秒")
        print("\n延迟统计（秒）:")
        print(f"  平均: {self.avg_latency:.2f}")
        print(f"  最小: {self.min_latency:.2f}")
        print(f"  最大: {self.max_latency:.2f}")
        print(f"  P95:  {self.p95_latency:.2f}")

        if self.errors:
            print(f"\n失败详情（前10条）:")
            for i, err in enumerate(self.errors[:10], 1):
                print(f"  {i}. [{err['code']}] {err['msg']}")
                if err.get("question"):
                    print(f"     问题: {err['question'][:50]}...")


async def get_auth_token() -> Optional[str]:
    """获取认证 Token"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{BASE_URL}/api/auth/token")
            if resp.status_code == 200:
                data = resp.json()
                return data.get("token")
    except Exception as e:
        print(f"获取 Token 失败: {e}")
    return None


async def check_health() -> bool:
    """健康检查"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{BASE_URL}/api/chat/health")
            if resp.status_code == 200:
                data = resp.json()
                print(f"健康检查: 文本模型={data.get('text_model','')} ({'就绪' if data.get('text_ready') else '未就绪'})")
                print(f"         视觉模型={data.get('vision_model','')} ({'就绪' if data.get('vision_ready') else '未就绪'})")
                return True
    except Exception as e:
        print(f"健康检查失败: {e}")
    return False


async def send_chat_request(token: str, question: str, timeout: int = 60) -> Tuple[bool, float, Optional[str]]:
    """发送单条对话请求"""
    start_time = time.time()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                f"{BASE_URL}/api/chat/stream",
                headers=headers,
                json={"message": question},
            ) as resp:
                if resp.status_code != 200:
                    elapsed = time.time() - start_time
                    return False, elapsed, f"HTTP {resp.status_code}"

                full_response = ""
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        try:
                            data = json.loads(line[6:])
                            if data.get("type") == "text_delta" and isinstance(data.get("text"), str):
                                full_response += data["text"]
                            elif data.get("type") == "error":
                                return False, time.time() - start_time, data.get("text", "未知错误")
                            elif data.get("type") == "done":
                                break
                        except json.JSONDecodeError:
                            pass

                elapsed = time.time() - start_time
                if full_response.strip():
                    return True, elapsed, None
                return False, elapsed, "无响应内容"

    except httpx.TimeoutException:
        elapsed = time.time() - start_time
        return False, elapsed, "超时"
    except Exception as e:
        elapsed = time.time() - start_time
        return False, elapsed, str(e)


async def run_single_test(token: str, question: str, index: int, result: StressTestResult):
    """运行单条测试"""
    result.total += 1
    success, latency, error = await send_chat_request(token, question)

    if success:
        result.success += 1
        result.latencies.append(latency)
        if index % 10 == 0:
            print(f"[OK] 第 {index:3d} 轮: {question[:30]}... ({latency:.2f}s)")
    else:
        result.failure += 1
        result.errors.append({
            "index": index,
            "question": question,
            "code": "FAIL",
            "msg": error,
            "latency": latency,
        })
        print(f"[FAIL] 第 {index:3d} 轮: {question[:30]}... ({error})")


async def run_stress_test(token: str, rounds: int = 100, concurrent: int = 5):
    """运行压力测试"""
    result = StressTestResult()
    start_total = time.time()

    print(f"\n开始压力测试: {rounds} 轮对话, 并发数: {concurrent}")
    print("-" * 70)

    # 生成测试问题列表
    questions = []
    for i in range(rounds):
        if i < len(TEST_QUESTIONS):
            questions.append(TEST_QUESTIONS[i])
        else:
            questions.append(random.choice(TEST_QUESTIONS))

    # 添加边界测试用例
    questions.extend(EDGE_CASES[:5])

    # 分批并发执行
    semaphore = asyncio.Semaphore(concurrent)

    async def bounded_test(question: str, index: int):
        async with semaphore:
            await run_single_test(token, question, index, result)

    tasks = [bounded_test(q, i + 1) for i, q in enumerate(questions)]
    await asyncio.gather(*tasks)

    result.throughput = result.total / (time.time() - start_total)
    return result


async def run_api_endpoint_test(token: str):
    """测试其他关键 API 端点"""
    print("\n" + "=" * 70)
    print("                    API 端点可用性测试")
    print("=" * 70)

    endpoints = [
        ("GET", "/api/models/available", {}),
        ("GET", "/api/enterprise", {}),
        ("GET", "/api/user", {}),
        ("GET", "/api/vault/list", {}),
        ("GET", "/api/license/status", {}),
    ]

    headers = {"Authorization": f"Bearer {token}"}
    all_passed = True

    for method, path, body in endpoints:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                if method == "GET":
                    resp = await client.get(f"{BASE_URL}{path}", headers=headers)
                else:
                    resp = await client.post(f"{BASE_URL}{path}", headers=headers, json=body)

                if resp.status_code == 200:
                    print(f"[OK] {method:4s} {path}")
                else:
                    print(f"[FAIL] {method:4s} {path} -> HTTP {resp.status_code}")
                    all_passed = False
        except Exception as e:
            print(f"[FAIL] {method:4s} {path} -> {e}")
            all_passed = False

    return all_passed


async def main():
    print("=" * 70)
    print("          EcoPilot 对话流端到端压力测试")
    print("=" * 70)

    # 1. 健康检查
    print("\n1. 后端服务健康检查")
    if not await check_health():
        print("后端服务未就绪，请先启动服务: python chat_api.py --port 8002")
        sys.exit(1)

    # 2. 获取认证 Token
    print("\n2. 获取认证 Token")
    token = await get_auth_token()
    if not token:
        print("获取 Token 失败")
        sys.exit(1)
    print(f"Token 获取成功: {token[:16]}...")

    # 3. API 端点测试
    await run_api_endpoint_test(token)

    # 4. 压力测试
    result = await run_stress_test(token, rounds=100, concurrent=5)
    result.print_summary()

    # 5. 验证指标
    print("\n" + "=" * 70)
    print("                    测试指标验证")
    print("=" * 70)

    thresholds = [
        ("成功率 > 95%", result.success_rate > 95),
        ("平均延迟 < 5s", result.avg_latency < 5),
        ("最大延迟 < 30s", result.max_latency < 30),
        ("P95 延迟 < 10s", result.p95_latency < 10),
    ]

    all_passed = True
    for name, passed in thresholds:
        status = "✅" if passed else "❌"
        print(f"{status} {name}: {result.success_rate:.1f}% / {result.avg_latency:.2f}s / {result.max_latency:.2f}s / {result.p95_latency:.2f}s")
        if not passed:
            all_passed = False

    print("\n" + "=" * 70)
    if all_passed:
        print("                    ✅ 所有测试通过！")
    else:
        print("                    ❌ 部分测试未通过，请检查！")
    print("=" * 70)

    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
