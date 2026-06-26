# EcoPilot 项目说明书 v2.0

> 企业生态环境合规全生命周期管家 — 桌面端
> 基于 Hermes Agent + Electron + React
> 最后更新: 2026-06-26

---

## 一、项目定位

**一句话**：为持有排污许可证的企业提供生态环境合规全生命周期管理的 AI 桌面端。

**目标用户**：企业环保管理人员（环保专员、厂长、第三方咨询机构）

**核心价值**：
- 从"发现问题"开始，不是从"想问题"开始
- 每次任务完成自动沉淀记忆、日记、资产
- 越用越聪明（持续学习引擎）

---

## 二、技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 桌面容器 | Electron | 40.10.2 |
| 前端框架 | React | 19.2.5 |
| 构建工具 | Vite | 8.1.0 |
| 语言 | TypeScript | 6.0.3 |
| 状态管理 | nanostores | 1.3.0 |
| 样式 | Tailwind CSS 4 + 自定义 CSS 变量 | - |
| AI 引擎 | Hermes Agent（本地源码） | v0.17.0 |
| 后端通信 | WebSocket JSON-RPC + REST | - |
| 本地运行环境 | Python 3.12.8（项目内 .venv） | - |
| 数据目录 | `ecopilot/.hermes-data/`（项目隔离） | - |

---

## 三、项目目录结构

```
ecopilot/
├── hermes-agent/               ← Hermes 引擎源码（GitHub 克隆）
│   ├── tui_gateway/            ← JSON-RPC 服务器
│   ├── hermes_cli/             ← CLI + Web 服务器
│   └── apps/shared/            ← @hermes/shared（TypeScript 共享库）
├── desktop/                    ← 桌面端主开发目录
│   ├── electron/               ← Electron 主进程（59 个文件）
│   │   ├── main.cjs           ← 主进程入口（268KB，含启动/更新/窗口管理）
│   │   ├── preload.cjs         ← 预加载脚本
│   │   ├── bootstrap-*.cjs     ← 平台引导
│   │   ├── backend-*.cjs       ← 后端管理
│   │   └── *.test.cjs          ← 单元测试
│   ├── src/                    ← 前端源码
│   │   ├── app/ecopilot/       ← EcoPilot 业务模块（核心）
│   │   ├── app/chat/           ← 对话页面（Hermes 原生）
│   │   ├── components/         ← 共享组件
│   │   ├── store/              ← 全局状态
│   │   ├── lib/                ← 工具库
│   │   ├── i18n/               ← 国际化（en/ja/zh/zh-hant）
│   │   ├── themes/             ← 主题系统
│   │   ├── hooks/              ← 通用 Hooks
│   │   ├── types/              ← TypeScript 类型
│   │   ├── hermes.ts           ← Hermes Gateway 封装
│   │   ├── hermes-client.ts    ← Hermes Dashboard 客户端
│   │   ├── EcoPilotShell.tsx   ← EcoPilot 主页面壳（1476 行）
│   │   ├── MainLayout.tsx      ← 替代布局（613 行）
│   │   ├── styles.css          ← 全局样式（867 行）
│   │   └── ecopilot-entry.tsx  ← 桌面端渲染入口
│   └── package.json
├── .venv/                      ← 项目隔离的 Python 虚拟环境
├── .hermes-data/               ← 项目隔离的 Hermes 数据目录
│   ├── config.yaml
│   ├── .env
│   ├── SOUL.md                ← EcoPilot 身份定义
│   ├── sessions/               ← 会话数据
│   ├── memories/               ← 记忆数据
│   └── skills/                 ← 技能数据
├── DEVELOPMENT_PLAN.md          ← 原始开发方案
├── SUPPLEMENTAL_PLAN.md         ← 补充开发方案
└── start.sh                     ← 一键启动脚本
```

---

## 四、导航与模块清单

### 4.1 左侧导航栏（52px 宽）

