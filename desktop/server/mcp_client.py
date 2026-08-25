"""
EcoPilot MCP 客户端 — curl 子进程 + httpx POST

架构：每个 MCP 服务器启动一个 curl -sN 后台进程保持 SSE 连接。
       POST 通过 httpx 发送，SSE 响应从 curl stdout pipe 读取。
       _pending dict 按 request id 匹配 Future。
"""

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Optional, Union

import httpx

logger = logging.getLogger("ecopilot.mcp")

MCP_CONFIG_PATH = Path(__file__).parent / "mcp_servers.json"
MCP_LOCAL_CONFIG_PATH = Path(__file__).parent / "mcp_servers.local.json"
RECONNECT_DELAY = 3.0
REQUEST_TIMEOUT = 15.0

_ENV_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


def _expand_env(text: str) -> str:
    """展开配置中的 ${VAR} 环境变量占位符，未设置的变量替换为空字符串"""
    return _ENV_PATTERN.sub(lambda m: os.environ.get(m.group(1), ""), text)


def _load_config() -> list[dict]:
    """合并仓库配置与本地覆盖配置，按 server id 去重。

    仓库内文件（mcp_servers.json）使用 ${VAR} 占位符，作为完整配置基线；
    本地覆盖文件（mcp_servers.local.json，含真实凭据、不进 git）按 id 覆盖
    同名 server。二者合并后返回，避免本地文件缺失某个 server 时把它整体丢弃。
    """
    merged: dict[str, dict] = {}
    # 先读仓库基线，再读本地覆盖（后者按 id 覆盖前者同名条目）
    for path in (MCP_CONFIG_PATH, MCP_LOCAL_CONFIG_PATH):
        if not path.exists():
            continue
        try:
            raw = _expand_env(path.read_text(encoding="utf-8"))
            for srv in json.loads(raw).get("servers", []):
                sid = srv.get("id")
                if sid:
                    merged[sid] = srv
        except Exception:
            continue
    return list(merged.values())


def _mcp_tool_to_openai(tool: dict, server_id: str) -> dict:
    return {
        "type": "function",
        "function": {
            "name": f"{server_id}__{tool['name']}",
            "description": tool.get("description", ""),
            "parameters": tool.get("inputSchema", {"type": "object", "properties": {}}),
        },
    }


