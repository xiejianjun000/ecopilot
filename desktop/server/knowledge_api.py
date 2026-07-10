"""
EcoPilot Knowledge Vault API — Obsidian 兼容的知识库后端
扫描 ~/.ecopilot-home/knowledge/ 目录，解析 frontmatter，提供列表/检索/反向链接/图谱
"""
import os, re, json, asyncio
from pathlib import Path
from typing import Optional
from fastapi import Request
from fastapi.responses import JSONResponse

KB_ROOT = Path.home() / ".ecopilot-home" / "knowledge"

# ═══ Frontmatter 解析 ═══
_FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
_WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")

def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """解析 YAML frontmatter（简易版，不依赖 PyYAML）。"""
    m = _FM_RE.match(text)
    if not m:
        return {}, text
    fm_text = m.group(1)
    body = text[m.end():]

    fm = {}
    current_key = None
    for line in fm_text.split('\n'):
        # 列表项：  - value
        if line.startswith('  - '):
            v = line[4:].strip().strip('"').strip("'")
            if current_key:
                if not isinstance(fm[current_key], list):
                    fm[current_key] = []
                fm[current_key].append(v)
            continue
        # 嵌套字典项（ai_risk_notes 等）：    clause: "§37"
        if line.startswith('    '):
            inner = line.strip()
            if ':' in inner and current_key and isinstance(fm[current_key], list) and fm[current_key] and isinstance(fm[current_key][-1], dict):
                k, v = inner.split(':', 1)
                fm[current_key][-1][k.strip()] = v.strip().strip('"').strip("'")
            continue
        # 普通键值对：key: value
        if ':' in line:
            k, v = line.split(':', 1)
            k = k.strip()
            v = v.strip()
            if v == '':
                # 可能是多行列表/字典起始
                fm[k] = []
                current_key = k
            else:
                # 去引号
                if v.startswith('"') and v.endswith('"'):
                    v = v[1:-1]
                elif v.startswith("'") and v.endswith("'"):
                    v = v[1:-1]
                # 处理 inline list：[a, b, c]
                if v.startswith('[') and v.endswith(']'):
                    inner = v[1:-1]
                    items = [item.strip().strip('"').strip("'") for item in inner.split(',') if item.strip()]
                    fm[k] = items
                else:
                    fm[k] = v
                current_key = k
    return fm, body


def _extract_wikilinks(text: str) -> list[str]:
    """提取所有 [[wikilink]] 目标。"""
    return [m.group(1).split('|')[0].split('#')[0].strip() for m in _WIKILINK_RE.finditer(text)]


def _scan_vault() -> list[dict]:
    """扫描整个 vault，返回所有 MD 文件的结构化信息。"""
    if not KB_ROOT.exists():
        return []
    files = []
    for md in sorted(KB_ROOT.rglob("*.md")):
        # 跳过 .obsidian 目录
        if '.obsidian' in md.parts:
            continue
        try:
            text = md.read_text(encoding='utf-8')
            fm, body = _parse_frontmatter(text)
            rel_path = md.relative_to(KB_ROOT)
            # id 用相对路径去除 .md 扩展名（Obsidian wikilink 目标格式）
            doc_id = str(rel_path).replace('.md', '')
            # 文件名（不含扩展名）
            file_name = md.stem
            # wikilinks
            links = _extract_wikilinks(text)
            # 标签统一为列表
            tags = fm.get('tags', [])
            if isinstance(tags, str):
                tags = [tags]
            # industry 统一为列表
            industry = fm.get('industry', [])
            if isinstance(industry, str):
                industry = [industry]
            # applicable_stage 统一为列表
            stages = fm.get('applicable_stage', [])
            if isinstance(stages, str):
                stages = [stages]
            files.append({
                "id": doc_id,
                "name": file_name,
                "title": fm.get('title', file_name),
                "doc_number": fm.get('doc_number', ''),
                "issue_date": fm.get('issue_date', ''),
                "category": fm.get('category', '未分类'),
                "industry": industry,
                "applicable_stage": stages,
                "tags": tags,
                "aliases": fm.get('aliases', []) if isinstance(fm.get('aliases', []), list) else [fm.get('aliases', '')],
                "related": fm.get('related', []) if isinstance(fm.get('related', []), list) else [fm.get('related', '')],
                "ai_risk_notes": fm.get('ai_risk_notes', []),
                "links": links,
                "rel_path": str(rel_path),
                "size": md.stat().st_size,
                "mtime": md.stat().st_mtime,
                "line_count": text.count('\n') + 1,
            })
        except Exception as e:
            print(f"[Knowledge] 解析 {md.name} 失败: {e}")
    return files