| 图标 | 名称 | ID | 当前状态 |
|------|------|----|---------|
| 📊 | 仪表盘 | dashboard | ✅ 基本完成 |
| 💬 | 对话 | chat | ✅ 已对接后端 |
| 🧠 | 专家 | expert | ⚠️ 骨架 |
| 🗓️ | 日历 | calendar | ⚠️ 骨架 |
| 🔗 | 政务 | links | ✅ UI 完成 |
| 📁 | 档案库 | vault | ⚠️ 骨架 |
| 📚 | 知识库 | kb | ✅ UI 完成 |
| 🔌 | 连接器 | connector | ✅ UI 完成 |
| ⚙️ | 设置 | settings | ✅ UI 完成 |

### 4.2 模块完成度详情

#### ✅ 已完成（有完整 UI + 逻辑 + 数据流）

| 模块 | 关键文件 | 行数 | 说明 |
|------|---------|------|------|
| 引导流程 8 步 | `onboarding/` × 8 | 908 | 品牌→上传许可证→OCR确认→平台登录→巡检→报告→档案→注册 |
| 引导状态机 | `store/onboarding.ts` | 197 | OnboardingState + AuditResult + 完整 action |
| 许可证合规状态 | `store/permit.ts` | 169 | ComplianceStatus + EmissionAlert + 冷钢演示数据 |
| 巡检定时任务 | `store/patrol.ts` | 129 | 4 个 Cron 任务（日/周/月/每日预警） |
| 许可证 OCR 解析 | `lib/permit-parser.ts` | 162 | PermitInfo 类型 + 正则解析 + 到期计算 |
| 政务平台配置 | `lib/platform-urls.ts` | 131 | 7 个核心平台 + 排污许可登录 RPA 细节 |
| Obsidian 同步 | `lib/vault-sync.ts` | 274 | 企业主页模板 + YAML frontmatter |
| 许可证卡片 | `components/permit-card.tsx` | 76 | 卡片 + 倒计时 + 排放标准速览 |
| 合规徽章 | `components/compliance-badge.tsx` | 34 | 5 种状态配色 |
| 倒计时组件 | `components/countdown-timer.tsx` | 44 | 3 种到期状态 |
| Hermes 客户端 | `hermes-client.ts` | 259 | WebSocket JSON-RPC + REST + 流事件 |
| 全局样式 | `styles.css` | 867 | 双主题变量 + 全组件样式 |

#### ⚠️ 基本完成（UI 完整但缺后端对接）

| 模块 | 问题 |
|------|------|
| EcoPilotShell 页面壳（1476 行） | 所有数据用 `loadDemoCompliance()` 模拟 |
| 仪表盘（dashboard/index.tsx, 336 行） | KPI指标/排放概览/待办事项 UI 完整，演示数据 |
| EcoPilot 入口（app/ecopilot/index.tsx） | 引导判断逻辑双分支返回相同内容 |

#### ❌ 骨架/占位（15 行 "开发中"）

| 模块 | 文件 | 需要实现的功能 |
|------|------|--------------|
| 专家面板 | `experts/index.tsx` | 智能体卡片列表 + 专家圆桌会议 + 创建/雇佣 |
| 合规日历 | `calendar/index.tsx` | 月历视图 + 事件标记（到期/截止/巡检） |
| 档案库 | `doc-vault/index.tsx` | 文件上传/分类/完整性仪表盘 |
| 平台账号管理 | `settings/platform-accounts.tsx` | 7 个平台凭据管理 + 加密存储 |

---

## 五、核心数据模型

### 5.1 OnboardingState（引导流程）

```typescript
interface OnboardingState {
  step: OnboardingStep   // 'brand' | 'permit-upload' | 'permit-confirm' | 'platform-login' | 'platform-audit' | 'audit-result' | 'doc-collection' | 'register'
  permitFile: File | null
  permitInfo: PermitInfo | null
  platformUsername: string
  platformPassword: string
  captchaImage: string | null
  captchaCode: string
  auditResult: AuditResult | null
  docChecklist: DocChecklistItem[]
  phoneNumber: string
  userName: string
  userRole: '环保专员' | '厂长' | '第三方咨询' | ''
  completed: boolean
}
```