class McpConnection:

    def __init__(self, server_config: dict):
        self.id: str = server_config["id"]
        self.name: str = server_config.get("name", self.id)
        self.url: str = server_config["url"]
        self.headers: dict = server_config.get("headers", {})

        self._tools: list[dict] = []
        self._openai_tools: list[dict] = []
        self._ready = False
        self._req_id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._running = False
        self._proc: Optional[asyncio.subprocess.Process] = None
        self._client: Optional[httpx.AsyncClient] = None
        self._msg_url: Optional[str] = None

    @property
    def tools(self) -> list[dict]:
        return self._openai_tools

    @property
    def ready(self) -> bool:
        return self._ready

    # ── 公开 API ──────────────────────────────────

    async def start(self):
        if self._running:
            return
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(10.0))
        self._running = True
        # 首次连接（阻塞完成握手）
        try:
            await self._connect()
        except Exception as e:
            logger.warning(f"[MCP:{self.id}] 首次握手失败: {e}，后台重试中")
        # 启动后台重连+读消息循环
        asyncio.create_task(self._run_forever())

    async def stop(self):
        self._running = False
        self._kill()
        if self._client:
            await self._client.aclose()
            self._client = None
        self._ready = False

    def _kill(self):
        if self._proc:
            try: self._proc.kill()
            except: pass
            self._proc = None

    async def call_tool(self, tool_name: str, arguments: dict, timeout: float = REQUEST_TIMEOUT) -> str:
        if not self._ready or not self._msg_url:
            return json.dumps({"error": f"MCP {self.id} 未就绪"})

        self._req_id += 1
        rid = self._req_id
        loop = asyncio.get_running_loop()
        fut = loop.create_future()
        self._pending[rid] = fut

        try:
            r = await self._client.post(
                self._msg_url,
                headers={**self.headers, "Content-Type": "application/json"},
                json={"jsonrpc": "2.0", "id": rid, "method": "tools/call",
                      "params": {"name": tool_name, "arguments": arguments}},
            )
            if r.status_code != 202:
                self._pending.pop(rid, None)
                return json.dumps({"error": f"MCP HTTP {r.status_code}"})
        except Exception as e:
            self._pending.pop(rid, None)
            return json.dumps({"error": str(e)})

        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            self._pending.pop(rid, None)
            return json.dumps({"error": f"{tool_name} 超时"})

    # ── 连接管理 ──────────────────────────────────

    async def _run_forever(self):
        fail_count = 0
        while self._running:
            try:
                if not self._ready:
                    await self._connect()
                await self._read_loop()
                fail_count = 0
            except asyncio.CancelledError:
                break
            except Exception as e:
                fail_count += 1
                # 前 3 次每次告警，之后每 10 次告警一次，避免刷屏
                if fail_count <= 3 or fail_count % 10 == 0:
                    logger.warning(f"[MCP:{self.id}] 断开: {e}")
                else:
                    logger.debug(f"[MCP:{self.id}] 断开: {e}")
            self._ready = False
            self._kill()
            if self._running:
                delay = min(RECONNECT_DELAY * (2 ** min(fail_count - 1, 5)), 60.0)
                await asyncio.sleep(delay)

    async def _connect(self):
        self._kill()

        header_args = []
        for k, v in self.headers.items():
            header_args.extend(["-H", f"{k}: {v}"])
        header_args.extend(["-H", "Accept: text/event-stream"])

        self._proc = await asyncio.create_subprocess_exec(
            "curl", "-sN", *header_args, self.url,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )

        # SSE: line1=event:endpoint, line2=data:/sse/messages/?session_id=xxx
        await asyncio.wait_for(self._proc.stdout.readline(), 10)
        data_line = await asyncio.wait_for(self._proc.stdout.readline(), 5)
        session_path = data_line.decode(errors="replace").strip().replace("data: ", "")

        if "session_id=" not in session_path:
            raise RuntimeError(f"无效 SSE: {session_path}")

        # session_path 是绝对路径如 /sse/messages/?session_id=xxx
        # 从 url 中提取 origin（避免拼接出 /sse/sse/messages/）
        from urllib.parse import urlparse as _up
        origin = _up(self.url)
        base = f"{origin.scheme}://{origin.netloc}"
        self._msg_url = base + session_path
        h = {**self.headers, "Content-Type": "application/json"}

        # initialize + initialized + tools/list
        await self._client.post(self._msg_url, headers=h, json={
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                       "clientInfo": {"name": "EcoPilot", "version": "1.0.0"}},
        })
        await self._client.post(self._msg_url, headers=h, json={
            "jsonrpc": "2.0", "method": "notifications/initialized",
        })
        await self._client.post(self._msg_url, headers=h, json={
            "jsonrpc": "2.0", "id": 999, "method": "tools/list", "params": {},
        })

        # 等待 tools/list SSE 响应
        while True:
            line = await asyncio.wait_for(self._proc.stdout.readline(), 10)
            line = line.decode(errors="replace").strip()
            if line.startswith("data: "):
                try:
                    msg = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue
                if msg.get("id") == 999 and "result" in msg:
                    self._tools = msg["result"].get("tools", [])
                    self._openai_tools = [_mcp_tool_to_openai(t, self.id) for t in self._tools]
                    self._ready = True
                    logger.info(f"[MCP:{self.id}] {len(self._tools)} 工具就绪")
                    return

    async def _read_loop(self):
        if not self._proc:
            return
        while self._running:
            try:
                line = await asyncio.wait_for(self._proc.stdout.readline(), 120)
            except asyncio.TimeoutError:
                continue
            if not line:
                break

            line = line.decode(errors="replace").strip()
            if not line.startswith("data: "):
                continue

            try:
                msg = json.loads(line[6:])
            except json.JSONDecodeError:
                continue

            rid = msg.get("id")
            if rid and rid in self._pending:
                fut = self._pending.pop(rid)
                if "result" in msg:
                    r = msg["result"]
                    texts = [c["text"] for c in r.get("content", []) if c.get("type") == "text"]
                    fut.set_result("\n".join(texts) if texts else json.dumps(r, ensure_ascii=False))
                elif "error" in msg:
                    fut.set_result(json.dumps({"error": msg["error"]}, ensure_ascii=False))


