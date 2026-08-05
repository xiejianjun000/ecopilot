"""
EcoPilot MCP 客户端 — curl 子进程 + httpx POST

架构：每个 MCP 服务器启动一个 curl -sN 后台进程保持 SSE 连接。
       POST 通过 httpx 发送，SSE 响应从 curl stdout pipe 读取。
       _pending dict 按 request id 匹配 Future。
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger("ecopilot.mcp")

MCP_CONFIG_PATH = Path(__file__).parent / "mcp_servers.json"
RECONNECT_DELAY = 3.0
REQUEST_TIMEOUT = 15.0


def _load_config() -> list[dict]:
    if not MCP_CONFIG_PATH.exists():
        return []
    try:
        return json.loads(MCP_CONFIG_PATH.read_text()).get("servers", [])
    except Exception:
        return []


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
        while self._running:
            try:
                if not self._ready:
                    await self._connect()
                await self._read_loop()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"[MCP:{self.id}] 断开: {e}")
            self._ready = False
            self._kill()
            if self._running:
                await asyncio.sleep(RECONNECT_DELAY)

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


# ── 管理器 ──────────────────────────────────────

class McpManager:

    def __init__(self):
        self._connections: dict[str, McpConnection] = {}
        self._started = False

    async def start_all(self):
        if self._started:
            return
        for cfg in _load_config():
            conn = McpConnection(cfg)
            self._connections[cfg["id"]] = conn
            await conn.start()
        self._started = True
        logger.info(f"[MCP] {len(self._connections)} 个连接已启动")

    async def stop_all(self):
        for c in self._connections.values():
            await c.stop()
        self._connections.clear()
        self._started = False

    def get_all_tools(self) -> list[dict]:
        r = []
        for c in self._connections.values():
            if c.ready:
                r.extend(c.tools)
        return r

    def find_tool(self, full: str) -> tuple[Optional[McpConnection], Optional[str]]:
        if "__" not in full:
            return None, None
        sid, tn = full.split("__", 1)
        c = self._connections.get(sid)
        return (c, tn) if c and c.ready else (None, None)

    async def call_tool(self, full: str, args: dict) -> str:
        c, tn = self.find_tool(full)
        return await c.call_tool(tn, args) if c else json.dumps({"error": f"未知: {full}"})


_mcp_manager: Optional[McpManager] = None


def get_mcp_manager() -> McpManager:
    global _mcp_manager
    if _mcp_manager is None:
        _mcp_manager = McpManager()
    return _mcp_manager
