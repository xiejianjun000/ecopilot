"""验证码识别：ddddocr 本地 OCR（识别 4 位 kaptcha）。

ddddocr 为纯本地识别，无网络依赖；识别失败由上层 AuthManager 负责重试。
"""

from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger("eco_permit_enterprise_mcp.auth.captcha")


class CaptchaRecognizer:
    """kaptcha 图片 OCR 识别器。

    惰性加载 ddddocr（首次识别时才初始化，降低无关路径启动开销）。
    """

    def __init__(self):
        self._ocr: Optional[object] = None

    def _ensure_ocr(self):
        if self._ocr is None:
            import ddddocr  # 延迟导入

            try:
                self._ocr = ddddocr.DdddOcr(show_ad=False)
            except TypeError:
                # 兼容旧版本 ddddocr 无 show_ad 参数
                self._ocr = ddddocr.DdddOcr()
        return self._ocr

    def recognize(self, img_bytes: bytes) -> str:
        """识别验证码图片，返回 4 位文本（去除空白）。"""
        if not img_bytes:
            return ""
        ocr = self._ensure_ocr()
        result = ocr.classification(img_bytes)
        text = (result or "").strip()
        logger.debug("验证码识别结果: %s", "*" * len(text) if text else "<空>")
        return text


__all__ = ["CaptchaRecognizer"]
