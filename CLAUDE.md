# EcoPilot — 企业生态环境合规AI管家

## 项目概述

EcoPilot 是一个 Web 端 AI 合规助手，面向工业企业（钢铁、水泥、火电等），帮助企业完成排污许可证管理、执行报告、台账记录、监测数据核验等生态环境合规工作。

## 技术栈

| 层 | 技术 | 端口 |
|---|------|------|
| 前端 | Next.js 16 + React 19 + Tailwind CSS 4 | 3000 |
| 后端 | Python 3.11 + FastAPI | 8002 |
| AI文本 | DeepSeek V4 (deepseek-v4-flash) | API |
| AI视觉 | Kimi/Moonshot (moonshot-v1-32k-vision-preview) | API |
| 浏览器自动化 | Playwright | 内置 |
| 运维 | chrome-devtools MCP + safari MCP | 远程 |

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
      left-sidebar.tsx   # 左侧导航（9个模块 + 会话列表）
      chat-main.tsx      # 对话 + 仪表盘 + 视图路由
      chat-input.tsx     # 消息输入 + 模型选择器 + 语音输入 + 附件
      chat-message.tsx   # 消息气泡（ReactMarkdown + remark-gfm）
      right-panel.tsx    # 右栏（AI管家 Header + 4层 Session Frame）
      setting-modal.tsx   # 设置弹窗（通用/外观/关于）
      feedback-modal.tsx # 意见反馈弹窗
      views/
        inspection.tsx   # 督察整改（立行立改/跟踪督办/工程建设）
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
    chat_api.py          # FastAPI 主服务（含系统提示词）
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

## 导航模块（8个）

| 模块 | 说明 |
|------|------|
| 新建对话 | AI 合规咨询 |
| 督察整改 | 合规巡查清单 + 付费升级提示 |
| 日历 | 合规日程管理 |
| 政务 | 12个政务平台链接 |
| 档案库 | 企业环境档案 |
| 知识库 | 法规/标准/案例 |
| MCP 连接器 | AI模型+后端+MCP客户端+工具列表 |
| 设置 | 企业信息 + 模型配置 |

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
| `/api/license/status` | 授权状态 |
| `/api/license/fingerprint` | 机器指纹 |
| `/api/enterprise` | 企业信息 |
| `/api/feedback` | 用户反馈 |
| `/api/files/download` | 档案下载 |

## Claude 运维

通过 chrome-devtools MCP 远程运维：读反馈 → 监控 → 修复 → push → 企业 git pull → 重启

## 交付

```bash
git clone <仓库> && cd desktop/electron-app && ./run.sh --dev
# 企业自备 API Key + 机器绑定授权码
```
