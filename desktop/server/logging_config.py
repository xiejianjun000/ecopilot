"""
EcoPilot 统一日志配置

用法:
    from logging_config import get_logger
    logger = get_logger(__name__)
    logger.info("something happened")
"""

import logging
import os
import sys
from datetime import datetime
from pathlib import Path
from logging.handlers import RotatingFileHandler
from typing import Optional


def setup_logging(
    name: str = "ecopilot",
    level: int = logging.INFO,
    log_dir: Optional[Path] = None,
) -> logging.Logger:
    """配置结构化日志（控制台 + 文件轮转）。

    - 控制台: 人类可读格式
    - 文件: JSON 格式，单文件最大 10MB，保留 5 个备份
    """
    logger = logging.getLogger(name)
    logger.setLevel(level)

    # 避免重复添加 handler
    if logger.handlers:
        return logger

    # ── 控制台 handler（人类可读）──
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(level)
    console_fmt = logging.Formatter(
        "[%(asctime)s] %(levelname)-7s %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    console.setFormatter(console_fmt)
    logger.addHandler(console)

    # ── 文件 handler（JSON 格式，轮转）──
    if log_dir is None:
        log_dir = Path.home() / ".ecopilot-home" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    file_handler = RotatingFileHandler(
        log_dir / "ecopilot.log",
        maxBytes=10 * 1024 * 1024,  # 10MB
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setLevel(logging.DEBUG)  # 文件可记录更细粒度
    file_fmt = logging.Formatter(
        '{"ts":"%(asctime)s","lvl":"%(levelname)s","logger":"%(name)s","msg":%(message)s}',
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    file_handler.setFormatter(file_fmt)
    logger.addHandler(file_handler)

    return logger


def get_logger(name: str) -> logging.Logger:
    """获取或创建 logger（如果根 logger 未配置则自动初始化）"""
    logger = logging.getLogger(f"ecopilot.{name}")
    if not logging.getLogger("ecopilot").handlers:
        setup_logging()
    return logger