### 5.2 ComplianceStatus（合规状态）

```typescript
interface ComplianceStatus {
  permit: PermitInfo | null
  lastAuditTime: string | null
  pendingCount: number
  urgentCount: number
  docCompleteness: number     // 百分比
  learnedSkillsCount: number  // 已学技能
  memoryCount: number         // 已沉淀记忆
  emissionAlerts: EmissionAlert[]
}
```

### 5.3 PermitInfo（排污许可证）

```typescript
interface PermitInfo {
  enterpriseName: string
  creditCode: string
  permitNumber: string
  issuingAuthority: string
  issueDate: string
  validFrom: string
  validTo: string
  industryCategory: string
  industryCode: string
  managementLevel: '重点管理' | '简化管理' | '登记管理' | '未知'
  address: string
  legalRepresentative: string
  emissionOutlets: EmissionOutlet[]    // 排放口列表（含限值）
  managementRequirements: ManagementRequirement[]  // 管理要求清单
}
```

### 5.4 PatrolJob（巡检任务）

```typescript
interface PatrolJob {
  id: string
  name: string
  description: string
  schedule: string        // Cron 表达式
  scheduleLabel: string
  enabled: boolean
  lastRun?: string
  lastResult?: string
  notifyChannels: ('feishu' | 'desktop' | 'wechat')[]
  type: 'emission' | 'audit' | 'archive' | 'custom'
}
```

**预设 4 个任务：**
- 每日排放监测检查（每天 09:00）
- 每周合规平台巡检（每周一 09:00）
- 每月档案过期检查（每月 1 日 09:00）
- 许可证到期预警（每天 08:00）

### 5.5 GovernmentPlatform（政务平台）

```typescript
interface GovernmentPlatform {
  name: string
  loginUrl: string
  homeUrl: string
  icon: string
  category: 'permit' | 'monitoring' | 'carbon' | 'solid-waste' | 'eia' | 'enforcement' | 'disclosure' | 'other'
  govmcpReady: boolean
  loginMethod: 'account' | 'ukey' | 'ca' | 'sms'
}
```

**7 个核心平台：**
1. 全国排污许可证管理信息平台
2. 全国污染源监测信息管理与共享平台
3. 全国碳排放权交易市场
4. 全国固体废物管理信息系统
5. 环境影响评价信用平台
6. 全国环境信息公开平台
7. 生态环境部行政处罚案件办理系统

### 5.6 智能体 Manifest（自定义专家）

```json
{
  "id": "custom-carbon-analyst",
  "name": "碳排放分析师",
  "description": "负责企业碳排放核算与碳资产管理",
  "avatar": "avatar-3",
  "model": "deepseek-chat",
  "createdAt": "2026-06-26T10:00:00Z",
  "useCount": 0,
  "manifest": {
    "manifestVersion": "1.0",
    "system_prompt": "你是碳排放分析师，擅长...",
    "annotations": { "agent-title": "碳排放管理" },
    "plugins": [],
    "mcp": [],
    "memory": { "enable": true }
  }
}
```

---

## 六、用户流程

### 6.1 首次使用流程（Onboarding）

```
启动 App
  → 品牌动画（4 阶段，15 秒自动跳过）
  → 上传排污许可证（拖拽 PDF/图片）
  → AI OCR 解析确认（显示企业信息/排放标准/管理要求）
  → 登录排污许可平台（账号密码 + 验证码）
  → AI 自动巡检（5 步动画：连接→执行报告→监测→违规→生成报告）
  → 巡检报告展示（许可证状态/执行报告/监测/违规记录/建议）
  → 完善企业档案（按管理要求分类的档案清单）
  → 注册账号（手机号 + 姓名 + 角色）
  → 进入仪表盘
```

### 6.2 日常使用流程

