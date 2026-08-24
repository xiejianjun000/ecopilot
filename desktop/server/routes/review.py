"""
协同审阅 API — AI 对知识库文档进行合规标注

流程：
  用户打开知识库文档 → ReviewLayer 调此 API
  → AI 分析文档内容 vs 许可证/法规 → 返回标注结果
"""

import json
import logging
import os
import re
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/review", tags=["review"])

# 复用 DeepSeek 客户端
ds_client = AsyncOpenAI(
    api_key=os.environ.get("DEEPSEEK_API_KEY", ""),
    base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip().rstrip("/"),
)
TEXT_MODEL = os.environ.get("ECOPILOT_TEXT_MODEL", "deepseek-v4-flash")


def cors_json(status: int, data, request: Request = None):
    return JSONResponse(
        status_code=status,
        content=data if isinstance(data, dict) else {"error": str(data)},
        headers={"Access-Control-Allow-Origin": "*"} if request else {},
    )


REVIEW_SYSTEM = """你是 EcoPilot 的文档审阅助手，负责对企业环保合规文档进行AI辅助审阅。

你的任务：分析文档内容，找出与环保合规相关的问题，用颜色分类标注。

标注规则：
- error: 超标、违规、许可证失效风险、数据不一致
- warning: 数据缺失、台账不全、即将到期、需要补充
- success: 数据完整、符合要求、做法正确
- info: 优化建议、效率提升、AI 提醒

输出格式：只返回 JSON 数组，不要任何其他内容。
[
  {"type": "error", "label": "问题标题", "detail": "详细说明，引用具体法规条款"},
  {"type": "warning", "label": "标题", "detail": "说明"}
]

没有问题时返回 []
"""


@router.post("/document")
async def review_document(body: dict, request: Request):
    """AI 审阅文档内容，返回标注结果"""
    doc_id = body.get("id", "")
    doc_content = body.get("content", "")
    doc_title = body.get("title", "")

    if not doc_id or not doc_content:
        return cors_json(400, {"error": "缺少 id 或 content"}, request)

    content_preview = doc_content[:3000]

    try:
        resp = await ds_client.chat.completions.create(
            model=TEXT_MODEL,
            messages=[
                {"role": "system", "content": REVIEW_SYSTEM},
                {"role": "user", "content": f"文档标题: {doc_title}\n\n文档内容:\n{content_preview}"},
            ],
            temperature=0.1,
            max_tokens=2000,
            timeout=30,
        )

        text = resp.choices[0].message.content or ""

        json_match = re.search(r'\[[\s\S]*\]', text)
        if json_match:
            issues = json.loads(json_match.group())
        else:
            issues = []

        return cors_json(200, {"issues": issues, "total": len(issues)}, request)

    except Exception as e:
        logger.error("Review failed: %s", e)
        return cors_json(500, {"error": str(e), "issues": []}, request)
