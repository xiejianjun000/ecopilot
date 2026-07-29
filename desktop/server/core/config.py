"""
EcoPilot 核心配置：路径、环境变量、AI 客户端、PII 脱敏

提取自 chat_api.py，模块化拆分 Phase 1
"""

import os
import re as _re
from pathlib import Path
from openai import AsyncOpenAI

# ── 路径常量 ──
HERMES_HOME = Path.home() / ".ecopilot-home"
SESSION_FILE = HERMES_HOME / ".session"

# ── 环境变量加载 ──
def _load_hermes_env():
    env_file = HERMES_HOME / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

_load_hermes_env()

# ── DeepSeek 文本模型客户端 ──
ds_client = AsyncOpenAI(
    api_key=os.environ.get("DEEPSEEK_API_KEY", ""),
    base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip().rstrip("/"),
)

# ── Kimi (Moonshot) 视觉模型客户端 ──
KIMI_API_KEY = os.environ.get("KIMI_API_KEY", "").strip()
kimi_client = AsyncOpenAI(
    api_key=KIMI_API_KEY,
    base_url=os.environ.get("KIMI_BASE_URL", "https://api.moonshot.cn/v1").strip().rstrip("/"),
)

# ── 模型名（可通过环境变量覆盖）──
TEXT_MODEL = os.environ.get("ECOPILOT_TEXT_MODEL", "deepseek-v4-flash").strip()
KIMI_VISION_MODEL = os.environ.get("ECOPILOT_VISION_MODEL", "moonshot-v1-32k-vision-preview").strip()

# ── C-2: 本地 token 认证状态（启动时由 lifespan 生成）──
_AUTH_TOKEN: str = ""
# ── H-4: 许可证有效性 ──
_LICENSE_VALID: bool = False


# ── PII 脱敏 ──
_PII_PATTERNS = [
    (_re.compile(r'1[3-9]\d{9}'), '<手机号>'),
    (_re.compile(r'\d{17}[\dXx]'), '<身份证>'),
    (_re.compile(r'\d{2,4}-\d{7,8}'), '<电话>'),
    (_re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'), '<邮箱>'),
]


def sanitize_pii(text: str) -> str:
    """脱敏用户输入中的个人身份信息"""
    for pattern, replacement in _PII_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


# ── JSON 持久化辅助 ──
import json as _json


def load_json_dict(filename: str) -> dict:
    fpath = HERMES_HOME / filename
    if fpath.exists():
        try:
            return _json.loads(fpath.read_text())
        except Exception:
            pass
    return {}


def save_json_dict(filename: str, data: dict) -> None:
    HERMES_HOME.mkdir(parents=True, exist_ok=True)
    tmp = HERMES_HOME / f".{filename}.tmp"
    tmp.write_text(_json.dumps(data, ensure_ascii=False, indent=2))
    tmp.replace(HERMES_HOME / filename)


def load_enterprise_info() -> dict:
    return load_json_dict("enterprise.json")


# ── 档案库 (Vault) 共享常量和工具函数 ──
import time as _time

VAULT_DIR = HERMES_HOME / "vault"
VAULT_MANIFEST = VAULT_DIR / "manifest.json"

ALLOWED_VAULT_EXT = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff",
    ".txt", ".md", ".csv", ".zip", ".rar", ".7z",
}
MAX_VAULT_FILE_SIZE = 50 * 1024 * 1024

EXT_MIME = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".bmp": "image/bmp", ".webp": "image/webp",
    ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
    ".csv": "text/csv; charset=utf-8", ".html": "text/html; charset=utf-8",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".zip": "application/zip", ".rar": "application/x-rar", ".7z": "application/x-7z-compressed",
}

_MAGIC_BYTES: dict[str, bytes] = {
    ".pdf": b"%PDF",
    ".png": b"\x89PNG\r\n\x1a\n",
    ".jpg": b"\xff\xd8\xff", ".jpeg": b"\xff\xd8\xff",
    ".gif": b"GIF8", ".webp": b"RIFF",
    ".zip": b"PK\x03\x04", ".docx": b"PK\x03\x04",
    ".xlsx": b"PK\x03\x04", ".pptx": b"PK\x03\x04",
    ".rar": b"Rar!\x1a\x07", ".7z": b"7z\xbc\xaf'\x1c",
}


def validate_file_magic(content: bytes, ext: str) -> tuple[bool, str]:
    """校验文件头魔术字节是否与扩展名匹配"""
    if not content:
        return False, "文件内容为空"
    expected = _MAGIC_BYTES.get(ext.lower())
    if expected is None:
        return True, ""
    if len(content) < len(expected):
        return False, f"文件过小（{len(content)} 字节），无法验证类型"
    if content[:len(expected)] != expected:
        return False, f"文件头不匹配 {ext} 格式"
    return True, ""


def vault_load_manifest() -> list[dict]:
    if VAULT_MANIFEST.exists():
        try:
            data = _json.loads(VAULT_MANIFEST.read_text(encoding="utf-8"))
            return data.get("files", []) if isinstance(data, dict) else []
        except Exception:
            return []
    return []


def vault_save_manifest(files: list[dict]) -> None:
    VAULT_DIR.mkdir(parents=True, exist_ok=True)
    tmp = VAULT_MANIFEST.with_suffix(".json.tmp")
    tmp.write_text(_json.dumps({"files": files}, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(VAULT_MANIFEST)


def vault_safe_filename(original: str) -> str:
    """生成安全的存储文件名"""
    base = Path(original).name
    base = _re.sub(r'[^\w一-鿿.\-]', '_', base)
    if not base or base.startswith("."):
        base = "file" + base
    ts = _time.strftime("%Y%m%d-%H%M%S")
    return f"{ts}_{base}"


def fmt_size_py(n: int) -> str:
    if n < 1024: return f"{n} B"
    if n < 1024 * 1024: return f"{n / 1024:.1f} KB"
    return f"{n / 1024 / 1024:.1f} MB"