```
进入仪表盘
  ├── 查看待处理事项（排放告警 / 许可证到期 / 报告截止）
  ├── 排放概览（各因子达标状态）
  ├── 知识积累统计
  └── 快捷操作（咨询专家 / 新建任务 / 召集会议 / 档案库）
      ↓
进入对话
  ├── 欢迎页（快捷提问卡片）
  ├── 消息气泡（用户/AI/工具调用）
  ├── 浮窗专家栏（对话底部快速注入专家能力）
  └── 右侧面板（记忆/日记/资产）
      ↓
AI 完成任务
  → 自动写记忆（MEMORY.md）
  → 自动记日记（日历归档）
  → 自动存资产（报告/法规/图表/碳数据）
  → 持续学习（提炼业务模式 → 生成 Skill）
```

### 6.3 智能体创建流程

```
双路径：

路径一：对话创建
  [+ 创建智能体] →
  导航回对话 →
  输入框预填指令 →
  AI 对话引导 →
  自动生成 manifest

路径二：3 步弹窗
  第 1 步：名称 + 角色 + 描述
  第 2 步：模型 + 雇佣专家插件
  第 3 步：确认创建
```

---

## 七、专家体系

### 7.1 预置 7 位专家

| ID | 名称 | 角色 | 在线 |
|----|------|------|:----:|
| ecomind | 综合管家 | 全链条统筹协调 | ✅ |
| permit | 排污许可专家 | 许可证申领/变更/延续 | ✅ |
| carbon | 碳排放专家 | 碳核算/配额/碳市场 | ✅ |
| env-monitoring | 环境监测专家 | CEMS/自行监测/数据解读 | ✅ |
| compliance | 合规巡检专家 | 台账管理/自查自纠 | ✅ |
| emergency | 应急专家 | 应急预案/隐患排查 | ✅ |
| cleaner | 清洁生产专家 | 清洁生产/绿色工厂 | ❌ |

### 7.2 核心机制

- **助手（Hermes）是主代理**，专家是技能插件（WorkBuddy 模式）
- 专家**不替换**当前对话的 AI，而是作为能力注入 system prompt
- 专家可通过**浮窗专家栏**在对话中快速召唤
- **专家圆桌会议**：一键召集多位专家并行分析，助手汇总（原创功能）

---

## 八、SaaS 订阅与智能体定价

### 8.1 四层定价

| 套餐 | 月费 | 对话次数 | 专家席位 | 自定义智能体 | 政务平台 | 记忆/日记/资产 |
|------|:----:|:--------:|:--------:|:-----------:|:--------:|:-------------:|
| **免费版** | ¥0 | 50次 | 1（仅助手） | 0 | 浏览器 | ❌ |
| **基础版** | ¥99 | 500次 | 3 | 1 | 7 个 | ✅ 基础 |
| **专业版** | ¥299 | 2000次 | 7 | 3 | 20 个 | ✅ 完整 |
| **企业版** | ¥999 | 不限 | 7+自定义 | 10 | 全部+API | ✅ 完整+导出 |

### 8.2 智能体席位限制

| 能力 | 免费版 | 基础版 | 专业版 | 企业版 |
|------|:------:|:------:|:------:|:------:|
| 预置专家 | 仅助手 | 助手+2 | 全部 7 位 | 全部 7 位 |
| 自定义智能体 | 0 | 1 | 3 | 10 |
| 智能体创建 | - | 弹窗 | 弹窗+对话 | 弹窗+对话 |
| 专家插件市场 | ❌ | ❌ | ✅ | ✅ |
| 团队共享 | ❌ | ❌ | ❌ | ✅ |
| API 访问 | ❌ | ❌ | ❌ | ✅ |

---

## 九、数据存储与隔离

| 数据 | 路径 | 说明 |
|------|------|------|
| Python venv | `ecopilot/.venv/` | 项目隔离的 Hermes 运行时 |
| Hermes 配置 | `ecopilot/.hermes-data/config.yaml` | 模型/提供商配置 |
| API Keys | `ecopilot/.hermes-data/.env` | 加密存储 |
| 会话数据 | `ecopilot/.hermes-data/sessions/` | SQLite |
| 记忆 | `ecopilot/.hermes-data/memories/` | Markdown |
| 技能 | `ecopilot/.hermes-data/skills/` | Hermes Skill 格式 |
| AI 身份 | `ecopilot/.hermes-data/SOUL.md` | EcoPilot 身份定义 |

