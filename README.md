# EcoPilot — 企业生态环境合规 AI 管家

EcoPilot 是一款面向工业企业（钢铁、水泥、火电等）的 Web 端 AI 合规助手，帮助企业完成排污许可证管理、执行报告、台账记录、监测数据核验等生态环境合规工作，集成 DeepSeek 文本模型与 Kimi 视觉模型，开箱即用。

## 快速开始

```bash
# 1. 克隆仓库
git clone <仓库地址> && cd ecopilot

# 2. 配置环境变量（首次需要）
cp desktop/server/.env.example ~/.ecopilot-home/.env
# 编辑 ~/.ecopilot-home/.env 填入真实 API Key 和许可平台账号
cp desktop/frontend/.env.example desktop/frontend/.env.local

# 3. 一键启动
cd desktop/electron-app && ./run.sh --dev
```

启动后会自动创建 Python venv、安装依赖、拉起后端（8002）与前端（3000），并打开浏览器。

## 环境要求

| 依赖 | 版本 |
|------|------|
| Node.js | 18+ |
| Python | 3.11+ |
| 操作系统 | macOS / Windows / Linux |
| 浏览器 | Chromium（首次启动自动安装） |

## 目录结构

```
ecopilot/
├── desktop/
│   ├── electron-app/       # 一键启动器
│   │   ├── main.js         # 跨平台启动脚本
│   │   └── run.sh
│   ├── frontend/           # Next.js 16 前端
│   │   ├── app/            # 页面路由 + 设计系统（globals.css）
│   │   ├── components/     # UI 组件
│   │   │   ├── chat-input.tsx    # 输入框（模型选择器+语音+附件）
│   │   │   ├── right-panel.tsx   # 右栏（AI管家+4层Session Frame）
│   │   │   ├── setting-modal.tsx # 设置弹窗（通用/外观/关于）
│   │   │   └── views/            # 9大模块视图
│   │   │       ├── inspection.tsx  # 督察整改（三类型工单）
│   │   │       ├── calendar.tsx   # 合规日历（月历+时间轴）
│   │   │       ├── tasks.tsx      # 自动任务
│   │   │       ├── experts.tsx    # 专家Agent
│   │   │       ├── doc-editor.tsx # 文档编辑器
│   │   │       └── ...
│   │   └── lib/            # API 客户端 / 状态管理 / 监控
│   └── server/             # Python FastAPI 后端
│       ├── chat_api.py     # 主服务（SSE 流式对话）
│       ├── permit_scraper.py  # 排污许可 Playwright 爬虫
│       ├── license_manager.py # 机器绑定授权
│       ├── requirements.txt   # Python 依赖
│       └── .env.example       # 环境变量示例
├── CLAUDE.md               # AI 项目规则
├── PROJECT_SPECIFICATION.md # 产品说明书
└── README.md
```

## 首次使用流程

EcoPilot 采用机器绑定授权，首次部署需完成以下步骤：

```bash
# 1. 生成企业机器指纹
python3 desktop/server/license_manager.py fingerprint

# 2. 将指纹发送给授权方，获取 .lic 授权文件后签发
python3 desktop/server/license_manager.py issue -f <指纹> -c <客户名> -d 365

# 3. 验证授权状态
python3 desktop/server/license_manager.py verify

# 4. 启动应用
cd desktop/electron-app && ./run.sh --dev
```

授权文件放置于 `~/.ecopilot-home/license.lic`，启动时自动校验。

## 常见问题

**Q1：启动时端口 8002 / 3000 被占用？**
脚本会自动清理端口。如仍失败，手动执行：`lsof -ti :8002 | xargs kill -9`。

**Q2：Playwright Chromium 安装失败？**
手动执行：`cd desktop/server && .venv/bin/python -m playwright install chromium`，或设置镜像 `PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright`。

**Q3：后端启动报 ModuleNotFoundError？**
检查 `.venv` 是否已安装依赖：`cd desktop/server && .venv/bin/pip install -r requirements.txt`。

**Q4：AI 对话返回 401 鉴权失败？**
检查 `~/.ecopilot-home/.env` 中的 `DEEPSEEK_API_KEY` 和 `KIMI_API_KEY` 是否正确，余额是否充足。

**Q5：许可证验证失败 / 授权过期？**
重新生成指纹并申请新授权：`python3 desktop/server/license_manager.py fingerprint`。

## 技术支持

- 提交 Issue：通过项目仓库的 Issue 反馈问题
- 邮件支持：联系项目维护方
- 企业部署咨询：通过 `desktop/server/feedback_reader.py` 提交反馈
