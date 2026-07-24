# EcoPilot 性能深度审查报告

> **审查日期**: 2026-07-21  
> **审查范围**: `/Users/mac/Desktop/ecopilot/desktop/server/`  
> **审查方法**: 压力测试（10轮×3并发）+ 全量代码静态分析（5707行 chat_api.py + 所有依赖模块）  
> **后端状态**: 运行中 (Python 3.11 + FastAPI, port 8002, deepseek-chat 模式)

---

## 一、压力测试结果

| 指标 | 实测值 | 阈值 | 判定 |
|------|--------|------|------|
| 成功率 | **100%** (10/10) | >95% | ✅ 通过 |
| 平均延迟 | **15.97s** | <5s | 🔴 **不达标 (3.2×)** |
| 最大延迟 | **24.63s** | <30s | 🟡 临界 |
| P95 延迟 | **24.63s** | <10s | 🔴 **不达标 (2.5×)** |
| 吞吐量 | **0.17 req/s** | - | 🔴 **极低** |

**分析**: 10轮测试在3并发下全部成功，但延迟严重超标。平均15.97秒的单轮延迟意味着每个请求实际在等待 DeepSeek API 响应 ~10-15s + 工具调用链。吞吐量仅0.17 req/s 说明串行瓶颈严重——3个并发请求几乎等于串行执行。

---

## 二、并发安全分析

### 🔴 P0 — `_sessions` 全局字典无锁保护

**位置**: `chat_api.py:568-570`

```python
_sessions: dict[str, list[dict]] = {}
_sessions_last_access: dict[str, float] = {}
_session_permit: dict[str, dict] = {}
```

**问题**: 三个全局 dict 在以下场景被并发读写，**无任何 asyncio.Lock 保护**：
- `chat_stream()` 端点写入（line 3717）
- `chat_stream()` 端点读取 `_session_permit`（line 3716）
- `_cleanup_loop()` 遍历删除（line 618-635，每5分钟）
- `_run()` 中 `_sessions[sid].append()` 追加消息（line 3742, 3841, 3854...）

**风险**: 多并发请求同时修改同一 `_sessions[sid]` 列表时，无数据竞争但 append 操作在极高并发下可能出现不一致；更严重的是 `_cleanup_loop` 的 `list(_sessions_last_access.items())` 遍历与写入的竞态可能触发 `RuntimeError: dictionary changed size during iteration`。

**建议**: 使用 `asyncio.Lock` 保护所有 `_sessions` / `_sessions_last_access` / `_session_permit` 的跨协程写入操作。

---

### 🟡 P1 — `permit_scraper._active_sessions` 无并发保护

**位置**: `permit_scraper.py:63`

```python
_active_sessions: dict[str, PermitLoginSession] = {}
```

**问题**: 与 chat_api 的 `_sessions` 同样的问题——无锁保护。`start_login_session()` 写入，`cleanup_stale_sessions()` 遍历删除，`submit_login()` / `extract_permit_data()` 读取。

**风险**: 中等。许可平台爬虫通常低频调用，但如果用户在多个 tab 同时登录，可能竞态。

---

### 🟢 P3 — `ops_monitor.py` 使用 `threading.Lock()` 保护 SQLite

**评估**: 正确实现。`threading.Lock()` 与 FastAPI async 事件循环协作良好，SQLite WAL 模式进一步提升并发。

---

## 三、内存泄漏风险

### 🔴 P0 — 每次对话触发 5-8 个 fire-and-forget 异步任务，无上限

**位置**: `chat_api.py:3882-3889`

```python
asyncio.create_task(_update_growth_diary())           # 每日一次，但有日期去重
asyncio.create_task(_extract_and_save_memory(...))    # 每次对话触发 → 额外 AI 调用
asyncio.create_task(_auto_learn_skill(...))           # 频率统计 + 可能写文件
asyncio.create_task(_hallucination_scan(...))         # 只是正则扫描，轻量
asyncio.create_task(_enterprise_evolve(...))          # 追加 JSONL 文件
asyncio.create_task(_enterprise_onboarding(sid))      # 首次交互 → 12次 MCP 搜索
```

**风险链条**:
1. 每次对话请求结束后，fire 5-8 个后台任务
2. `_extract_and_save_memory` 会再调用一次 DeepSeek API（额外 ~2-5s 延迟+token 消耗）
3. `_enterprise_onboarding` 首次交互时执行 12 次串行 MCP 搜索
4. **无任务数量上限**、无超时兜底、无失败重试限制
5. 如果10个用户并发对话，瞬间产生 50-80 个后台任务，每个可能再调 API

**内存影响**: 每个任务持有 `sid`、消息内容、工具结果的引用，在任务完成前不会被 GC。高并发下任务堆积导致内存持续增长。