# ── stdio 连接器（本地子进程 MCP，如排污许可企业端） ────────────────

class StdioMcpConnection:
    """通过 mcp SDK stdio_client 连接本地子进程 MCP 服务器。

    与 SSE 版 McpConnection 接口一致（tools/ready/start/stop/call_tool），
    供 McpManager 统一调度。
    """

    def __init__(self, server_config: dict):
        import sys as _sys
        self.id: str = server_config["id"]
        self.name: str = server_config.get("name", self.id)
        cmd = server_config.get("command") or _sys.executable
        self.command: str = _sys.executable if cmd in ("python", "python3") else cmd
        self.args: list[str] = list(server_config.get("args", []))
        self.env: dict = server_config.get("env", {})
        self._keepalive: float = float(server_config.get("keepalive", 30))

        # python_path：追加到子进程 PYTHONPATH（相对路径基于 server 目录解析）
        from pathlib import Path as _Path
        self._python_path: str = ""
        _pp = server_config.get("python_path")
        if _pp:
            _p = _Path(_pp)
            if not _p.is_absolute():
                _p = _Path(__file__).parent / _p
            self._python_path = str(_p)

        self._tools: list[dict] = []
        self._openai_tools: list[dict] = []
        self._ready = False
        self._running = False
        self._session = None
        self._stdio_ctx = None

    @property
    def tools(self) -> list[dict]:
        return self._openai_tools

    @property
    def ready(self) -> bool:
        return self._ready

    async def start(self):
        if self._running:
            return
        self._running = True
        asyncio.create_task(self._run_forever())

    async def stop(self):
        self._running = False
        await self._teardown()

    async def _run_forever(self):
        while self._running:
            try:
                await self._connect()
                await self._keepalive_loop()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"[MCP:{self.id}] stdio 断开: {e}")
            self._ready = False
            await self._teardown()
            if self._running:
                await asyncio.sleep(RECONNECT_DELAY)

    async def _connect(self):
        import os
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        env = {**os.environ, **self._expand_env(self.env)}
        # 追加 python_path 到 PYTHONPATH
        if self._python_path:
            existing_pp = env.get("PYTHONPATH", "")
            env["PYTHONPATH"] = self._python_path + (os.pathsep + existing_pp if existing_pp else "")
        params = StdioServerParameters(command=self.command, args=self.args, env=env)
        self._stdio_ctx = stdio_client(params)
        read, write = await self._stdio_ctx.__aenter__()
        self._session = ClientSession(read, write)
        await self._session.__aenter__()
        await self._session.initialize()
        result = await self._session.list_tools()
        self._tools = [t.model_dump() for t in result.tools]
        self._openai_tools = [_mcp_tool_to_openai(t, self.id) for t in self._tools]
        self._ready = True
        logger.info(f"[MCP:{self.id}] {len(self._tools)} 个工具就绪 (stdio)")

    async def _keepalive_loop(self):
        while self._running and self._ready:
            await asyncio.sleep(self._keepalive)
            try:
                await asyncio.wait_for(self._session.list_tools(), 10)
            except Exception as e:
                logger.warning(f"[MCP:{self.id}] keepalive 失败，触发重连: {e}")
                break

    async def _teardown(self):
        self._ready = False
        if self._session is not None:
            try:
                await self._session.__aexit__(None, None, None)
            except Exception:
                pass
            self._session = None
        if self._stdio_ctx is not None:
            try:
                await self._stdio_ctx.__aexit__(None, None, None)
            except Exception:
                pass
            self._stdio_ctx = None

    async def call_tool(self, tool_name: str, arguments: dict, timeout: float = REQUEST_TIMEOUT) -> str:
        if not self._ready or self._session is None:
            return json.dumps({"error": f"MCP {self.id} 未就绪"})
        try:
            result = await asyncio.wait_for(
                self._session.call_tool(tool_name, arguments), timeout
            )
            texts = [c.text for c in result.content if getattr(c, "type", None) == "text"]
            if texts:
                return "\n".join(texts)
            return json.dumps(result.model_dump(), ensure_ascii=False)
        except Exception as e:
            self._ready = False
            return json.dumps({"error": str(e)})

    @staticmethod
    def _expand_env(env: dict) -> dict:
        """展开 ${VAR} 占位符为进程环境变量值。"""
        import os
        import re

        def _rep(m):
            return os.environ.get(m.group(1), m.group(0))

        out = {}
        for k, v in env.items():
            if isinstance(v, str):
                out[k] = re.sub(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}", _rep, v)
            else:
                out[k] = v
        return out


