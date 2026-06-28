#!/usr/bin/env python3
"""
Model Router — Anthropic Messages API proxy that routes to DeepSeek (default)
or Kimi (images / long context).

Protocol:
  - Accepts Anthropic Messages API on /v1/messages
  - DeepSeek: passthrough (native Anthropic-compatible endpoint)
  - Kimi:     Anthropic ↔ OpenAI Chat Completions translation

Routing rules:
  1. Image in content            → Kimi
  2. Total input chars > 32K     → Kimi
  3. Otherwise                   → DeepSeek
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
import time
import uuid
from typing import Any, Dict, Optional

import aiohttp
from aiohttp import web

# ---------------------------------------------------------------------------
# Config — read from env, fall back to hard-coded keys
# ---------------------------------------------------------------------------

DEEPSEEK_API_KEY = os.environ.get(
    "DEEPSEEK_API_KEY", "sk-30b6fcafb9d1431ab1576eb5fc66f651"
)
DEEPSEEK_BASE = os.environ.get(
    "DEEPSEEK_ANTHROPIC_BASE", "https://api.deepseek.com/anthropic"
)
DEEPSEEK_MODEL = os.environ.get(
    "DEEPSEEK_MODEL", "claude-sonnet-baidu"
)

KIMI_API_KEY = os.environ.get(
    "KIMI_API_KEY", "sk-6eHDJCmvmbAMkgxflrS1dILTeIkZV8zMGObJbuFk4HWcHBFm"
)
KIMI_BASE = os.environ.get(
    "MOONSHOT_BASE_URL", "https://api.moonshot.cn/v1"
)
KIMI_MODEL = os.environ.get(
    "KIMI_MODEL", "kimi-k2.6"
)

PORT = int(os.environ.get("ROUTER_PORT", "8765"))
LONG_CONTEXT_THRESHOLD = int(os.environ.get("ROUTER_LONG_THRESHOLD", "32000"))

ANTHROPIC_VERSION = "2023-06-01"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [router] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("model_router")


# ---------------------------------------------------------------------------
# Routing decision
# ---------------------------------------------------------------------------

def _total_char_length(body: dict) -> int:
    """Estimate total character count of all text content in the request."""
    total = 0
    system = body.get("system")
    if isinstance(system, str):
        total += len(system)
    elif isinstance(system, list):
        for block in system:
            if isinstance(block, dict) and block.get("type") == "text":
                total += len(block.get("text", ""))
    for msg in body.get("messages", []):
        content = msg.get("content", "")
        if isinstance(content, str):
            total += len(content)
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    if block.get("type") == "text":
                        total += len(block.get("text", ""))
                    elif block.get("type") == "image":
                        total += 2000  # rough cost for an image
    return total


def _has_image(body: dict) -> bool:
    """Check if any message contains an image block."""
    for msg in body.get("messages", []):
        content = msg.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "image":
                    return True
    return False


def decide_target(body: dict) -> tuple[str, str, str, str]:
    """
    Returns (provider_name, api_key, base_url, model_name).
    """
    if _has_image(body):
        logger.info("📷 Image detected → routing to Kimi")
        return ("kimi", KIMI_API_KEY, KIMI_BASE, KIMI_MODEL)
    chars = _total_char_length(body)
    if chars > LONG_CONTEXT_THRESHOLD:
        logger.info(f"📏 Long context ({chars} chars) → routing to Kimi")
        return ("kimi", KIMI_API_KEY, KIMI_BASE, KIMI_MODEL)
    logger.info(f"🔄 Default route → DeepSeek ({chars} chars)")
    return ("deepseek", DEEPSEEK_API_KEY, DEEPSEEK_BASE, DEEPSEEK_MODEL)


# ---------------------------------------------------------------------------
# Anthropic → OpenAI request translation
# ---------------------------------------------------------------------------

def anthropic_to_openai(body: dict, model: str) -> dict:
    """Convert Anthropic Messages request to OpenAI Chat Completions request."""
    tools = body.get("tools")
    tool_choice = body.get("tool_choice")

    openai_messages = []

    # System prompt
    system = body.get("system")
    if isinstance(system, str) and system.strip():
        openai_messages.append({"role": "system", "content": system})
    elif isinstance(system, list):
        text_parts = [
            b["text"] for b in system
            if isinstance(b, dict) and b.get("type") == "text"
        ]
        if text_parts:
            openai_messages.append({"role": "system", "content": "\n".join(text_parts)})

    # Messages
    for msg in body.get("messages", []):
        role = msg.get("role", "user")
        content = msg.get("content", "")

        if isinstance(content, str):
            openai_messages.append({"role": role, "content": content})
        elif isinstance(content, list):
            openai_content = []
            for block in content:
                if block.get("type") == "text":
                    openai_content.append({"type": "text", "text": block["text"]})
                elif block.get("type") == "image":
                    source = block.get("source", {})
                    if source.get("type") == "base64":
                        media_type = source.get("media_type", "image/jpeg")
                        b64 = source.get("data", "")
                        openai_content.append({
                            "type": "image_url",
                            "image_url": {"url": f"data:{media_type};base64,{b64}"},
                        })
            openai_messages.append({"role": role, "content": openai_content})

    req: dict[str, Any] = {
        "model": model,
        "messages": openai_messages,
        "max_tokens": body.get("max_tokens", 4096),
        "stream": body.get("stream", False),
    }

    if "temperature" in body:
        req["temperature"] = body["temperature"]
    if "top_p" in body:
        req["top_p"] = body["top_p"]

    if tools:
        openai_tools = []
        for t in tools:
            ot = {"type": "function", "function": {k: v for k, v in t.items() if k != "type"}}
            if "type" in t:
                ot["type"] = t["type"]
            openai_tools.append(ot)
        req["tools"] = openai_tools
        if tool_choice:
            if isinstance(tool_choice, dict) and tool_choice.get("type") == "auto":
                req["tool_choice"] = "auto"
            elif isinstance(tool_choice, dict) and tool_choice.get("type") == "any":
                req["tool_choice"] = "required"

    return req


# ---------------------------------------------------------------------------
# OpenAI → Anthropic response translation (non-streaming)
# ---------------------------------------------------------------------------

def openai_to_anthropic_response(openai_resp: dict, original_body: dict) -> dict:
    """Convert OpenAI Chat Completion response to Anthropic Messages response."""
    req_id = f"msg_{uuid.uuid4().hex[:24]}"
    choice = openai_resp.get("choices", [{}])[0]
    message = choice.get("message", {})
    oai_content = message.get("content", "")
    usage = openai_resp.get("usage", {})

    content_blocks = []
    tool_call_blocks = []

    if isinstance(oai_content, str) and oai_content:
        content_blocks.append({"type": "text", "text": oai_content})
    elif isinstance(oai_content, list):
        for part in oai_content:
            if isinstance(part, dict):
                if part.get("type") == "text":
                    content_blocks.append({"type": "text", "text": part.get("text", "")})

    # Tool calls
    if message.get("tool_calls"):
        for tc in message["tool_calls"]:
            func = tc.get("function", {})
            try:
                args = json.loads(func.get("arguments", "{}"))
            except json.JSONDecodeError:
                args = {}
            tool_call_blocks.append({
                "type": "tool_use",
                "id": tc.get("id", f"tcu_{uuid.uuid4().hex[:16]}"),
                "name": func.get("name", ""),
                "input": args,
            })

    # Anthropic expects thinking or regular content — we don't have thinking from Kimi
    if not content_blocks and not tool_call_blocks:
        content_blocks.append({"type": "text", "text": ""})

    resp: dict[str, Any] = {
        "id": req_id,
        "type": "message",
        "role": "assistant",
        "content": content_blocks + tool_call_blocks,
        "model": original_body.get("model", KIMI_MODEL),
        "stop_reason": _map_finish_reason(choice.get("finish_reason")),
        "stop_sequence": None,
        "usage": {
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
        },
    }
    return resp


def _map_finish_reason(reason: Optional[str]) -> str:
    if reason == "stop":
        return "end_turn"
    if reason == "length":
        return "max_tokens"
    if reason == "tool_calls":
        return "tool_use"
    return "end_turn"


# ---------------------------------------------------------------------------
# OpenAI SSE → Anthropic SSE translation
# ---------------------------------------------------------------------------

_SSE_DONE_FLAG_RE = re.compile(r"\[DONE\]")

def _parse_openai_sse_delta(line: str) -> Optional[dict]:
    """Parse one SSE data line from OpenAI streaming response."""
    if not line.startswith("data:"):
        return None
    data_str = line[5:].strip()
    if _SSE_DONE_FLAG_RE.match(data_str):
        return {"_done": True}
    try:
        return json.loads(data_str)
    except json.JSONDecodeError:
        return None


async def _translate_openai_stream(
    openai_response: aiohttp.ClientResponse,
    anthropic_model: str,
    anthropic_req_id: str,
) -> bytes:
    """Read OpenAI SSE stream, yield Anthropic SSE bytes."""
    start = time.time()
    input_tokens = 0
    output_tokens = 0
    content_index = 0
    text_started = False

    # message_start
    yield _sse("message_start", {
        "type": "message_start",
        "message": {
            "id": anthropic_req_id,
            "type": "message",
            "role": "assistant",
            "content": [],
            "model": anthropic_model,
            "stop_reason": None,
            "stop_sequence": None,
            "usage": {"input_tokens": 0, "output_tokens": 0},
        },
    })

    # We'll collect tool use fragments as they arrive
    tool_uses: dict[int, dict] = {}
    current_tool_index: Optional[int] = None

    async for line_bytes in openai_response.content:
        line = line_bytes.decode("utf-8", errors="replace").strip()
        if not line:
            continue

        parsed = _parse_openai_sse_delta(line)
        if parsed is None:
            continue
        if parsed.get("_done"):
            break

        choices = parsed.get("choices", [])
        if not choices:
            continue
        delta = choices[0].get("delta", {})
        finish = choices[0].get("finish_reason")

        usage_data = parsed.get("usage") or parsed.get("x_usage") or {}
        if usage_data:
            input_tokens = usage_data.get("prompt_tokens", input_tokens)
            output_tokens = usage_data.get("completion_tokens", output_tokens)

        # Tool calls
        tool_calls = delta.get("tool_calls", [])
        if tool_calls:
            for tc in tool_calls:
                idx = tc.get("index", 0)
                if idx not in tool_uses:
                    tool_uses[idx] = {
                        "id": tc.get("id", f"tcu_{uuid.uuid4().hex[:16]}"),
                        "name": "",
                        "arguments": "",
                    }
                    # content_block_start for tool
                    yield _sse("content_block_start", {
                        "type": "content_block_start",
                        "index": content_index,
                        "content_block": {
                            "type": "tool_use",
                            "id": tool_uses[idx]["id"],
                            "name": "",
                            "input": {},
                        },
                    })
                    current_tool_index = content_index
                    content_index += 1
                if tc.get("function", {}).get("name"):
                    tool_uses[idx]["name"] = tc["function"]["name"]
                if tc.get("function", {}).get("arguments"):
                    tool_uses[idx]["arguments"] += tc["function"]["arguments"]

            continue

        # Text content
        text = delta.get("content", "")
        # DeepSeek sometimes sends thinking as reasoning_content instead of content
        if not text:
            reasoning = delta.get("reasoning_content", "")
            if reasoning:
                text = reasoning
        if text:
            if isinstance(text, list):
                # Anthropic-style content list in OpenAI response (rare)
                for item in text:
                    if isinstance(item, dict) and item.get("type") == "text":
                        t = item.get("text", "")
                        if not text_started:
                            yield _sse("content_block_start", {
                                "type": "content_block_start",
                                "index": content_index,
                                "content_block": {"type": "text", "text": ""},
                            })
                            text_started = True
                        if t:
                            yield _sse("content_block_delta", {
                                "type": "content_block_delta",
                                "index": content_index,
                                "delta": {"type": "text_delta", "text": t},
                            })
            else:
                # Plain string content
                t = str(text)
                if not text_started and t:
                    yield _sse("content_block_start", {
                        "type": "content_block_start",
                        "index": content_index,
                        "content_block": {"type": "text", "text": ""},
                    })
                    text_started = True
                if t:
                    yield _sse("content_block_delta", {
                        "type": "content_block_delta",
                        "index": content_index,
                        "delta": {"type": "text_delta", "text": t},
                    })

        if finish:
            # Close all blocks
            for i in range(content_index):
                yield _sse("content_block_stop", {
                    "type": "content_block_stop",
                    "index": i,
                })
            # message_delta
            stop_reason = _map_finish_reason(finish)
            yield _sse("message_delta", {
                "type": "message_delta",
                "delta": {
                    "stop_reason": stop_reason,
                    "stop_sequence": None,
                },
                "usage": {"output_tokens": output_tokens or 0},
            })
            # message_stop
            yield _sse("message_stop", {"type": "message_stop"})

    # If no finish was sent but stream ended, send stop events
    if not finish:
        if text_started:
            yield _sse("content_block_stop", {
                "type": "content_block_stop",
                "index": 0,
            })
        yield _sse("message_delta", {
            "type": "message_delta",
            "delta": {"stop_reason": "end_turn", "stop_sequence": None},
            "usage": {"output_tokens": output_tokens or 0},
        })
        yield _sse("message_stop", {"type": "message_stop"})


def _sse(event: str, data: dict) -> bytes:
    """Format an Anthropic SSE message."""
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")


# ---------------------------------------------------------------------------
# DeepSeek passthrough (rewrite model header)
# ---------------------------------------------------------------------------

async def _deepseek_passthrough(
    body: dict, headers: dict, deepseek_key: str, deepseek_base: str,
) -> tuple[int, dict, bytes]:
    """Forward request to DeepSeek Anthropic endpoint, return response."""
    url = f"{deepseek_base}/v1/messages"
    req_headers = {
        "Content-Type": "application/json",
        "x-api-key": deepseek_key,
        "anthropic-version": ANTHROPIC_VERSION,
    }
    is_stream = body.get("stream", False)
    body_copy = {**body}
    body_copy["model"] = DEEPSEEK_MODEL

    async with aiohttp.ClientSession() as session:
        async with session.post(
            url, headers=req_headers, json=body_copy,
            timeout=aiohttp.ClientTimeout(total=300),
        ) as resp:
            resp_headers = dict(resp.headers)
            if is_stream:
                raw = await resp.content.read()
                return resp.status, resp_headers, raw
            else:
                data = await resp.json()
                return resp.status, resp_headers, json.dumps(data).encode("utf-8")


# ---------------------------------------------------------------------------
# Kimi (OpenAI format) routing
# ---------------------------------------------------------------------------

async def _kimi_translate(
    body: dict, kimi_key: str, kimi_base: str, kimi_model: str,
) -> tuple[int, dict, bytes]:
    """Translate Anthropic request → OpenAI, call Kimi, translate back."""
    is_stream = body.get("stream", False)
    openai_body = anthropic_to_openai(body, kimi_model)

    url = f"{kimi_base}/chat/completions"
    req_headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {kimi_key}",
    }

    async with aiohttp.ClientSession() as session:
        if is_stream:
            async with session.post(
                url, headers=req_headers, json=openai_body,
                timeout=aiohttp.ClientTimeout(total=300),
            ) as resp:
                resp_headers = dict(resp.headers)
                anthropic_model = body.get("model", KIMI_MODEL)
                req_id = f"msg_{uuid.uuid4().hex[:24]}"

                # Collect all SSE bytes
                parts: list[bytes] = []
                async for chunk in _translate_openai_stream(
                    resp, anthropic_model, req_id,
                ):
                    parts.append(chunk)

                full_body = b"".join(parts)
                return resp.status, resp_headers, full_body
        else:
            async with session.post(
                url, headers=req_headers, json=openai_body,
                timeout=aiohttp.ClientTimeout(total=300),
            ) as resp:
                openai_resp = await resp.json()
                anthropic_resp = openai_to_anthropic_response(openai_resp, body)
                return resp.status, dict(resp.headers), json.dumps(anthropic_resp).encode("utf-8")


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

async def handle_messages(request: web.Request) -> web.StreamResponse:
    """POST /v1/messages — Anthropic Messages API endpoint."""
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise web.HTTPBadRequest(text=json.dumps({"error": "Invalid JSON"}))

    provider, api_key, base_url, model = decide_target(body)
    is_stream = body.get("stream", False)
    logger.info(
        f"→ {provider} | model={model} | stream={is_stream} | "
        f"max_tokens={body.get('max_tokens','?')}"
    )

    try:
        if provider == "deepseek":
            status, resp_headers, raw = await _deepseek_passthrough(
                body, dict(request.headers), api_key, base_url,
            )
        else:
            status, resp_headers, raw = await _kimi_translate(
                body, api_key, base_url, model,
            )
    except asyncio.TimeoutError:
        raise web.HTTPGatewayTimeout(text=json.dumps({"error": "Upstream timeout"}))
    except aiohttp.ClientError as exc:
        raise web.HTTPBadGateway(
            text=json.dumps({"error": f"Upstream error: {exc}"})
        )

    resp = web.StreamResponse(status=status)
    cors_headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "x-router-provider": provider,
        "x-router-model": model,
        "Content-Type": "text/event-stream" if is_stream else "application/json",
    }
    for k, v in {**resp_headers, **cors_headers}.items():
        if k.lower() not in ("content-encoding", "transfer-encoding", "content-length"):
            resp.headers[k] = v
    await resp.prepare(request)
    await resp.write(raw)
    await resp.write_eof()
    logger.info(f"✓ {provider} response {status} ({len(raw)} bytes)")
    return resp


async def handle_models(request: web.Request) -> web.Response:
    """GET /v1/models — return model list for Claude Code discovery."""
    data = {
        "data": [
            {"id": "claude-sonnet-baidu", "type": "model", "display_name": "DeepSeek (Default)"},
            {"id": "kimi-k2.6", "type": "model", "display_name": "Kimi K2.6 (Images/Long)"},
        ]
    }
    return web.json_response(data)


async def handle_options(request: web.Request) -> web.Response:
    return web.Response(
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }
    )


async def handle_health(request: web.Request) -> web.Response:
    return web.json_response({"status": "ok", "providers": ["deepseek", "kimi"]})


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

def create_app() -> web.Application:
    app = web.Application()
    app.router.add_post("/v1/messages", handle_messages)
    app.router.add_get("/v1/models", handle_models)
    app.router.add_get("/health", handle_health)
    app.router.add_route("OPTIONS", "/v1/messages", handle_options)
    app.router.add_route("OPTIONS", "/v1/models", handle_options)
    return app


def main():
    app = create_app()
    logger.info(f"Model Router starting on http://127.0.0.1:{PORT}")
    logger.info(f"  Default  → DeepSeek ({DEEPSEEK_BASE})")
    logger.info(f"  Images   → Kimi     ({KIMI_BASE})")
    logger.info(f"  Long ctx → Kimi     (>{LONG_CONTEXT_THRESHOLD} chars)")
    web.run_app(app, host="127.0.0.1", port=PORT, print=None)


if __name__ == "__main__":
    main()
