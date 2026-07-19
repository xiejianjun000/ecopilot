"""
EcoPilot AI 自愈脚本 — 自动收集 CI 错误 → 调用 DeepSeek → 应用修复 → 推送分支

设计原则：
1. 修复只推 refactor/ai-self-healing-* 分支，不碰主干
2. 优先扫描核心目录，忽略 node_modules/.next/hermes-agent 等
3. 单次修复上下文 < 50K tokens，超限分批处理
4. 失败安全：任何步骤出错都不修改主干

依赖：
- openai (DeepSeek 兼容 OpenAI SDK)
- 环境变量：
  - DEEPSEEK_API_KEY  必填
  - DEEPSEEK_BASE_URL 默认 https://api.deepseek.com
  - ECOPILOT_TEXT_MODEL 默认 deepseek-chat
  - AI_HEALING_DRY_RUN=1 只收集错误不调用 AI（调试用）

用法：
    python scripts/ai_self_healing.py                 # 完整流程
    python scripts/ai_self_healing.py --collect-only  # 仅收集错误
    python scripts/ai_self_healing.py --apply <patch.json>  # 应用指定补丁
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional


def _find_python() -> str:
    """寻找可用的 Python 解释器（优先 python3）"""
    for candidate in ("python3", "python"):
        try:
            r = subprocess.run([candidate, "--version"], capture_output=True, text=True, timeout=5)
            if r.returncode == 0:
                return candidate
        except Exception:
            continue
    return "python3"  # fallback


PYTHON_BIN = _find_python()

# ─── 配置 ─────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent

# 优先扫描目录（核心业务代码）
SCAN_DIRS = [
    "desktop/frontend/lib",
    "desktop/frontend/components",
    "desktop/frontend/app",
    "desktop/server",
]

# 忽略目录（避免上下文爆炸）
IGNORE_PATTERNS = [
    "node_modules", ".next", "dist", "build", "__pycache__",
    ".pytest_cache", "coverage", "*.pyc", ".turbo",
    "hermes-agent",  # 独立子项目
    "ecopilot-website",  # 静态官网
    ".git",
]

# 错误报告最大长度（字符）— 避免上下文爆炸
MAX_ERROR_CONTEXT = 30000

# AI 修复专家系统提示词
PROMPT_FILE = REPO_ROOT / "scripts" / "ai_self_healing_prompt.md"


# ─── 工具函数 ──────────────────────────────────────────────

def run(cmd: list[str], cwd: Path = REPO_ROOT, timeout: int = 120, capture: bool = True) -> tuple[int, str, str]:
    """运行命令，返回 (exit_code, stdout, stderr)"""
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=capture, text=True, timeout=timeout)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return 124, "", f"命令超时: {' '.join(cmd)}"
    except Exception as e:
        return 1, "", str(e)


def truncate(text: str, limit: int = MAX_ERROR_CONTEXT) -> str:
    """截断文本到指定长度"""
    if len(text) <= limit:
        return text
    half = limit // 2
    return text[:half] + f"\n\n... [已截断 {len(text) - limit} 字符] ...\n\n" + text[-half:]


# ─── 错误收集器 ────────────────────────────────────────────

class ErrorCollector:
    """收集前端和后端的 CI 错误"""

    def __init__(self):
        self.errors: list[dict] = []

    def add(self, category: str, severity: str, message: str, file: Optional[str] = None):
        self.errors.append({
            "category": category,
            "severity": severity,
            "message": message,
            "file": file,
            "timestamp": datetime.now().isoformat(),
        })

    def collect_frontend(self) -> bool:
        """收集前端错误：tsc + oxlint + vitest"""
        fe_dir = REPO_ROOT / "desktop" / "frontend"
        if not fe_dir.exists():
            return False

        # 1. TypeScript 类型检查
        code, out, err = run(["pnpm", "exec", "tsc", "--noEmit"], cwd=fe_dir, timeout=180)
        if code != 0:
            self.add("frontend", "critical", f"TypeScript 类型检查失败:\n{truncate(err or out)}")
        else:
            print("  [frontend] tsc 通过")

        # 2. oxlint（在 desktop 目录执行，避免 pnpm workspace 根目录递归问题）
        code, out, err = run(["pnpm", "exec", "oxlint", "."], cwd=REPO_ROOT / "desktop", timeout=60)
        if code != 0:
            # oxlint 找到问题返回非0；但 pnpm 包装层失败也会非0，需区分
            if "ERR_PNPM" in (out + err):
                self.add("frontend", "high", f"oxlint 执行异常:\n{truncate(out + err)}")
            else:
                self.add("frontend", "high", f"oxlint 发现问题:\n{truncate(out + err)}")

        # 3. vitest
        code, out, err = run(["pnpm", "exec", "vitest", "run"], cwd=fe_dir, timeout=180)
        if code != 0:
            self.add("frontend", "critical", f"vitest 测试失败:\n{truncate(err or out)}")
        else:
            print("  [frontend] vitest 通过")

        return any(e["category"] == "frontend" for e in self.errors)

    def collect_backend(self) -> bool:
        """收集后端错误：import + pytest"""
        be_dir = REPO_ROOT / "desktop" / "server"
        if not be_dir.exists():
            return False

        # 1. 模块导入检查
        for mod in ["chat_api", "knowledge_api", "permit_parser", "license_manager"]:
            code, out, err = run([PYTHON_BIN, "-c", f"import {mod}; print('{mod} OK')"], cwd=be_dir, timeout=30)
            if code != 0:
                self.add("backend", "critical", f"模块导入失败 {mod}:\n{truncate(err)}", file=f"desktop/server/{mod}.py")

        # 2. pytest
        code, out, err = run([PYTHON_BIN, "-m", "pytest", "tests/", "-v", "--tb=short"], cwd=be_dir, timeout=180)
        if code != 0:
            self.add("backend", "critical", f"pytest 测试失败:\n{truncate(err or out)}")
        else:
            print("  [backend] pytest 通过")

        return any(e["category"] == "backend" for e in self.errors)

    def collect_all(self) -> bool:
        """收集所有错误，返回是否有错误"""
        print("━" * 60)
        print("🔍 开始收集 CI 错误...")
        print("━" * 60)

        fe_has = self.collect_frontend()
        be_has = self.collect_backend()

        print(f"\n📊 收集完成: {len(self.errors)} 个错误")
        for e in self.errors:
            icon = "🔴" if e["severity"] == "critical" else "🟠" if e["severity"] == "high" else "🟡"
            print(f"  {icon} [{e['category']}] {e['message'][:80]}...")

        return len(self.errors) > 0

    def to_prompt_context(self) -> str:
        """将错误转换为给 AI 的上下文"""
        if not self.errors:
            return "无错误，所有 CI 检查通过。"

        parts = ["# 当前 CI 错误报告\n"]
        for i, e in enumerate(self.errors, 1):
            parts.append(f"## 错误 {i}: [{e['category']}/{e['severity']}]")
            if e["file"]:
                parts.append(f"文件: {e['file']}")
            parts.append(f"详情:\n{e['message']}\n")
        return "\n".join(parts)


# ─── 文件上下文加载 ────────────────────────────────────────

def load_file_context(file_path: str, max_chars: int = 8000) -> Optional[str]:
    """加载指定文件的内容作为上下文（限制大小）"""
    full_path = REPO_ROOT / file_path
    if not full_path.exists() or not full_path.is_file():
        return None

    # 安全检查：不能加载忽略目录的文件
    rel = str(full_path.relative_to(REPO_ROOT))
    for pattern in IGNORE_PATTERNS:
        if pattern in rel:
            return None

    try:
        content = full_path.read_text(encoding="utf-8", errors="replace")
        return truncate(content, max_chars)
    except Exception:
        return None


def extract_referenced_files(error_text: str) -> list[str]:
    """从错误报告中提取被引用的文件路径"""
    # 匹配 desktop/frontend/... 或 desktop/server/... 等路径
    patterns = [
        r'(desktop/frontend/[^\s:]+\.(ts|tsx|js|jsx))',
        r'(desktop/server/[^\s:]+\.py)',
        r'(desktop/[^\s:]+\.(ts|tsx|py))',
    ]
    files = set()
    for pattern in patterns:
        matches = re.findall(pattern, error_text)
        for m in matches:
            files.add(m[0] if isinstance(m, tuple) else m)
    return sorted(files)[:10]  # 最多 10 个文件


# ─── GitHub 同类项目对标分析 ─────────────────────────────

class BenchmarkAnalyzer:
    """
    对标 GitHub 同类项目，提取最佳实践作为 AI 修复的参考上下文。

    策略：
    1. 根据错误类型选择对标维度（React Hooks / TypeScript / FastAPI 等）
    2. 调用 GitHub Search API 搜索高星同类项目
    3. 抓取相关文件片段作为参考
    4. 输出"对标分析报告"给 AI 作为修复参考
    """

    # 对标维度映射：错误关键词 → GitHub 搜索关键词（用简单查询避免空结果）
    BENCHMARK_QUERIES = {
        "react-hooks": "react hooks",
        "rules-of-hooks": "react hooks eslint",
        "exhaustive-deps": "react useEffect",
        "typescript": "typescript",
        "no-unused-vars": "eslint typescript",
        "fastapi": "fastapi",
        "pytest": "pytest",
        "nextjs": "nextjs",
    }

    # EcoPilot 同类项目（用于直接对标）
    SIMILAR_REPOS = [
        "vercel/next.js",                    # Next.js 官方示例
        "facebook/react",                    # React 官方
        "tiangolo/fastapi",                  # FastAPI 官方
        "shadcn-ui/ui",                      # shadcn 组件库
    ]

    def __init__(self):
        self.github_token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN", "")
        self.api_base = "https://api.github.com"
        # 缓存：避免重复请求（URL → 返回结果，None 表示已请求且无结果）
        self._cache: dict[str, Optional[dict]] = {}

    def _headers(self) -> dict:
        h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        if self.github_token:
            h["Authorization"] = f"Bearer {self.github_token}"
        return h

    def _gh_get(self, path: str, timeout: int = 15) -> Optional[dict]:
        """GitHub API GET 请求（带结果缓存）"""
        import urllib.request
        import urllib.error
        url = f"{self.api_base}{path}"
        if url in self._cache:
            return self._cache[url]  # 返回缓存的结果
        try:
            req = urllib.request.Request(url, headers=self._headers())
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                self._cache[url] = result
                return result
        except urllib.error.HTTPError as e:
            if e.code == 403:
                print(f"  ⚠️  GitHub API 限流，跳过对标分析")
            self._cache[url] = None
            return None
        except Exception:
            self._cache[url] = None
            return None

    def detect_benchmark_dimensions(self, errors: list[dict]) -> list[str]:
        """根据错误类型检测需要对标的维度"""
        dimensions = set()
        for err in errors:
            msg = err.get("message", "").lower()
            if "rules-of-hooks" in msg or "react hook" in msg.lower():
                dimensions.add("rules-of-hooks")
                dimensions.add("react-hooks")
            if "exhaustive-deps" in msg:
                dimensions.add("exhaustive-deps")
            if "no-unused-vars" in msg:
                dimensions.add("no-unused-vars")
                dimensions.add("typescript")
            if "typescript" in msg or "tsc" in msg:
                dimensions.add("typescript")
            if "fastapi" in msg or "pytest" in msg or "import" in msg:
                dimensions.add("fastapi")
            if "next" in msg:
                dimensions.add("nextjs")
        return sorted(dimensions)

    def search_similar_projects(self, dimension: str, limit: int = 3) -> list[dict]:
        """搜索同类项目，返回 [{full_name, stargazers_count, description, html_url}]"""
        query = self.BENCHMARK_QUERIES.get(dimension, "")
        if not query:
            return []
        # URL 编码
        import urllib.parse
        encoded = urllib.parse.quote(query)
        result = self._gh_get(f"/search/repositories?q={encoded}&sort=stars&order=desc&per_page={limit}")
        if not result or "items" not in result:
            return []
        return [
            {
                "full_name": r["full_name"],
                "stars": r["stargazers_count"],
                "description": r.get("description", ""),
                "url": r["html_url"],
            }
            for r in result["items"][:limit]
        ]

    def fetch_reference_code(self, repo: str, path: str) -> Optional[str]:
        """抓取指定仓库文件的内容作为参考（限制 2000 字符）"""
        result = self._gh_get(f"/repos/{repo}/contents/{path}")
        if not result or "content" not in result:
            return None
        import base64
        try:
            content = base64.b64decode(result["content"]).decode("utf-8", errors="replace")
            return truncate(content, 2000)
        except Exception:
            return None

    def generate_benchmark_report(self, errors: list[dict]) -> str:
        """生成对标分析报告"""
        dimensions = self.detect_benchmark_dimensions(errors)
        if not dimensions:
            return ""

        print(f"\n🔬 对标分析维度: {dimensions}")

        report_parts = ["# GitHub 同类项目对标分析报告\n"]
        report_parts.append(f"检测到的问题维度: {', '.join(dimensions)}\n")

        for dim in dimensions[:3]:  # 最多 3 个维度
            report_parts.append(f"\n## 维度: {dim}\n")
            projects = self.search_similar_projects(dim, limit=3)
            if not projects:
                report_parts.append("(GitHub API 不可用或限流，跳过)\n")
                continue

            report_parts.append("### 同类高星项目参考：\n")
            for p in projects:
                report_parts.append(f"- **{p['full_name']}** ⭐{p['stars']} — {p['description'][:100] if p['description'] else 'N/A'}")
                report_parts.append(f"  URL: {p['url']}\n")

            # 根据维度抓取参考代码片段
            ref_paths = {
                "rules-of-hooks": [("facebook/react", "fixtures/art/src/forward-ref/__tests__/__snapshots__/forward-ref-test.js.snap")],
                "exhaustive-deps": [("facebook/react", "scripts/eslint/react-hooks.js")],
                "typescript": [("vercel/next.js", "packages/next/types/index.d.ts")],
                "no-unused-vars": [],
                "fastapi": [("tiangolo/fastapi", "fastapi/routing.py")],
                "nextjs": [("vercel/next.js", "package.json")],
                "react-hooks": [],
            }
            for repo, path in ref_paths.get(dim, []):
                content = self.fetch_reference_code(repo, path)
                if content:
                    report_parts.append(f"\n### 参考代码: `{repo}/{path}`\n```\n{content[:1000]}\n```\n")

        report_parts.append("\n## 修复建议")
        report_parts.append("请参考上述同类项目的最佳实践，确保修复方案符合行业惯例。")
        report_parts.append("特别注意：")
        report_parts.append("1. React Hooks 必须在组件顶层调用，不能在条件分支/循环中")
        report_parts.append("2. useEffect 依赖数组必须完整，或用 eslint-disable 注释说明原因")
        report_parts.append("3. 未使用的 import/变量必须删除，不能保留")
        report_parts.append("4. TypeScript 类型必须明确，不使用 any")
        report_parts.append("")

        return "\n".join(report_parts)


# ─── AI 修复客户端 ─────────────────────────────────────────

class AIHealer:
    """调用 DeepSeek 生成修复方案"""

    def __init__(self):
        self.api_key = os.environ.get("DEEPSEEK_API_KEY", "")
        self.base_url = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
        self.model = os.environ.get("ECOPILOT_TEXT_MODEL", "deepseek-chat")

        if not self.api_key:
            raise RuntimeError("DEEPSEEK_API_KEY 未设置")

        try:
            from openai import OpenAI
            self.client = OpenAI(api_key=self.api_key, base_url=self.base_url)
        except ImportError:
            raise RuntimeError("未安装 openai 包：pip install openai")

        # 加载系统提示词
        if not PROMPT_FILE.exists():
            raise RuntimeError(f"系统提示词文件不存在: {PROMPT_FILE}")
        self.system_prompt = PROMPT_FILE.read_text(encoding="utf-8")

    def generate_fix(self, error_context: str, file_contexts: dict[str, str], benchmark_report: str = "") -> dict:
        """调用 AI 生成修复方案"""
        user_msg = f"""# 任务