# ═══ 缓存（10 秒 TTL）═══
_CACHE = {"data": None, "ts": 0}
_CACHE_TTL = 10

def _get_vault() -> list[dict]:
    now = asyncio.get_event_loop().time()
    if _CACHE["data"] is None or now - _CACHE["ts"] > _CACHE_TTL:
        _CACHE["data"] = _scan_vault()
        _CACHE["ts"] = now
    return _CACHE["data"]


def _find_by_id(vault: list[dict], doc_id: str) -> Optional[dict]:
    """按 id 查找（支持 wikilink 目标：文件名 or alias）。"""
    # 精确匹配 id
    for d in vault:
        if d["id"] == doc_id or d["name"] == doc_id:
            return d
    # alias 匹配
    for d in vault:
        if doc_id in d.get("aliases", []):
            return d
    # 模糊匹配（id 包含目标）
    for d in vault:
        if doc_id in d["id"] or doc_id in d["name"]:
            return d
    return None


def _build_backlinks(vault: list[dict], doc_id: str) -> list[dict]:
    """反向链接：哪些文档链接到了 doc_id。"""
    target = _find_by_id(vault, doc_id)
    if not target:
        return []
    # 所有可能的目标名：id, name, aliases
    targets = {target["id"], target["name"]}
    targets.update(target.get("aliases", []))

    backlinks = []
    for d in vault:
        if d["id"] == target["id"]:
            continue
        # 检查 d 的 links 是否命中 targets
        for link in d.get("links", []):
            if link in targets:
                backlinks.append({
                    "id": d["id"],
                    "name": d["name"],
                    "title": d["title"],
                    "category": d["category"],
                })
                break
    return backlinks


def _build_graph(vault: list[dict]) -> dict:
    """构建图谱数据：nodes + edges。"""
    nodes = []
    for d in vault:
        # 按 category 分色
        color = {"法规": "#ef4444", "标准": "#3b82f6", "模板": "#10b981", "MOC": "#8b5cf6"}.get(d["category"], "#6b7280")
        nodes.append({
            "id": d["id"],
            "name": d["name"],
            "title": d["title"],
            "category": d["category"],
            "color": color,
            "size": 5 + min(len(d.get("links", [])), 20),
        })
    edges = []
    seen_edges = set()
    for d in vault:
        for link in d.get("links", []):
            target = _find_by_id(vault, link)
            if target:
                edge_key = (d["id"], target["id"])
                if edge_key not in seen_edges and (target["id"], d["id"]) not in seen_edges:
                    edges.append({"source": d["id"], "target": target["id"]})
                    seen_edges.add(edge_key)
    return {"nodes": nodes, "edges": edges}


# ═══ API 路由处理函数 ═══
async def knowledge_list(request: Request):
    """GET /api/knowledge/list — 列出所有文档（含 frontmatter 元数据）。"""
    vault = _get_vault()
    # 支持查询参数筛选
    category = request.query_params.get('category')
    tag = request.query_params.get('tag')
    industry = request.query_params.get('industry')

    filtered = vault
    if category:
        filtered = [d for d in filtered if d['category'] == category]
    if tag:
        filtered = [d for d in filtered if tag in d.get('tags', [])]
    if industry:
        filtered = [d for d in filtered if industry in d.get('industry', ['通用'])]

    return JSONResponse({
        "ok": True,
        "total": len(filtered),
        "items": filtered,
        "categories": sorted({d['category'] for d in vault}),
        "tags": sorted({t for d in vault for t in d.get('tags', [])}),
        "industries": sorted({i for d in vault for i in d.get('industry', ['通用'])}),
    })


async def knowledge_file(request: Request):
    """GET /api/knowledge/file?id=xxx — 读取单个文档原文 + frontmatter + backlinks。"""
    doc_id = request.query_params.get('id')
    if not doc_id:
        return JSONResponse({"ok": False, "error": "缺少 id 参数"}, status_code=400)

    vault = _get_vault()
    doc = _find_by_id(vault, doc_id)
    if not doc:
        return JSONResponse({"ok": False, "error": f"未找到文档: {doc_id}"}, status_code=404)

    # 读取原文
    md_path = KB_ROOT / f"{doc['rel_path']}"
    if not md_path.exists():
        return JSONResponse({"ok": False, "error": "文件不存在"}, status_code=404)

    text = md_path.read_text(encoding='utf-8')
    fm, body = _parse_frontmatter(text)

    # 反向链接
    backlinks = _build_backlinks(vault, doc['id'])

    return JSONResponse({
        "ok": True,
        "doc": doc,
        "frontmatter": fm,
        "body": body,
        "raw": text,
        "backlinks": backlinks,
    })


