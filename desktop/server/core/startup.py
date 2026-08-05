"""
EcoPilot 启动校验 — 启动时检查必需配置

提取自 chat_api.py lifespan
"""

import os
import sys
from pathlib import Path
from typing import Optional

# ── 必需环境变量（生产环境）──
REQUIRED_ENV_VARS = {
    "DEEPSEEK_API_KEY": "DeepSeek API 密钥（用于 AI 文本模型）",
    "KIMI_API_KEY": "Kimi/Moonshot API 密钥（用于 AI 视觉模型）",
}

# ── 推荐环境变量（无值可用默认）──
RECOMMENDED_ENV_VARS = {
    "DEEPSEEK_BASE_URL": "DeepSeek API 地址（默认 https://api.deepseek.com）",
    "KIMI_BASE_URL": "Kimi API 地址（默认 https://api.moonshot.cn/v1）",
    "ECOPILOT_TEXT_MODEL": "文本模型名（默认 deepseek-v4-flash）",
    "ECOPILOT_VISION_MODEL": "视觉模型名（默认 moonshot-v1-32k-vision-preview）",
    "HERMES_BASE_URL": "Hermes 网关地址（默认 http://localhost:20128/v1）",
    "HERMES_API_KEY": "Hermes API 密钥（生产环境必须显式设置）",
}

# ── 许可证文件路径 ──
LICENSE_FILE = Path.home() / ".ecopilot-home" / "license.key"


def validate_startup(dev_mode: bool = False) -> dict:
    """启动时校验环境，返回诊断结果。

    Args:
        dev_mode: 是否为开发模式（ECOPILOT_DEV=1）

    Returns:
        {"ok": bool, "errors": [...], "warnings": [...]}
    """
    errors: list[str] = []
    warnings: list[str] = []

    # ── 1. 安全模式校验 ──
    if os.environ.get("ECOPILOT_DEV") == "1":
        if dev_mode:
            warnings.append(
                "⚠️  ECOPILOT_DEV=1 已启用 — SMS 验证码将明文返回。"
                "仅限本地开发环境！"
            )
        else:
            errors.append(
                "⛔ ECOPILOT_DEV=1 已设置但非开发模式启动。"
                "生产环境严禁启用 ECOPILOT_DEV。"
            )

    # ── 2. 必需环境变量 ──
    for var, desc in REQUIRED_ENV_VARS.items():
        val = os.environ.get(var, "").strip()
        if not val:
            errors.append(f"⛔ 缺少必需环境变量: {var} ({desc})")

    # ── 3. 推荐环境变量 ──
    for var, desc in RECOMMENDED_ENV_VARS.items():
        val = os.environ.get(var, "").strip()
        if not val:
            warnings.append(f"⚠️  未设置 {var} ({desc})，将使用默认值")

    # ── 4. API Key 格式校验 ──
    for var in ("DEEPSEEK_API_KEY", "KIMI_API_KEY"):
        val = os.environ.get(var, "").strip()
        if val and not val.startswith("sk-"):
            warnings.append(
                f"⚠️  {var} 不以 'sk-' 开头，请确认格式正确"
            )

    # ── 5. 许可证文件 ──
    if LICENSE_FILE.exists():
        content = LICENSE_FILE.read_text().strip()
        if not content:
            warnings.append("⚠️  许可证文件为空，请检查授权")
    else:
        warnings.append(
            "⚠️  未找到许可证文件 (~/.ecopilot-home/license.key)。"
            "非 health/license 端点将返回 403。"
            "运行 'python3 license_manager.py fingerprint' 获取机器指纹。"
        )

    return {
        "ok": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }


def print_startup_report(report: dict):
    """打印启动报告到控制台"""
    print("\n" + "=" * 60)
    print("  EcoPilot 启动校验")
    print("=" * 60)

    for err in report.get("errors", []):
        print(f"  {err}")

    for warn in report.get("warnings", []):
        print(f"  {warn}")

    if report["ok"]:
        print("\n  ✅ 所有必需配置已就绪")
    else:
        print(f"\n  ❌ 发现 {len(report['errors'])} 个配置错误")
        print("  请检查 ~/.ecopilot-home/.env 中的环境变量配置。")

    print("=" * 60 + "\n")
