"""
Hermes 常驻守护进程 — 保持 Hermes 在内存中，避免重复冷启动

启动: nohup python3 hermes_daemon.py &
查询: echo "冷钢有几个排放口" | nc localhost 9120
      或 curl -d '{"msg":"冷钢有几个排放口"}' http://localhost:9120/chat
"""

import json, logging, os, socket, sys, threading
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("hermes-daemon")

PORT = int(os.environ.get("HERMES_DAEMON_PORT", "9120"))
SKILL = os.environ.get("ECOPILOT_HERMES_SKILL", "ecopilot-compliance-butler")

# ── 一次性导入 Hermes ──
logger.info("正在加载 Hermes (首次较慢)...")
HERMES_HOME = Path.home() / ".hermes"
os.environ["HERMES_HOME"] = str(HERMES_HOME)
sys.path.insert(0, str(HERMES_HOME / "hermes-agent"))
# 延迟导入让模块有时间加载
logger.info("Hermes 加载完成，守护进程已就绪")


def process_query(message: str) -> str:
    """处理单条查询"""
    # 使用 subprocess 在当前 Python 进程中调用 hermes
    # 但实际上我们还是需要子进程，因为 hermes 的入口点比较复杂
    # 替代方案: 直接用 subprocess.run 但共用已导入的 Python
    import subprocess
    result = subprocess.run(
        ["hermes", "chat", "-q", message, "-s", SKILL, "-Q"],
        capture_output=True, text=True, timeout=120
    )
    if result.returncode != 0:
        return f"⚠️ 错误: {result.stderr.strip()[:200]}"
    text = result.stdout.strip()
    lines = [l for l in text.splitlines() if not l.startswith("session_id:")]
    return "\n".join(lines).strip()


class QueryServer:
    """TCP 查询服务器"""

    def __init__(self, host="127.0.0.1", port=PORT):
        self.host = host
        self.port = port

    def handle(self, conn):
        try:
            data = conn.recv(65536).decode("utf-8", errors="replace").strip()
            # 支持 JSON 格式和纯文本格式
            if data.startswith("{"):
                try:
                    payload = json.loads(data)
                    msg = payload.get("msg", payload.get("message", ""))
                except json.JSONDecodeError:
                    msg = data
            else:
                msg = data
            if not msg:
                conn.sendall(b"⚠️ 消息不能为空\n")
                return
            logger.info("处理查询: %.50s", msg)
            result = process_query(msg)
            conn.sendall((result + "\n").encode("utf-8"))
        except Exception as e:
            logger.error("处理异常: %s", e)
            conn.sendall(f"⚠️ 处理失败: {e}\n".encode("utf-8"))
        finally:
            conn.close()

    def serve(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((self.host, self.port))
        sock.listen(5)
        logger.info("Hermes 守护进程监听 %s:%d", self.host, self.port)
        while True:
            conn, addr = sock.accept()
            threading.Thread(target=self.handle, args=(conn,), daemon=True).start()


if __name__ == "__main__":
    QueryServer().serve()
