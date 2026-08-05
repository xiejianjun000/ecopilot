# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec — 将 Python 后端打包为单个可执行文件
入口: chat_api.py
输出: dist/ecopilot-server.exe (Windows) / dist/ecopilot-server (macOS/Linux)
"""
import os
from pathlib import Path

server_dir = Path.cwd()

# 收集所有 .py 文件作为隐藏导入
hidden_imports = [
    "chat_api", "chat_core", "chat_routes",
    "knowledge_api",
    "permit_parser", "permit_scraper",
    "license_manager", "license_reader",
    "execution_audit",
    "tools", "mcp_client",
    "hermes_engine", "hermes_adapter",
    "logging_config",
    "core.config", "core.startup",
    "middleware.auth", "middleware.security",
    "routes.ops", "routes.vault", "routes.calendar", "routes.inspection",
    # 第三方依赖
    "fastapi", "uvicorn", "starlette",
    "httpx", "aiohttp",
    "playwright", "playwright.async_api",
    "pydantic", "pydantic_core",
    "bs4", "lxml",
    "PIL",
    "cryptography",
    "yaml",
    "dotenv",
]

a = Analysis(
    [str(server_dir / "chat_api.py")],
    pathex=[str(server_dir)],
    binaries=[],
    datas=[
        # 打包配置文件和数据文件
        (str(server_dir / "mcp_servers.json"), "."),
    ],
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter", "unittest", "test", "pytest",
        "pip", "setuptools", "wheel",
        "matplotlib", "numpy", "scipy", "pandas",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="ecopilot-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=True,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,    # 显示控制台窗口（方便调试，发布时可改为 False）
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