async def knowledge_search(request: Request):
    """GET /api/knowledge/search?q=xxx — 全文检索。"""
    q = request.query_params.get('q', '').strip()
    if not q:
        return JSONResponse({"ok": True, "results": [], "query": q})

    vault = _get_vault()
    results = []

    # 条款号智能识别：§37 / 第三十七条
    clause_mode = q.startswith('§') or q.startswith('第') and '条' in q

    for d in vault:
        md_path = KB_ROOT / d['rel_path']
        if not md_path.exists():
            continue
        text = md_path.read_text(encoding='utf-8')

        # 标题/元数据匹配
        meta_match = (
            q in d.get('title', '')
            or q in d.get('doc_number', '')
            or q in d.get('name', '')
            or any(q in t for t in d.get('tags', []))
            or any(q in a for a in d.get('aliases', []))
        )

        # 正文匹配
        body_matches = []
        lines = text.split('\n')
        for i, line in enumerate(lines):
            if q.lower() in line.lower():
                # 提取上下文（前后各 1 行）
                start = max(0, i - 1)
                end = min(len(lines), i + 2)
                snippet = '\n'.join(lines[start:end])
                body_matches.append({"line": i + 1, "snippet": snippet})
                if len(body_matches) >= 5:
                    break

        if meta_match or body_matches:
            score = (10 if meta_match else 0) + len(body_matches)
            results.append({
                "id": d['id'],
                "title": d['title'],
                "doc_number": d.get('doc_number', ''),
                "category": d['category'],
                "score": score,
                "meta_match": meta_match,
                "body_matches": body_matches[:3],  # 最多返回 3 处
            })

    # 按相关度排序
    results.sort(key=lambda x: -x['score'])
    return JSONResponse({
        "ok": True,
        "query": q,
        "total": len(results),
        "results": results[:30],  # 最多 30 条
    })


async def knowledge_backlinks(request: Request):
    """GET /api/knowledge/backlinks?id=xxx — 反向链接。"""
    doc_id = request.query_params.get('id')
    if not doc_id:
        return JSONResponse({"ok": False, "error": "缺少 id 参数"}, status_code=400)

    vault = _get_vault()
    backlinks = _build_backlinks(vault, doc_id)
    return JSONResponse({
        "ok": True,
        "id": doc_id,
        "backlinks": backlinks,
    })


async def knowledge_graph(request: Request):
    """GET /api/knowledge/graph — 图谱数据。"""
    vault = _get_vault()
    graph = _build_graph(vault)
    return JSONResponse({
        "ok": True,
        "nodes": graph["nodes"],
        "edges": graph["edges"],
    })


async def knowledge_stats(request: Request):
    """GET /api/knowledge/stats — 知识库统计。"""
    vault = _get_vault()
    return JSONResponse({
        "ok": True,
        "total": len(vault),
        "by_category": {cat: sum(1 for d in vault if d['category'] == cat) for cat in sorted({d['category'] for d in vault})},
        "by_industry": {ind: sum(1 for d in vault if ind in d.get('industry', ['通用'])) for ind in sorted({i for d in vault for i in d.get('industry', ['通用'])})},
        "total_links": sum(len(d.get('links', [])) for d in vault),
        "total_tags": len({t for d in vault for t in d.get('tags', [])}),
        "risk_notes_count": sum(len(d.get('ai_risk_notes', [])) for d in vault),
    })


# ═══ 注册到 FastAPI app ═══
def register_knowledge_routes(app):
    """注册知识库 API 路由到 FastAPI app。"""
    app.add_api_route("/api/knowledge/list", knowledge_list, methods=["GET"])
    app.add_api_route("/api/knowledge/file", knowledge_file, methods=["GET"])
    app.add_api_route("/api/knowledge/search", knowledge_search, methods=["GET"])
    app.add_api_route("/api/knowledge/backlinks", knowledge_backlinks, methods=["GET"])
    app.add_api_route("/api/knowledge/graph", knowledge_graph, methods=["GET"])
    app.add_api_route("/api/knowledge/stats", knowledge_stats, methods=["GET"])
    print(f"[Knowledge] 已注册 6 个 API 端点，vault 路径: {KB_ROOT}")