---

## 十、开发环境与运行

### 10.1 启动方式

```bash
# 方式一：Vite 开发服务器（浏览器查看前端）
cd ecopilot/desktop && npx vite --host 127.0.0.1 --port 5174

# 方式二：启动 Hermes Dashboard 后端
HERMES_HOME=/c/Users/Administrator/ecopilot/.hermes-data \
  /c/Users/Administrator/ecopilot/.venv/Scripts/hermes dashboard --port 9119 --no-open
```

### 10.2 当前运行状态（2026-06-26）

| 服务 | 端口 | 状态 |
|------|:----:|:----:|
| Vite 前端开发服务器 | 5174 | ✅ 运行中 |
| Hermes Dashboard API | 9119 | ✅ 运行中 |
| 项目 Hermes 源码 | - | ✅ 已安装 |
| 项目隔离数据 | - | ✅ 已配置 |

### 10.3 AI 模型配置

- 提供商: DeepSeek
- 模型: deepseek-v4-pro
- API Key: 已配置 `DEEPSEEK_API_KEY`
- 上下文: 1,000,000 tokens
- 支持工具调用

---

## 十一、架构待改进项

1. **EcoPilotShell.tsx 过大**（1476 行）— 应将页面抽离到独立路由文件
2. **两套布局并存** — EcoPilotShell.tsx 和 MainLayout.tsx 功能重叠
3. **EcoPilot 子路由未接入** — `routes.ts` 定义了 `/dashboard`、`/experts` 等但未被使用
4. **引导入口未串通** — `app/ecopilot/index.tsx` 的 `$onboarding.completed` 判断未真正区分分支
5. **SOUL.md 仍需确认** — 启动时是否保持 EcoPilot 身份而非回退到 Hermes

---

## 十二、关键设计决策

| # | 问题 | 决策 |
|---|------|------|
| 1 | 专家和 AI 的关系 | 助手(主代理) + 专家(技能插件)，不切换角色 |
| 2 | 智能体创建方式 | 对话引导 + 3 步弹窗双路径 |
| 3 | 对话次数定义 | 用户每次发送 = 1 次对话 |
| 4 | 免费版策略 | 限制数量不限制功能，用户体验完整价值 |
| 5 | 数据隔离 | 项目内 .venv + .hermes-data，与本地 Hermes 隔离 |
| 6 | Hermes 接入方式 | WebSocket JSON-RPC 直连 Dashboard（port 9119） |

---

## 十三、开发优先级

| 优先级 | 模块 | 工时 |
|--------|------|:----:|
| **P0** | 修复引导入口 + 数据传递 | 1.5 天 |
| **P0** | 4 个占位页面补齐 | 5-7 天 |
| **P1** | 对话深度完善（语音/附件/渲染） | 2 天 |
| **P1** | 右侧面板真实化 | 3 天 |
| **P2** | 订阅系统 UI + 计量 | 3 天 |
| **P2** | 智能体创建系统 | 4 天 |
| **P2** | 浮窗专家栏 | 2 天 |
| **P3** | 专家圆桌会议 | 3 天 |
| **P3** | 智能体市场 | 5 天 |
| **P4** | 企业版（多用户/API/审计） | 5 天 |

---

## 十四、相关文档索引

- [开发方案](DEVELOPMENT_PLAN.md) — 原始完整开发方案（QClaw/WorkBuddy 参考）
- [补充方案](SUPPLEMENTAL_PLAN.md) — 基于代码盘点的补充计划 + SaaS 设计
- [前端设计](desktop/DESIGN.md) — 组件设计规范（按钮/表单/布局/图标）
- [代码状态记忆](/c/Users/Administrator/.claude/projects/c--Users-Administrator-ecopilot/memory/ecopilot-codebase-status.md)