请分析以下 CI 错误，并按照系统提示词中定义的 JSON 格式输出修复方案。

# 错误报告
{error_context}

# 相关文件上下文
"""
        for path, content in file_contexts.items():
            user_msg += f"\n## 文件: {path}\n```\n{content}\n```\n"

        # 加入对标分析报告（如果有）
        if benchmark_report:
            user_msg += f"\n# GitHub 同类项目对标分析\n{benchmark_report}\n"

        user_msg += """
# 要求
1. 严格按照系统提示词的 JSON 格式输出
2. 只修复报告中的错误，不做额外重构
3. 修复方案必须可验证（提供 verification 字段）
4. 如果无法修复或需要人工，返回空 files 数组

请输出修复方案 JSON：
"""

        print(f"\n🤖 调用 DeepSeek ({self.model}) 生成修复方案...")
        print(f"   上下文长度: {len(user_msg)} 字符")

        try:
            resp = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                temperature=0.1,  # 低温度，确保修复稳定
                max_tokens=4096,
            )
            content = resp.choices[0].message.content or ""

            # 提取 JSON
            json_match = re.search(r'```json\s*(\{.*?\})\s*```', content, re.DOTALL)
            if json_match:
                return json.loads(json_match.group(1))
            # 尝试直接解析
            return json.loads(content)

        except json.JSONDecodeError as e:
            print(f"  ❌ AI 返回的 JSON 解析失败: {e}")
            return {"summary": "AI 返回格式错误", "files": [], "risk": "high"}
        except Exception as e:
            print(f"  ❌ 调用 AI 失败: {e}")
            return {"summary": f"AI 调用失败: {e}", "files": [], "risk": "high"}


# ─── 补丁应用器 ────────────────────────────────────────────

class PatchApplier:
    """应用 AI 生成的补丁到文件系统"""

    @staticmethod
    def apply(patch: dict, dry_run: bool = False) -> tuple[bool, list[str]]:
        """应用补丁，返回 (是否成功, 变更文件列表)"""
        files = patch.get("files", [])
        if not files:
            return True, []

        changes = []
        all_ok = True

        for f in files:
            path = f.get("path", "")
            action = f.get("action", "edit")
            original = f.get("original", "")
            replacement = f.get("replacement", "")

            # 安全检查
            if not path or ".." in path:
                print(f"  ❌ 跳过不安全路径: {path}")
                all_ok = False
                continue

            # 检查是否在忽略目录
            if any(p in path for p in IGNORE_PATTERNS):
                print(f"  ❌ 跳过忽略目录的文件: {path}")
                all_ok = False
                continue

            full_path = REPO_ROOT / path

            if dry_run:
                print(f"  [DRY-RUN] {action} {path}")
                changes.append(path)
                continue

            try:
                if action == "edit":
                    if not full_path.exists():
                        print(f"  ❌ 文件不存在: {path}")
                        all_ok = False
                        continue
                    content = full_path.read_text(encoding="utf-8")
                    if original not in content:
                        print(f"  ❌ 原文未找到（可能已修复）: {path}")
                        all_ok = False
                        continue
                    if content.count(original) > 1:
                        print(f"  ❌ 原文不唯一，需更精确匹配: {path}")
                        all_ok = False
                        continue
                    new_content = content.replace(original, replacement, 1)
                    full_path.write_text(new_content, encoding="utf-8")
                    print(f"  ✏️  修改: {path}")
                    changes.append(path)

                elif action == "create":
                    if full_path.exists():
                        print(f"  ❌ 文件已存在: {path}")
                        all_ok = False
                        continue
                    full_path.parent.mkdir(parents=True, exist_ok=True)
                    full_path.write_text(replacement, encoding="utf-8")
                    print(f"  📄 新建: {path}")
                    changes.append(path)

                elif action == "delete":
                    if not full_path.exists():
                        print(f"  ⚠️  文件不存在（跳过）: {path}")
                        continue
                    full_path.unlink()
                    print(f"  🗑️  删除: {path}")
                    changes.append(path)

            except Exception as e:
                print(f"  ❌ 应用失败 {path}: {e}")
                all_ok = False

        return all_ok, changes


# ─── Git 操作 ──────────────────────────────────────────────

class GitOps:
    """Git 分支和 PR 操作"""

    BRANCH_PREFIX = "refactor/ai-self-healing"

    @staticmethod
    def create_healing_branch() -> str:
        """创建修复分支（基于当前时间戳）"""
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        branch = f"{GitOps.BRANCH_PREFIX}-{ts}"

        # 确保从 main 分支切出
        run(["git", "checkout", "main"])
        run(["git", "pull", "--ff-only", "origin", "main"])
        code, _, err = run(["git", "checkout", "-b", branch])
        if code != 0:
            raise RuntimeError(f"创建分支失败: {err}")
        print(f"🌿 已创建分支: {branch}")
        return branch

    @staticmethod
    def commit_and_push(branch: str, files: list[str], message: str) -> bool:
        """提交并推送变更"""
        if not files:
            print("ℹ️  无文件变更，跳过提交")
            return False

        # 只 add 变更的文件（不 git add -A）
        for f in files:
            run(["git", "add", f])

        # 检查是否有实际变更
        code, out, _ = run(["git", "diff", "--cached", "--stat"])
        if not out.strip():
            print("ℹ️  无实际变更，跳过提交")
            return False

        # 提交
        full_msg = f"fix(ai-self-healing): {message}\n\n由 AI 自愈脚本自动生成\n分支: {branch}\n时间: {datetime.now().isoformat()}"
        code, _, err = run(["git", "commit", "-m", full_msg])
        if code != 0:
            print(f"❌ git commit 失败: {err}")
            return False

        # 推送
        code, _, err = run(["git", "push", "-u", "origin", branch])
        if code != 0:
            print(f"❌ git push 失败: {err}")
            return False

        print(f"✅ 已推送到 {branch}")
        return True

    @staticmethod
    def create_pr(branch: str, patch: dict) -> bool:
        """创建 Pull Request（不自动合并）"""
        title = f"[AI自愈] {patch.get('summary', '自动修复')}"
        body = f"""## 🤖 AI 自愈 PR