---

### 🔴 P0 — `_sessions` 对话历史无界增长

**位置**: `chat_api.py:3713-3929`

**问题**:
- 每次工具调用追加 assistant + tool 消息到 `_sessions[sid]`
- 12轮工具循环，每轮追加至少2条消息 → 最多 24条/请求
- 每轮包含完整的 tool call arguments 和 tool results
- `knowledge_search` 可能返回数 KB 的文本
- **6小时 TTL 内，一个活跃会话可能积累 100+ 条消息、数百 KB**

**建议**: 
1. 实施对话历史滑动窗口（保留最近 N 轮或最近 N tokens）
2. 在 `_run()` 开头检查 `_sessions[sid]` 总 token 数，超过阈值自动截断

---

### 🟡 P1 — MCP SSE 连接 `_pending` Future 泄漏

**位置**: `mcp_client.py:107`

```python
self._pending[rid] = fut
# ... 如果连接在 POST 后、SSE 响应前断开 ...
# call_tool 的 timeout 可以清理
# 但如果 MCP 服务器永远不响应，Future 永久挂起
```

**问题**: `call_tool` 有 `REQUEST_TIMEOUT=15s` 保护，超时时 pop。但如果 `_pending` 中有多个超时 Future 同时挂起，短时间内不会泄漏太多。风险较低但应关注。

---

### 🟡 P1 — `_rate_limits` 内存 dict 无清理

**位置**: `chat_api.py:702`

```python
_rate_limits: dict[str, list[float]] = {}
# 每60秒窗口滑动，但从未删除过期 client_ip 的 key
```

**问题**: 随时间推移，`_rate_limits` 字典 key 数量单调增长。每个新 IP 添加一个 key，永不删除。在公网部署下可能累积大量 IP 记录。

**建议**: 在 `_cleanup_loop()` 中添加清理过期 rate limit key 的逻辑。

---

### 🟡 P1 — `_VAULT_READ_CACHE` 全局缓存无界

**位置**: `chat_api.py:5586`

```python
_VAULT_READ_CACHE: dict = {}  # 文件路径 → 全文内容缓存
```

**问题**: 包含所有档案库文件的完整文本内容，无 TTL、无大小限制。如果用户上传 50MB 的 PDF，缓存也存 50MB。永不清理。

---

### 🟢 P3 — `permit_scraper._active_sessions` 有定期清理

**位置**: `permit_scraper.py:1137` + `chat_api.py:611`

清理正常：每5分钟调用 `cleanup_stale_sessions(600)`，关闭超时浏览器会话。

---

## 四、同步阻塞操作

### 🔴 P0 — 同步文件 I/O 阻塞事件循环

**位置**: 多处

| 位置 | 操作 | 阻塞风险 |
|------|------|---------|
| `chat_api.py:4083` `_append_work_log()` | `fpath.write_text()` / `open().write()` | 🔴 每次对话都写 |
| `chat_api.py:4151` `_update_work_log_summary()` | 读+写 两次文件操作 | 🔴 每次对话触发 |
| `chat_api.py:4177` `_update_growth_diary()` | `fpath.write_text()` + 额外 AI 调用 | 🔴 每日一次 |
| `chat_api.py:4284` `_save_memory_file()` | `_MEMORY_FILE.write_text()` | 🟡 每次对话（async 任务内） |
| `chat_api.py:5519` `_enterprise_onboarding()` | `kb_file.write_text()` | 🟡 首次交互 |
| `chat_api.py:5534` `_enterprise_evolve()` | `open().write()` | 🟡 每次对话后 |
| `hermes_adapter.py:59` `_save()` | `path.write_text()` | 🟡 每次上下文保存 |

**问题**: 所有这些都在 asyncio 事件循环线程上执行同步磁盘 I/O。`write_text()` 在 macOS APFS 上通常很快（1-10ms），但在高负载或磁盘繁忙时可能阻塞几十 ms，直接阻塞所有其他协程。

**建议**: 使用 `asyncio.to_thread()` 或 `loop.run_in_executor()` 将文件 I/O 移到线程池执行。

---

### 🟡 P1 — `knowledge_search` 工具函数同步文件扫描

**位置**: `tools.py:326-347`

```python
def _knowledge_search(query: str) -> str:
    for f in sorted(kb_dir.rglob("*.md")):  # 同步 glob
        content = f.read_text()              # 同步读取
        if query.lower() in content.lower(): # O(n) 字符串匹配
```

**问题**: `rglob` + 逐个 `read_text` + 全文 `in` 搜索，全部在事件循环线程执行。如果知识库有 100+ 个 markdown 文件（EcoPilot 依赖此功能），单次搜索可能耗时 0.5-2秒，**阻塞所有并发请求**。