# ── 管理器 ──────────────────────────────────────

class McpManager:

    def __init__(self):
        self._connections: dict[str, Union[McpConnection, StdioMcpConnection]] = {}
        self._started = False

    async def start_all(self):
        if self._started:
            return
        for cfg in _load_config():
            transport = cfg.get("transport", "sse")
            conn = StdioMcpConnection(cfg) if transport == "stdio" else McpConnection(cfg)
            self._connections[cfg["id"]] = conn
            await conn.start()
        self._started = True
        logger.info(f"[MCP] {len(self._connections)} 个连接已启动")

    async def stop_all(self):
        for c in self._connections.values():
            await c.stop()
        self._connections.clear()
        self._started = False

    async def restart_connection(self, server_id: str) -> bool:
        """重启指定 MCP 连接（stdio 连接会用最新 os.environ 重新展开 env）。"""
        old = self._connections.get(server_id)
        if not old:
            logger.warning(f"[MCP] 重启失败：{server_id} 不存在")
            return False
        await old.stop()
        # 重新加载配置并创建连接
        for cfg in _load_config():
            if cfg.get("id") == server_id:
                transport = cfg.get("transport", "sse")
                conn = StdioMcpConnection(cfg) if transport == "stdio" else McpConnection(cfg)
                self._connections[server_id] = conn
                await conn.start()
                logger.info(f"[MCP] {server_id} 已重启")
                return True
        logger.warning(f"[MCP] 重启失败：配置中找不到 {server_id}")
        return False

    def get_all_tools(self) -> list[dict]:
        r = []
        for c in self._connections.values():
            if c.ready:
                r.extend(c.tools)
        return r

    def find_tool(self, full: str) -> tuple[Optional[Union[McpConnection, StdioMcpConnection]], Optional[str]]:
        if "__" not in full:
            return None, None
        sid, tn = full.split("__", 1)
        c = self._connections.get(sid)
        return (c, tn) if c and c.ready else (None, None)

    async def call_tool(self, full: str, args: dict, timeout: float = REQUEST_TIMEOUT) -> str:
        c, tn = self.find_tool(full)
        return await c.call_tool(tn, args, timeout) if c else json.dumps({"error": f"未知: {full}"})


_mcp_manager: Optional[McpManager] = None


def get_mcp_manager() -> McpManager:
    global _mcp_manager
    if _mcp_manager is None:
        _mcp_manager = McpManager()
    return _mcp_manager