> ⚠️ 此 PR 由 AI 自愈脚本自动生成，**请人工 review 后再合并**，禁止直接合并到 main。

### 修复概要
{patch.get('summary', '无')}

### 对标分析
{patch.get('benchmark', '未进行对标分析')}

### 风险等级
{'🔴 高' if patch.get('risk') == 'high' else '🟠 中' if patch.get('risk') == 'medium' else '🟢 低'}

### 验证方式
{patch.get('verification', '请运行 CI 检查')}

### 修改文件
"""
        for f in patch.get("files", []):
            body += f"- `{f.get('path', '?')}` ({f.get('action', 'edit')})\n"

        body += f"""
### 元信息
- 分支: `{branch}`
- 生成时间: {datetime.now().isoformat()}
- 标签: `ai-self-healing`

### Reviewer 注意事项
1. 检查修复是否引入新问题
2. 确认 CI 全绿后再合并
3. 合并后分支会自动删除
"""
        # 用 gh CLI 创建 PR
        code, out, err = run([
            "gh", "pr", "create",
            "--base", "main",
            "--head", branch,
            "--title", title,
            "--body", body,
            "--label", "ai-self-healing",
        ])
        if code != 0:
            # 标签可能不存在，尝试不带标签重试
            code, out, err = run([
                "gh", "pr", "create",
                "--base", "main",
                "--head", branch,
                "--title", title,
                "--body", body,
            ])
            if code != 0:
                print(f"❌ 创建 PR 失败: {err}")
                return False

        pr_url = out.strip()
        print(f"✅ PR 已创建: {pr_url}")
        return True


# ─── 主流程 ────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="EcoPilot AI 自愈脚本")
    parser.add_argument("--collect-only", action="store_true", help="仅收集错误，不调用 AI")
    parser.add_argument("--apply", type=str, help="应用指定的补丁 JSON 文件")
    parser.add_argument("--dry-run", action="store_true", help="空运行，不实际修改文件")
    args = parser.parse_args()

    print("=" * 60)
    print("  EcoPilot AI 自愈脚本")
    print(f"  时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  仓库: {REPO_ROOT}")
    print("=" * 60)

    # 模式 1：仅应用补丁
    if args.apply:
        print(f"\n📦 应用补丁: {args.apply}")
        patch = json.loads(Path(args.apply).read_text(encoding="utf-8"))
        ok, changes = PatchApplier.apply(patch, dry_run=args.dry_run)
        if ok and changes:
            print(f"\n✅ 补丁应用成功，变更 {len(changes)} 个文件")
        elif not changes:
            print("\nℹ️  补丁无文件变更")
        else:
            print("\n❌ 补丁应用失败")
            sys.exit(1)
        return

    # 模式 2：完整流程
    # Step 1: 收集错误
    collector = ErrorCollector()
    has_errors = collector.collect_all()

    if not has_errors:
        print("\n✅ 未发现 CI 错误，无需修复")
        return

    if args.collect_only:
        print("\n📋 仅收集模式，不调用 AI")
        # 保存错误报告
        report_file = REPO_ROOT / "scripts" / "error_report.json"
        report_file.write_text(json.dumps({
            "timestamp": datetime.now().isoformat(),
            "errors": collector.errors,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"   错误报告已保存: {report_file}")
        return

    # Step 2: 加载相关文件上下文
    print("\n📖 加载相关文件上下文...")
    error_context = collector.to_prompt_context()
    referenced_files = extract_referenced_files(error_context)
    file_contexts = {}
    for f in referenced_files:
        content = load_file_context(f)
        if content:
            file_contexts[f] = content
            print(f"   ✓ 加载: {f}")
    print(f"   共加载 {len(file_contexts)} 个文件上下文")

    # Step 3: 对标 GitHub 同类项目
    print("\n🔬 对标 GitHub 同类项目...")
    benchmark = BenchmarkAnalyzer()
    benchmark_report = benchmark.generate_benchmark_report(collector.errors)
    if benchmark_report:
        print(f"   ✓ 对标报告生成完成 ({len(benchmark_report)} 字符)")
        # 保存对标报告
        bench_file = REPO_ROOT / "scripts" / f"benchmark_{int(time.time())}.md"
        bench_file.write_text(benchmark_report, encoding="utf-8")
        print(f"   ✓ 对标报告已保存: {bench_file}")
    else:
        print("   ℹ️  无需对标（未检测到已知维度）或 GitHub API 不可用")

    # Step 4: 调用 AI 生成修复
    if os.environ.get("AI_HEALING_DRY_RUN") == "1":
        print("\n🔇 AI_HEALING_DRY_RUN=1，跳过 AI 调用")
        patch = {"summary": "dry-run 模式", "files": [], "risk": "low"}
    else:
        healer = AIHealer()
        patch = healer.generate_fix(error_context, file_contexts, benchmark_report)

    print(f"\n📋 修复方案:")
    print(f"   摘要: {patch.get('summary', '无')}")
    print(f"   风险: {patch.get('risk', '未知')}")
    print(f"   文件: {len(patch.get('files', []))} 个")

    # 保存补丁
    patch_file = REPO_ROOT / "scripts" / f"patch_{int(time.time())}.json"
    patch_file.write_text(json.dumps(patch, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"   补丁已保存: {patch_file}")

    if not patch.get("files"):
        print("\nℹ️  AI 未给出修复方案（可能需要人工介入）")
        return

    # Step 4: 创建分支
    print("\n🌿 创建修复分支...")
    try:
        branch = GitOps.create_healing_branch()
    except Exception as e:
        print(f"❌ {e}")
        sys.exit(1)

    # Step 5: 应用补丁
    print("\n🔧 应用修复补丁...")
    ok, changes = PatchApplier.apply(patch, dry_run=args.dry_run)
    if not ok:
        print("❌ 补丁应用部分失败，请检查")
    if not changes:
        print("ℹ️  无实际文件变更，跳过 PR")
        return

    # Step 6: 提交并推送
    print("\n📤 提交并推送...")
    pushed = GitOps.commit_and_push(branch, changes, patch.get("summary", "AI 自动修复"))
    if not pushed:
        print("ℹ️  未推送到远程")
        return

    # Step 7: 创建 PR
    print("\n📝 创建 Pull Request...")
    GitOps.create_pr(branch, patch)

    print("\n" + "=" * 60)
    print("  ✅ AI 自愈流程完成")
    print(f"  分支: {branch}")
    print("  ⚠️  请人工 review PR 后再合并")
    print("=" * 60)


if __name__ == "__main__":
    main()
