# EcoPilot — 企业生态环境合规AI管家

## 项目概述

EcoPilot 是一个 Web 端 AI 合规助手，面向工业企业（钢铁、水泥、火电等），帮助企业完成排污许可证管理、执行报告、台账记录、监测数据核验等生态环境合规工作。

## 架构：Hermes AI 引擎为基座

EcoPilot 是构建在 **[Hermes AI 引擎](file:///Users/mac/dev/ecopilot/desktop/server/hermes_adapter.py)** 之上的合规应用。Hermes 提供 AI 基座能力，EcoPilot 负责生态环境合规的业务逻辑。

```
┌─────────────────────────────────────────────────┐
│                  EcoPilot                        │
│  排污许可 · 执行报告 · 台账 · 监测核验 · 督察整改     │
├─────────────────────────────────────────────────┤
│               Hermes AI 引擎                     │
│  4层记忆 · 自学习 · GEPA进化 · 多Agent协作 · 技能市场  │
└─────────────────────────────────────────────────┘
```

Hermes 为 EcoPilot 提供以下核心能力：

| 能力层 | 说明 |
|--------|------|
| **记忆层** | 企业信息自动记忆、法规查询缓存、合规历史追溯（上限 500 条，风险分级） |
| **自学习层** | 从用户反馈中学习、合规模式识别、高频主题自动生成可复用技能（13 个主题触发词） |
| **多Agent层** | 7 个专业子代理：中央调度 / 法规检索 / 行业合规 / 数据核验 / 风险预警 / 应对执法 / 文书生成 |
| **GEPA进化层** | 提示词自动优化、企业知识沉淀（enterprise_evolution.jsonl）、响应质量持续改进 |
| **技能市场** | 子代理 SKILL.md 动态注入系统提示词，远程技能安装（`ecoskill/`） |

> EcoPilot = Hermes（AI 基座）+ 生态环境合规业务（许可证解析、排放标准、环保法规、督察整改流程）

## 技术栈

| 层 | 技术 | 端口 |
|---|------|------|
| 前端 | Next.js 16 + React 19 + Tailwind CSS 4 | 3000 |
| 后端 | Python 3.11 + FastAPI | 8002 |
| AI文本 | DeepSeek V4 (deepseek-v4-flash) | API |
| AI视觉 | Kimi/Moonshot (moonshot-v1-32k-vision-preview) | API |
| 浏览器自动化 | Playwright | 内置 |
| 运维 | chrome-devtools MCP + safari MCP | 远程 |
| 前端测试 | Vitest + @testing-library/react | 内置 |
| 后端测试 | pytest + pytest-asyncio | 内置 |
| CI/CD | GitHub Actions | 远程 |

## 目录结构

```
desktop/
  electron-app/          # 启动器
    main.js              # 一键启动脚本（自动启后端+前端+浏览器）
    run.sh
  frontend/              # Next.js 前端
    app/page.tsx         # 主页面（三栏布局）
    app/globals.css      # 设计系统（6级字号token + 语义色 + 圆角）
    components/
      left-sidebar.tsx   # 左侧导航（7个模块 + 会话列表，设置/连接器/通讯中心已迁至底部头像菜单）
      chat-main.tsx      # 对话 + 仪表盘 + 视图路由
      chat-input.tsx     # 消息输入 + 模型选择器 + 语音输入 + 附件
      chat-message.tsx   # 消息气泡（ReactMarkdown + remark-gfm）
      right-panel.tsx    # 右栏（AI管家 Header + 4层 Session Frame）
      setting-modal.tsx   # 设置弹窗（企业信息/模型配置/外观设置/通知/安全/关于）
      feedback-modal.tsx # 意见反馈弹窗
      views/
        inspection.tsx   # 交办整改（立行立改/跟踪督办/工程建设）
        calendar.tsx      # 合规日历（月历+时间轴双视图）
        vault.tsx         # 档案库
        knowledge.tsx     # 知识库
        connector.tsx     # MCP 连接器
        tasks.tsx         # 自动任务
        experts.tsx       # 专家Agent
        doc-editor.tsx    # 文档编辑器（台账/报告模板）
        links.tsx         # 政务平台链接
        dashboard.tsx     # 仪表盘
      ui/
        button.tsx        # 通用按钮组件
        modal.tsx         # 通用Modal（焦点陷阱+ESC+scroll锁）
    lib/
      api.ts             # API 客户端（SSE流式 + authHeaders + getApiBase）
      store.ts           # React Context + useReducer（HYDRATE 模式）
      types.ts           # TypeScript 类型定义
      monitor-sdk.ts     # 前端监控（fetch+keepalive 上报）
  server/                # Python 后端
    chat_api.py          # FastAPI 主服务（含系统提示词，支持 OmniRoute 网关）
    permit_scraper.py    # 排污许可平台 Playwright 爬虫
    license_reader.py    # 许可证数据读取
    execution_audit.py   # 执行报告审计
    permit_parser.py     # 许可证解析
    tools.py             # 工具调用定义
    license_manager.py   # 机器绑定授权
    feedback_reader.py   # 用户反馈阅读器
```

## 一键启动

```bash
cd desktop/electron-app

# 开发模式（HMR 热更新）
./run.sh --dev

# Chrome 独立窗口（像原生 App）
./run.sh --dev --chrome
```

## Windows 桌面应用打包

```bash
cd desktop/electron-app
npm install
npm run dist:win   # 产出 NSIS 安装包 + portable 单文件到 dist/
```

产物（dist/）：
- `EcoPilot Setup 1.0.0.exe` — NSIS 安装程序（可选安装目录、桌面/开始菜单快捷方式，中文界面）
- `EcoPilot 1.0.0.exe` — portable 单文件版
- `win-unpacked/` — 免安装目录版
- `latest.yml` + `.blockmap` — electron-updater 自动更新元数据

图标体系（全部为 eco 品牌词标，绝无默认黑色 Electron 图标）：
- `assets/icon.ico`（7 尺寸 16-256，Windows exe/安装包/快捷方式）
- `assets/icon.png` 1024px（窗口 + 托盘，由 `scripts/generate-icons.mjs` 从官方 `frontend/public/eco-logo.svg` 生成）
- `assets/icon.icns`（macOS）
- exe 内嵌图标经 rcedit 写入，版本信息 ProductName=EcoPilot

Linux 上构建 Windows 包的前置条件：
```bash
dpkg --add-architecture i386 && apt-get update
apt-get install -y wine wine32:i386   # rcedit-ia32 需要 wine32
rm -rf ~/.wine && wine wineboot --init  # wine32 安装后必须重建前缀
```
未装 wine32 时 electron-builder 会静默跳过 exe 图标写入（exe 变回默认 Electron 图标），NSIS 卸载程序生成也会失败。

## 导航模块（7个左侧导航）

| 模块 | 说明 |
|------|------|
| 新建对话 | AI 合规咨询 |
| 合规日历 | 合规日程管理（月历+时间轴双视图） |
| 交办整改 | 合规巡查清单 + 付费升级提示 |
| 自动任务 | 报告自动生成 |
| 申报平台 | 12个政务平台链接 |
| 档案库 | 企业环境档案 |
| 知识库 | 法规/标准/案例 |

设置、MCP 连接器、通讯中心已迁移至底部头像菜单。

## AI 系统提示词核心规则

1. **SOUL 不可修改** — 系统内置，用户无法变更
2. **强制核验** — 所有报告/数据提交前必须对照法规逐条核验
3. **委婉拒绝** — 数据不合规时说明理由+法律依据+修正建议
4. **简洁输出** — 先结论后依据，6段以内，不寒暄不啰嗦
5. **精准引用** — 法规给条款编号，标准给编号和具体指标

## 授权管理

```bash
python3 desktop/server/license_manager.py fingerprint   # 企业生成指纹
python3 desktop/server/license_manager.py issue -f <指纹> -c <客户> -d 365  # 签发
python3 desktop/server/license_manager.py verify        # 验证
```

## API 端点

| 端点 | 用途 |
|------|------|
| `/api/chat/health` | 健康检查 |
| `/api/chat/stream` | SSE 流式对话 |
| `/api/license/status` | 授权状态（含指纹） |
| `/api/mcp-servers` | MCP 服务列表 |
| `/api/enterprise` | 企业信息 |
| `/api/feedback` | 用户反馈 |
| `/api/files/download` | 档案下载 |
| `/api/models/available` | 可用模型列表 |
| `/api/auth/token` | 认证 Token（仅 localhost） |
| `/api/agents` | Agent 列表 |
| `/api/user` | 用户信息 |

## AI 模型配置

EcoPilot 后端支持两种模式连接大模型：

### 1. 直连官方 API（推荐，生产环境）

```bash
# ~/.ecopilot-home/.env 配置示例
DEEPSEEK_API_KEY=sk-your-deepseek-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
KIMI_API_KEY=sk-your-moonshot-key
KIMI_BASE_URL=https://api.moonshot.cn/v1
ECOPILOT_TEXT_MODEL=deepseek-chat
ECOPILOT_VISION_MODEL=moonshot-v1-32k-vision-preview
```

### 2. OmniRoute 网关（开发/测试）

```bash
DEEPSEEK_API_KEY=omniroute
DEEPSEEK_BASE_URL=http://localhost:20128/v1
KIMI_API_KEY=omniroute
KIMI_BASE_URL=http://localhost:20128/v1
ECOPILOT_TEXT_MODEL=oc/deepseek-v4-flash-free
ECOPILOT_VISION_MODEL=oc/qwen3.6-plus-free
```

模型名通过环境变量 `ECOPILOT_TEXT_MODEL` / `ECOPILOT_VISION_MODEL` 覆盖。

### EcoSkills 技能注册广场

行业技能包从 EcoSkills 广场远程安装（域名备案中，暂用 IP）：

```bash
# 默认注册中心（可用环境变量覆盖，域名备案完成后切换）
ECOSKILL_REGISTRY_URL=http://111.230.89.107
```

- `POST /api/ecoskill/auto-install` — 按 `industry_code`/`industry_name` 匹配远程目录（tRPC `skills.list`/`skills.detail`），自动安装 Top3 行业技能到 `~/.hermes/skills/`
- 远程不可达时自动回退本地 `server/ecoskill/skills.json` 目录
- 已安装技能在对话系统提示词中按行业关键词自动注入（`_load_industry_skill`）

### PDF 档案分析

PDF 文件通过 Moonshot file-extract 模式处理：
1. 上传 PDF 到 Moonshot Files API
2. 调用 `files.retrieve_content` 提取文本
3. 交由 DeepSeek 生成结构化 Markdown 摘要
4. 摘要自动同步到知识库 `vault-extracts/` 目录

## 测试体系

```bash
# 前端测试（599 个测试）
cd desktop/frontend && pnpm test

# 后端测试（215 个测试）
cd desktop/server && pytest

# CI/CD 自动运行（每次 PR）
# .github/workflows/ci.yml: tsc + oxlint + vitest + pytest
```

## Claude 运维

通过 chrome-devtools MCP 远程运维：读反馈 → 监控 → 修复 → push → 企业 git pull → 重启

## 交付

```bash
git clone <仓库> && cd desktop/electron-app && ./run.sh --dev
# 企业自备 API Key + 机器绑定授权码
```