**建议**: 使用 `asyncio.to_thread()` 包装，或预建 FTS5/Whoosh 索引。

---

## 五、工具调用循环分析

### 🟡 P1 — 串行工具调用 + 无流式优化

**位置**: `chat_api.py:3789-3876`

```python
for round_idx in range(MAX_TOOL_ROUNDS):  # 最多12轮
    resp = await ds_client.chat.completions.create(...)  # 第1次 LLM 调用
    # ... 流式收集 tool_calls ...
    for k in sorted(tool_calls_acc.keys()):              # 串行执行工具
        result = await execute_tool(...)                  # 阻塞等待
        _sessions[sid].append(...)                        # 追加到历史
```

**问题**:
1. 每轮工具调用是**串行**的——如果 LLM 返回3个 tool_call，必须逐个执行
2. 每次新轮次必须等待完整 LLM 响应（包括不必要的文本生成）
3. `_sessions[sid]` 列表随每轮增长，已包含的上下文在12轮后可达 ~50条消息
4. MCP 工具（如 `ehs-kb-ops__kb_search`）可能需要额外网络延迟 2-5s

**内存**: 按每轮2条消息×平均2KB计算，12轮约为 48KB/请求。100并发×48KB ≈ 4.8MB → 可控，但加上其他泄漏点是累积因素。

---

## 六、综合风险评估汇总

| # | 问题 | 风险等级 | 类别 |
|---|------|---------|------|
| 1 | `_sessions` 全局字典无并发锁 | 🔴 P0 | 并发安全 |
| 2 | 每次对话 fire 5-8 个 create_task 无上限 | 🔴 P0 | 内存泄漏 |
| 3 | 同步文件 I/O 阻塞事件循环（7处） | 🔴 P0 | 同步阻塞 |
| 4 | API 延迟 15.97s 远超 5s 目标 | 🔴 P0 | 性能 |
| 5 | `_rate_limits` dict key 永不清理 | 🟡 P1 | 内存泄漏 |
| 6 | `knowledge_search` 同步 rglob+全文扫描 | 🟡 P1 | 同步阻塞 |
| 7 | `_VAULT_READ_CACHE` 无界缓存 | 🟡 P1 | 内存泄漏 |
| 8 | MCP `_pending` Future 泄漏风险 | 🟡 P1 | 内存泄漏 |
| 9 | `permit_scraper._active_sessions` 无锁 | 🟡 P1 | 并发安全 |
| 10 | 工具调用循环串行执行 | 🟡 P1 | 性能 |
| 11 | `_sessions` 无 token 数截断 | 🟡 P1 | 内存泄漏 |
| 12 | `ops_monitor` threading.Lock + SQLite WAL | 🟢 P3 | 已妥善 |
| 13 | `permit_scraper` 定期清理正常 | 🟢 P3 | 已妥善 |

---

## 七、修复优先级建议

### 立即修复（本周）

1. **为 `_sessions` 添加 asyncio.Lock** — 简单的 `async with _session_lock:` 包裹所有读写
2. **限制 `create_task` 数量** — 使用 `asyncio.Semaphore(10)` 限制后台任务上限
3. **文件 I/O 异步化** — 用 `loop.run_in_executor()` 包装所有同步写操作

### 短期修复（2周内）

4. **`knowledge_search` 异步化** — `asyncio.to_thread()` 包装，或预建索引
5. **`_rate_limits` 定期清理** — 在 `_cleanup_loop` 中添加过期 key 清理
6. **`_sessions` 滑动窗口** — 保留最近 20 轮对话，超出的用 LLM 摘要替代

### 中期优化

7. **并行工具调用** — 同一轮次的多个独立 tool_call 用 `asyncio.gather()` 并行执行
8. **`_VAULT_READ_CACHE` TTL** — 添加 LRU 淘汰或定时刷新
9. **压力测试压测** — 用 50 并发×100 轮测试当前瓶颈

---

## 八、压力测试运行摘要

```
测试配置: 10轮对话, 3并发, deepseek-chat 直连模式
测试时间: 2026-07-21
后端状态: text_ready=True, vision_ready=True, omniroute_mode=False
───────────────────────────────────────────
成功率:   100% (10/10)                    ✅
平均延迟: 15.97s                          🔴 超标 (目标<5s)
最大延迟: 24.63s                          🟡 临界 (目标<30s)
P95延迟:  24.63s                          🔴 超标 (目标<10s)
吞吐量:   0.17 req/s                      🔴 极低
───────────────────────────────────────────
延迟归因: DeepSeek API 响应 ~10-15s + 工具调用 ~2-5s + 文件I/O ~0.1-0.5s
```
