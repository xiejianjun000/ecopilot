# EcoPilot 桌面端完整开发方案 v2.0

> 基于 Hermes Agent + Electron + React + govmcp 的生态环境合规管家桌面端
> 2026-06-24 · 含 QClaw + WorkBuddy 记忆/日记/资产机制

---

## 一、整体架构

```
┌──────────────────────────────────────────────────────────┐
│                   EcoPilot Desktop                       │
│                   (Electron + React)                     │
├─────────┬──────────┬──────────────┬──────────────────────┤
│ 导航栏   │ 会话列表  │ 对话主区域    │ 右侧面板（三合一）    │
│ (48px)  │ (240px)  │ (聊天+工具)   │ [记忆] [日记] [资产] │
├─────────┴──────────┴──────────────┴──────────────────────┤
│                    系统托盘 / 通知                        │
├──────────────────────────────────────────────────────────┤
│                 API 层 (Hermes Gateway)                   │
├──────────────────┬───────────────────────────────────────┤
│ govmcp 信创底座   │ 标准 MCP 兼容层（飞书/GitHub/...）    │
└──────────────────┴───────────────────────────────────────┘
```

---

## 二、核心创新：记忆-日记-资产三联动

**这是从 QClaw + WorkBuddy 深度研究后提炼的核心差异化能力。**

### 2.1 工作机制

```
每次任务完成 → 自动触发 → Hermes 后端做三件事并行：

┌─ ① 记忆更新 ─────────────────────────────────┐
│  AI 自主分析本次对话的关键发现、用户偏好、        │
│  企业信息，写入 ~/ecopilot/memory/ 目录          │
│  格式：Markdown + YAML frontmatter              │
│  参考：QClaw 的 MEMORY.md + WorkBuddy 云端记忆  │
└────────────────────────────────────────────────┘

┌─ ② 日记记录 ─────────────────────────────────┐
│  AI 按时间线生成工作日志，含：                  │
│  - 处理了什么问题                               │
│  - 用了什么工具/专家                            │
│  - 结论/建议                                    │
│  - 下一项待办                                   │
│  格式：Markdown, 按日期归档, 日历 UI 展示       │
│  参考：QClaw 的日记日历 + 时间线 UI            │
└────────────────────────────────────────────────┘

┌─ ③ 资产沉淀 ─────────────────────────────────┐
│  本次任务产出物结构化存储：                      │
│  - 报告/分析文档 → assets/reports/             │
│  - 法规检索结果 → assets/regulations/          │
│  - 监测数据图表 → assets/charts/              │
│  - 碳核算数据   → assets/carbon/              │
│  格式：JSON 索引 + 原始文件                     │
│  参考：WorkBuddy 的 artifact-index + MediaArtifact│
└────────────────────────────────────────────────┘

┌─ ④ 持续学习 ─────────────────────────────────┐
│  每次会话结束后自动评估，提炼可复用模式：         │
│  - 错误解决方案（某类超标怎么处理）              │
│  - 用户偏好修正（企业习惯的格式/口径）           │
│  - 工作流优化（某类问题的最佳处理路径）           │
│  - 业务规则发现（许可证延续的本地要求）           │
│  产出：自动生成 Hermes Skill                    │
│  参考：ECC continuous-learning + Hermes skill   │
└────────────────────────────────────────────────┘
```

### 2.2 右侧面板三标签切换

```
┌─────────────────────────────┐
│  [记忆]  [日记]  [资产]     │ ← tab 切换
├─────────────────────────────┤
│                             │
│ 记忆标签:                   │
│  ├ 当前会话记忆             │
│  ├ 企业信息摘要             │
│  ├ 用户偏好                 │
│  └ 关键决策记录              │
│                             │
│ 日记标签:                   │
│  ├ 日历视图 (月/周/日)      │
│  ├ 时间线                   │
│  ├ 今日工作摘要             │
│  └ 搜索日记                 │
│                             │
│ 资产标签:                   │
│  ├ 按类型分组               │
│  │  ├ 报告文档              │
│  │  ├ 法规资料              │
│  │  ├ 监测数据              │
│  │  └ 碳核算数据            │
│  └ 最近更新排序             │
│                             │
└─────────────────────────────┘
```

### 2.3 对比 QClaw/WorkBuddy

| 能力 | QClaw | WorkBuddy | 我们要做的 |
|------|-------|-----------|-----------|
| **记忆写入方** | AI 自主写 Markdown | 服务端异步生成 | **两者结合**：AI 自主写 + 后端结构化 |
| **日记** | 日历+时间线 UI | 关闭（diaryEnabled:false） | **QClaw 的日记模式** |
| **资产** | 分散的灵感/素材 | 统一 artifact-index JSON | **WorkBuddy 的资产索引** |
| **右侧面板** | Agent详情+记忆日历 | 我的文件+任务产物 | **三合一标签面板** |
| **触发时机** | 每次 task 完成 | plan.json 变更 → 轮询 | **每次任务完成自动触发** |
| **存储** | 本地 Markdown | 本地 SQLite + 云端 | **本地优先 + 可选同步** |

---

## 三、技术栈选型

| 层级 | 技术 | 理由 |
|------|------|------|
| **桌面容器** | Electron 37+ | Hermes 官方在用，源码可参考 |
| **UI 框架** | React 18 + TypeScript | Hermes 桌面端在用 |
| **构建** | Vite | HMR 快，Hermes 在用 |
| **状态管理** | Zustand | 轻量，WorkBuddy 在用 |
| **CSS** | CSS 变量主题系统 | 双主题切换，WorkBuddy/QClaw 都用 |
| **图标** | Lucide React | 全开源 |
| **AI 引擎** | Hermes Agent v0.17.0 | 已更新，底座就位 |
| **Gov 协议** | govmcp + 标准 MCP 兼容层 | 信创合规 + 生态兼容 |
| **记忆存储** | 本地 Markdown + JSON 索引 | 参考 QClaw + WorkBuddy |
| **日记存储** | Markdown 按日期归档 | 参考 QClaw |
| **资产索引** | JSON manifest | 参考 WorkBuddy artifact-index |

---

## 四、分阶段实施计划

### 阶段一：桌面应用骨架（3 天）

**目标**：能跑的 Electron 窗口 + 三栏布局 + 调 Hermes 后端

| 任务 | 内容 | 参考 |
|------|------|------|
| 1.1 | Electron + Vite + React 脚手架 | Hermes `apps/desktop/` |
| 1.2 | 三栏布局（导航/会话/对话/右侧面板） | WorkBuddy 三栏 |
| 1.3 | CSS 变量主题系统（亮/暗） | WorkBuddy `--cb-*` |
| 1.4 | 快捷键系统 | WorkBuddy `commandSubject` |
| 1.5 | 对接 Hermes Gateway（对话+流式） | Hermes 文档 |
| 1.6 | 系统托盘 + 通知 | Electron 原生 |
| 1.7 | 打包脚本（macOS .dmg） | Hermes builder |

### 阶段二：对话核心体验（3 天）

**目标**：完整 AI 对话

| 任务 | 内容 |
|------|------|
| 2.1 | 消息气泡（用户/AI/工具调用） |
| 2.2 | 流式输出 |
| 2.3 | Markdown 渲染（代码/表格/LaTeX） |
| 2.4 | 输入框（多行/快捷键） |
| 2.5 | 会话管理（新建/切换/删除/搜索） |
| 2.6 | 对话上下文压缩 |

### 阶段三：记忆-日记-资产-持续学习四联动（5 天 ⭐ 核心）

**目标**：每次任务完成后自动更新记忆+日记+资产，同时评估可复用的业务模式自动生成技能

| 任务 | 内容 | 参考来源 |
|------|------|---------|
| 3.1 | 记忆引擎：AI 在任务结束时自动写 MEMORY.md | QClaw `memory-core` 插件 |
| 3.2 | 日记引擎：按日历归档的 Markdown 日志 | QClaw 日记日历 UI |
| 3.3 | 资产索引：JSON manifest 管理产出物 | WorkBuddy `artifact-index` |
| 3.4 | 右侧三标签面板（记忆/日记/资产切换） | QClaw 右侧面板设计 |
| 3.5 | 记忆日历视图（按日期浏览日记） | QClaw 日历时间线 |
| 3.6 | 资产列表视图（按类型分组+搜索） | WorkBuddy 产物管理 |
| 3.7 | 触发机制：任务完成后 Hook 自动调用 | QClaw task → memory 流程 |
| 3.8 | **持续学习引擎**：会话结束自动评估→提炼模式→生成 Hermes Skill | **ECC continuous-learning** |

### 持续学习引擎详细设计

```yaml
触发时机: 每次 Hermes 会话结束时
评估条件: 会话长度 > 5 轮对话
提炼范围:
  - 错误解决方案: "NH3-N 超标怎么处理的？" → 生成标准应对流程
  - 用户偏好: "企业习惯的报表格式是？" → 记忆输出风格
  - 工作流优化: "许可证延续的最佳路径是？" → 生成 SOP 技能
  - 业务规则: "当地环保局的特殊要求？" → 更新企业知识库
产出格式: 自动生成 ~/.hermes/skills/ecopilot-learned/<topic>.md
零冲突: 使用 Hermes 原生 `skill_manage(action='create')` 和 `memory` 工具
```

### 对比 ECC/之前的方案

| 维度 | ECC (Claude Code) | 旧方案 | EcoPilot 方案 |
|------|-------------------|--------|---------------|
| 触发 | hooks.json SessionEnd | 自定义后端 Hook | **Hermes 原生 skill_manage** |
| 评估 | evaluate-session.js 脚本 | 无 | **Hermes agent 自主分析** |
| 产出 | 写到 `~/.claude/skills/learned/` | 写到文件 | **Hermes Skill 格式（完全兼容）** |
| 冲突 | 跟 Claude Code 绑定 | 跟 ecomind 后端绑定 | **跟 Hermes 零冲突** |
| 技术 | Node.js 脚本 + 环境变量 | Python 后端 | **Hermes 工具调用** |

### 阶段四：EcoPilot 行业功能（4 天）

| 任务 | 内容 |
|------|------|
| 4.1 | 7 位专家切换 + 状态灯 |
| 4.2 | 排污许可证上传/激活 |
| 4.3 | 任务日历 |
| 4.4 | 内置浏览器 + 政务平台快捷入口 |
| 4.5 | govmcp 审计链可视化 |

### 阶段五：MCP 生态兼容（2 天）

| 任务 | 内容 |
|------|------|
| 5.1 | 标准 MCP HTTP+SSE 传输层 |
| 5.2 | resources 协议补齐 |
| 5.3 | MCP 连接器管理面板 |
| 5.4 | 飞书/GitHub 连接器接入测试 |

### 阶段六：打磨与发布（3 天）

| 任务 | 内容 |
|------|------|
| 6.1 | 动画过渡效果（Lottie 专家切换动效） |
| 6.2 | 错误处理/崩溃恢复/日志 |
| 6.3 | 自动更新 |
| 6.4 | macOS 签名 + 公证 |
| 6.5 | 内测发布 |

---

## 五、设计规范（像素级，来自 QClaw + WorkBuddy）

### 5.1 布局结构

```
┌──────────┬──────────┬────────────────────────┬─────────────────┐
│ 导航栏    │ 会话列表  │  主内容区（对话）       │ 右侧面板         │
│ (52px)   │ (280px)  │  (flex:1)             │ (320-800px)     │
│          │          │                        │ [记忆][日记][资产]│
├──────────┴──────────┴────────────────────────┴─────────────────┤
│                      底部输入条                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 左侧导航栏（参考 QClaw）

```css
/* 导航栏容器 */
.toolbar-nav {
  width: 52px;                     /* QClaw 精确宽度 */
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 0;
  background: #F7F8FA;             /* QClaw --app-bg-primary */
  border-right: 1px solid rgba(255,255,255,0.6);
}

/* 导航按钮 */
.toolbar-nav__item {
  width: 40px;
  padding: 6px 0;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  transition: background-color 0.2s ease;
}
.toolbar-nav__item:hover {
  background: rgba(0,0,0,0.04);    /* QClaw hover */
}
.toolbar-nav__item--active {
  background: rgba(0,0,0,0.05);    /* QClaw active */
}

/* 导航图标 */
.toolbar-nav__icon {
  width: 24px;                     /* QClaw 图标 */
  height: 24px;
  object-fit: contain;
}

/* 导航文字 */
.toolbar-nav__label {
  font-size: 10px;                 /* QClaw 小字 */
  line-height: 12px;
  color: #909090;                  /* QClaw --app-text-tertiary */
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  width: 100%;
}
```

### 5.3 会话列表（综合 QClaw + WorkBuddy）

```css
/* 会话列表容器 */
.session-list {
  width: 280px;                    /* QClaw 展开态 */
  min-width: 248px;                /* WorkBuddy min-width */
  background: #F7F8FA;             /* QClaw */
  display: flex;
  flex-direction: column;
  border-right: 1px solid #E6E6E6; /* WorkBuddy --wb-color-border-primary */
  transition: width 180ms cubic-bezier(0.05, 0.7, 0.1, 1); /* WorkBuddy 动画 */
}

/* 列表头部 */
.session-list__header {
  display: flex;
  align-items: center;
  min-height: 48px;                /* WorkBuddy header slot */
  padding: 0 12px;
}

/* 分组标题 */
.session-list__group-title {
  padding: 8px 20px 4px;
  font-size: 11px;                 /* WorkBuddy */
  font-weight: 600;
  color: rgba(0,0,0,0.5);          /* WorkBuddy section-foreground */
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* 会话列表项 */
.session-list__item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;                /* QClaw */
  padding: 0 16px;                 /* QClaw: 0 8px → 调大一点 */
  border-radius: 6px;              /* QClaw */
  cursor: pointer;
  transition: background 0.2s ease;
  position: relative;
}
.session-list__item:hover {
  background: rgba(0,0,0,0.04);    /* QClaw */
}
.session-list__item--active {
  background: rgba(0,0,0,0.05);    /* QClaw active */
}

/* 会话标题 */
.session-list__item-title {
  font-size: 13px;                 /* WorkBuddy: 13px, QClaw: 14px → 折中 */
  font-weight: 500;                /* QClaw: 500 */
  line-height: 20px;
  color: #1D2129;                  /* QClaw --app-text-primary */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 会话摘要 */
.session-list__item-snippet {
  font-size: 12px;
  line-height: 20px;
  color: #909090;                  /* QClaw tertiary */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 悬停时显示的操作按钮 */
.session-list__item-action {
  opacity: 0;
  transition: opacity 0.2s ease;
}
.session-list__item:hover .session-list__item-action {
  opacity: 1;                      /* WorkBuddy 模式 */
}
```

### 5.4 右侧三标签面板

```css
/* 右侧面板容器 */
.right-panel {
  width: 380px;                    /* 默认 */
  min-width: 320px;                /* 不可小于 */
  max-width: 800px;                /* 不可大于 */
  background: #FFFFFF;
  border-left: 1px solid #E6E6E6;
  display: flex;
  flex-direction: column;
  transition: width 180ms cubic-bezier(0.05, 0.7, 0.1, 1);
}

/* 标签栏 */
.right-panel__tabs {
  display: flex;
  border-bottom: 1px solid #EBEBEB;
  min-height: 36px;
}

.right-panel__tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 0;
  font-size: 12px;
  font-weight: 500;
  color: #6B7280;                  /* cb-text-tertiary */
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.12s ease, border-color 0.12s ease;
}
.right-panel__tab:hover {
  color: #111827;
  background: rgba(0,0,0,0.03);    /* cb-hover-bg light */
}
.right-panel__tab--active {
  color: #059669;                  /* 生态绿 accent */
  border-bottom-color: #059669;
}

/* 标签内容区域 */
.right-panel__content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

/* 滚动条（WorkBuddy 风格） */
.right-panel__content::-webkit-scrollbar { width: 6px; }
.right-panel__content::-webkit-scrollbar-track { background: transparent; }
.right-panel__content::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 3px;
}
.right-panel__content:hover::-webkit-scrollbar-thumb {
  background: rgba(100,100,100,0.4);
}

/* 折叠按钮 */
.right-panel__collapse-btn {
  width: 32px;
  height: 32px;
  border-radius: 999px;            /* WorkBuddy pill 形 */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #6B7280;
  transition: color 0.12s ease, background-color 0.12s ease;
}
.right-panel__collapse-btn:hover {
  background: rgba(17,24,39,0.06);
  color: #111827;
}
```

### 5.5 颜色系统（双主题）

**亮色主题：**
```css
--bg-primary:      #FFFFFF
--bg-secondary:    #F7F8FA             /* QClaw --app-bg-primary */
--bg-elevated:     rgba(239,241,245,0.97)  /* QClaw */
--bg-hover:        rgba(0,0,0,0.04)    /* QClaw */
--bg-active:       rgba(0,0,0,0.05)    /* QClaw */
--text-primary:    #1D2129             /* QClaw */
--text-secondary:  #535353             /* QClaw */
--text-tertiary:   #909090             /* QClaw */
--border-primary:  #E6E6E6            /* WorkBuddy gray-5 */
--border-secondary:#EBEBEB            /* WorkBuddy gray-4 */
--accent:          #059669             /* 生态绿 */
--accent-hover:    #047857
--danger:          #ef4444
--success:         #10b981
--warning:         #f59e0b
```

**暗色主题：**
```css
--bg-primary:      #1A1B1E             /* WorkBuddy dark */
--bg-secondary:    #212234
--bg-elevated:     #252526
--bg-hover:        rgba(255,255,255,0.06)
--bg-active:       rgba(255,255,255,0.08)
--text-primary:    #D2D3E0
--text-secondary:  #858699
--text-tertiary:   #6B7280
--border-primary:  #2A2C31
--border-secondary:#1F2126
--accent:          #34d399
```

### 5.6 字体系统

```css
--font-family:   -apple-system, BlinkMacSystemFont, "PingFang SC",
                 "Microsoft YaHei", "Segoe UI", sans-serif;
--font-mono:     "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, monospace;
--font-size-xs:  10px      /* 导航标签 */
--font-size-sm:  11px      /* 分组标题 */
--font-size:     12px      /* 摘要/辅助 */
--font-size-md:  13px      /* 正文/列表项标题 */
--font-size-lg:  14px      /* 大标题 */
```

### 5.7 动画

```css
--transition-fast:   0.12s ease           /* 颜色变化 */
--transition-normal: 0.2s ease            /* hover */
--transition-panel:  180ms cubic-bezier(0.05, 0.7, 0.1, 1.0)  /* 面板展开/折叠 */
--transition-panel-full: 240ms cubic-bezier(0.4, 0, 0.2, 1)   /* 全屏模式 */
```

## 七、设置页面设计

### 7.1 布局参考（QClaw 设置弹窗）

```
┌──────────────────────────────────────────────┐
│  ⚙️ 设置                    [×] 关闭         │
├──────────┬───────────────────────────────────┤
│          │ 账号设置                           │
│  账号设置  ├─ 头像 [●] 昵称 [军哥]            │
│  模型设置  ├─ 微信绑定 [已绑定]                │
│  通用设置  ├─ 手机号 [138****0000]            │
│  快捷键   │  [退出登录]                       │
│  SaaS    │                                   │
│  关于    │ 模型设置                           │
│          │ ├─ 默认模型 [DeepSeek-Chat ▼]      │
│          │ └─ API 地址 [https://...]          │
│          │                                   │
│          │ 通用设置                           │
│          │ ├─ 语言       [中文 ▼]             │
│          │ ├─ 主题       [系统 ▼]              │
│          │ ├─ 字体大小   [○───●───○]          │
│          │ ├─ 发送键     [Enter ▼]             │
│          │ └─ 简洁模式   [开关]                │
│          │                                   │
│          │ 快捷键                             │
│          │ ├─ 新对话     Cmd+N    [编辑]       │
│          │ ├─ 搜索       Cmd+K    [编辑]       │
│          │ └─ 切换主题   Cmd+T    [编辑]       │
│          │                                   │
│          │ SaaS 订阅                          │
│          │ ├─ 当前套餐：[专业版]               │
│          │ ├─ 用量：[████░░] 60%              │
│          │ ├─ 到期：[2026-12-31]              │
│          │ └─ [升级] [续费]                    │
│          │                                   │
│          │ 关于                               │
│          │ └─ 版本 1.0.0 | 更新日志           │
└──────────┴───────────────────────────────────┘
```

### 7.2 设置 CSS 精确值

```css
/* 设置弹窗（QClaw 风格） */
.settings-modal {
  width: 720px;
  height: 600px;
  display: flex;
  border-radius: 16px;
  overflow: hidden;
}

/* 设置侧边栏 */
.settings-sidebar {
  width: 140px;                    /* QClaw 精确值 */
  padding: 20px 12px;
  background: #F7F8FA;
  border-right: 1px solid #EBEBEB;
}

.settings-sidebar__item {
  padding: 12px 8px;
  height: 44px;
  border-radius: 12px;             /* QClaw 大圆角 */
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background 0.2s ease;
}
.settings-sidebar__item:hover {
  background: rgba(0,0,0,0.04);
}
.settings-sidebar__item--active {
  background: rgba(0,0,0,0.05);
  font-weight: 600;
}

/* 设置内容区 */
.settings-content {
  flex: 1;
  padding: 20px 24px;
  overflow-y: auto;
}

/* 设置分组卡片 */
.settings-card {
  border-radius: 16px;             /* QClaw 大圆角 */
  background: #FFFFFF;
  margin-bottom: 16px;
}

.settings-row {
  padding: 16px 20px;
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.settings-row__label {
  font-size: 14px;
  font-weight: 600;                /* QClaw: 700 → 600 */
}
.settings-row__desc {
  font-size: 12px;
  color: #909090;
  margin-top: 2px;
}

/* WorkBuddy 设置面板风格（备用） */
.settings-panel {
  max-width: 780px;                /* WorkBuddy */
}
.settings-panel__title {
  font-size: 20px;
  font-weight: 650;
  padding: 0 48px 14px 0;
  margin: 0 0 14px 0;
}
.settings-section {
  border-radius: 4px;              /* WorkBuddy 小圆角 */
  padding: 10px 14px;
  margin-bottom: 8px;
}
.settings-section__title {
  font-size: 13px;
  font-weight: 650;
  line-height: 18px;
}
```

### 7.3 EcoPilot 设置分类

| 分类 | 选项 | 说明 |
|------|------|------|
| **账号** | 头像、昵称、企业信息、许可证绑定、退出登录 | 企业环境管家核心 |
| **模型** | 默认模型、API 地址、API Key、备用模型 | 对接 Hermes |
| **通用** | 语言、主题(亮/暗/系统)、字体大小、发送键、简洁模式 | 基础体验 |
| **快捷键** | 新对话/搜索/切换面板/发送/切换主题 | 效率 |
| **政务平台** | 各平台账号绑定、自动登录、session 管理 | **EcoPilot 独有** |
| **SaaS** | 当前套餐、用量、续费、升级、订单历史 | 商业化 |
| **关于** | 版本、更新日志、开源协议 | |

---

## 八、输入框设计

### 8.1 QClaw 输入框精确布局

```
┌─────────────────────────────────────────────────────┐
│ [DeepSeek ▼] [🔗] [📎] [🎤] [📷]                   │
│                                                     │
│  _________________________________________________________________  │
│ | 输入消息...                                       [▶] 发送      │
│  ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾  │
│                                                     │
│ [附件: 报告.pdf] [附件: 数据.xlsx]                   │
│                                    [Alt+Enter换行]   │
└─────────────────────────────────────────────────────┘
```

### 8.2 输入框 CSS 精确值

```css
/* 输入框容器 */
.input-bar {
  border-top: 1px solid #EBEBEB;
  padding: 12px 16px 16px;
  background: #FFFFFF;
}

/* 工具栏（模型选择+附件按钮） */
.input-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
  padding: 0 4px;
}

/* 工具按钮 */
.input-toolbar__btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #6B7280;
  transition: background 0.15s ease, color 0.15s ease;
}
.input-toolbar__btn:hover {
  background: rgba(0,0,0,0.05);
  color: #1D2129;
}

/* 文本输入区域 */
.input-textarea {
  width: 100%;
  min-height: 44px;
  max-height: 200px;
  padding: 10px 12px;
  border: 1px solid #E6E6E6;
  border-radius: 12px;             /* QClaw 圆角 */
  font-size: 14px;
  line-height: 1.5;
  resize: none;
  outline: none;
  transition: border-color 0.15s ease;
}
.input-textarea:focus {
  border-color: #059669;           /* 生态绿 */
}

/* 底部按钮行 */
.input-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  padding: 0 4px;
}

/* 发送按钮 */
.input-send-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;              /* QClaw 圆形 */
  background: #059669;
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease;
  border: none;
}
.input-send-btn:hover {
  background: #047857;
}
.input-send-btn:disabled {
  background: #D1D5DB;
  cursor: not-allowed;
}

/* 模型选择器（输入框最左侧） */
.input-model-selector {
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  color: #6B7280;
  transition: background 0.15s ease;
}
.input-model-selector:hover {
  background: rgba(0,0,0,0.05);
}

/* 附件胶囊（QClaw 风格） */
.attachment-capsule {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  background: #F3F4F6;
  font-size: 12px;
  margin: 4px 4px 0 0;
}
.attachment-capsule__remove {
  cursor: pointer;
  color: #9CA3AF;
}
.attachment-capsule__remove:hover {
  color: #EF4444;
}

/* 语音录制覆盖层 */
.voice-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255,255,255,0.95);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  gap: 16px;
}
```

### 8.3 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Enter` | 发送消息 |
| `Shift+Enter` | 换行 |
| `Cmd+Enter` | 可配置为发送（WorkBuddy 可选） |
| `Cmd+N` | 新会话 |
| `Cmd+K` | 搜索会话 |
| `Cmd+,` | 打开设置 |
| `Esc` | 关闭弹窗/取消 |

---

## 九、SaaS 计费系统设计

### 9.1 QClaw 套餐页面精确 CSS

```css
/* 套餐卡片网格 */
.plans-grid {
  display: grid;
  grid-template-columns: repeat(3, 240px);
  gap: 16px;
}

/* 套餐卡片 */
.plan-card {
  width: 240px;
  height: 324px;
  padding: 20px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.plan-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

/* 免费版 */
.plan-card--free {
  background: linear-gradient(135deg, #f3f3f3, #fff 70%);
}
/* 轻量版 */
.plan-card--lite {
  background: linear-gradient(135deg, #fffcf4, #fff7e6 70%, #ffe9c2);
}
/* 专业版 */
.plan-card--pro {
  background: linear-gradient(135deg, #fff6f4, #ffe9e4 70%, #ffd5cd);
}
/* 旗舰版 */
.plan-card--max {
  background: linear-gradient(135deg, #342e2a, #2b2b2b);
  color: white;
}

/* 价格显示 */
.plan-price {
  font-size: 32px;
  font-weight: 700;
  line-height: 1;
}
.plan-price__symbol {
  font-size: 20px;
  font-weight: 700;
  vertical-align: super;
}
.plan-price__original {
  font-size: 14px;
  text-decoration: line-through;
  color: #9b9b9b;
  margin-left: 8px;
}
.plan-price__discount {
  display: inline-block;
  height: 16px;
  padding: 0 6px;
  border-radius: 43px;
  font-size: 10px;
  line-height: 16px;
  background: #FF4D4F;
  color: white;
  margin-left: 6px;
}

/* 用量统计卡片 */
.usage-card {
  padding: 20px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.usage-card__value {
  font-size: 20px;
  font-weight: 700;
}
.usage-card__label {
  font-size: 14px;
  color: #909090;
}

/* Token 用量进度条 */
.token-progress {
  width: 360px;
  border-radius: 32px;
  padding: 12px 16px;
}
.token-progress__used {
  font-size: 20px;
  font-weight: 700;
}
.token-progress__track {
  height: 6px;
  border-radius: 80px;
  background: #E5E7EB;
}
.token-progress__bar {
  height: 6px;
  border-radius: 80px;
  background: #059669;
  transition: width 0.3s ease;
}
```

### 9.2 EcoPilot SaaS 定价方案

| 套餐 | 价格 | 月对话次数 | 专家数量 | 政务平台 | 记忆/日记/资产 |
|------|:----:|:----------:|:--------:|:--------:|:-------------:|
| **免费版** | ¥0 | 50次/月 | 1位(助手) | 仅内置浏览器 | ❌ |
| **基础版** | ¥99/月 | 500次 | 3位 | 7个可填写 | ✅ 基础版 |
| **专业版** | ¥299/月 | 2000次 | 7位全部 | 20个全部 | ✅ 完整版 |
| **企业版** | ¥999/月 | 不限 | 7位+自定义 | 全部+API | ✅ 完整版+导出 |

### 9.3 余额/用量显示位置

```
┌─ 导航栏底部 ──────────────────┐
│ 📊                           │
│ 剩余 1280 次对话              │
│ [████░░░░] 65%               │
│ [升级专业版 ▸]                │
└──────────────────────────────┘
```

- 导航栏底部显示用量概览
- 点击进入用量详情页
- 用量不足时自动提醒升级
- 免费版用完可等待下月重置或付费

---

## 六、专家体系设计（基于 WorkBuddy 模式 + 原创会议调度）

### 6.1 核心理念

**助手（Hermes）是主代理，专家是技能插件。**

跟 WorkBuddy 一模一样：
- **助手** = 对话中的 AI 本体（Hermes Agent），始终存在
- **专家** = 技能插件，挂在助手下面，需要时召唤
- 专家**不替换**当前对话的 AI，而是作为能力注入

### 6.2 EcoPilot 核心创新：专家圆桌会议

这是 **WorkBuddy 和 QClaw 都没有的功能**——我们需要原创。

#### 为什么需要？

企业的生态环境问题从来不是一个部门的事：
- 一个新建项目 → 需要**环评 + 排污许可 + 碳排放 + 监测**四个专家协同
- 一次环保督察迎检 → 需要**执法 + 合规 + 监测 + 应急**四个专家会诊
- 一次超标排放事故 → 需要**监测(看数据) + 执法(看处罚) + 应急(看处置)**

**单专家问答不够，需要多专家一起"开会"。**

#### WorkBuddy 团队机制的局限性

WorkBuddy 的"专家团"（expertType: "team"）是主理人编排模式：

```
主理人 → 分派任务 → 成员各自执行 → 回收结果 → 汇编输出
          ↑ 串/并行 Phase 工作流
```

这是**自上而下的任务分派**，不是**平级的圆桌讨论**。

我们需要的是：

```
问题：排污许可证快到期了，我们厂该怎么办？

┌─────────────────────────────────────┐
│         助手（Hermes 主持人）         │
├─────────────────────────────────────┤
│                                     │
│  [碳排放专家] → "我这边碳配额还够"    │
│                                     │
│  [排污许可专家] → "许可证到期前60天   │
│   需要提交延续申请，我建议立即启动"    │
│                                     │
│  [环境监测专家] → "补充一个信息：     │
│   最近 NH3-N 有轻微超标，建议先整改   │
│   再申请延续，否则会被重点审核"       │
│                                     │
│  [合规巡检专家] → "我查到上季度有     │
│   一次未批先建的记录，这个会影响延续   │
│   审批，建议先处理这个"               │
│                                     │
│  助手总结：                          │
│  → 立即整改 NH3-N 超标               │
│  → 处理未批先建记录                   │
│  → 60天内提交延续申请                 │
└─────────────────────────────────────┘
```

#### 会议调度的三种模式

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| **一键召集** | 用户说"召集相关部门开个会"→ 自动识别相关专家 → 并行回答 | 紧急问题、多要素综合问题 |
| **手动指定** | 用户在专家面板选2-3个专家 → "让这几位专家一起分析" | 特定组合的问题 |
| **定时例会** | 每周/每月自动召集各专家汇报各自领域的最新情况 | 日常监管、合规巡检 |

#### 会议 UI 设计

```
┌────────────────────────────────────────────────────┐
│  用户: 排污许可证快到期了，我们厂该怎么办？          │
├────────────────────────────────────────────────────┤
│                                                    │
│  📋 助手：正在召集相关专家开会...                    │
│  [自动识别：排污许可 + 碳排放 + 监测 + 合规]        │
│                                                    │
│  ┌──── 排污许可专家 ────┐                         │
│  │ 许可证编号: 9143...001P                         │
│  │ 到期日: 2026-08-15 (剩余52天)                   │
│  │ 建议: 立即启动延续申请流程                       │
│  └──────────────────────┘                         │
│                                                    │
│  ┌──── 碳排放专家 ──────┐                         │
│  │ 当前碳配额: 剩余 12,500 吨                       │
│  │ 按当前排放速率可用至9月，不影响延续               │
│  └──────────────────────┘                         │
│                                                    │
│  ┌──── 环境监测专家 ────┐                         │
│  │ ⚠️ NH3-N 6月均值 15mg/L (标准12mg/L)           │
│  │ 建议：先整改 NH3-N 再申请延续                    │
│  └──────────────────────┘                         │
│                                                    │
│  ┌──── 合规巡检专家 ────┐                         │
│  │ ⚠️ 上季度有一次未批先建记录                     │
│  │ 建议：处理完该记录再提交延续申请                  │
│  └──────────────────────┘                         │
│                                                    │
│  ─── 助手总结 ───                                   │
│  ✅ 立即整改 NH3-N 超标                             │
│  ✅ 处理未批先建记录                                │
│  ✅ 60天内提交延续申请                              │
│  📅 已添加日历提醒: 许可证到期前45天                 │
│                                                    │
└────────────────────────────────────────────────────┘
```

### 6.2 专家在哪里？（WorkBuddy 的 Colleagues 面板）

WorkBuddy 的左侧导航栏**没有单独的"专家"入口**。专家功能集成在 **"同事"面板**里：

```
左侧导航栏:
┌──────┐
│  💬  │  对话（默认）
│  👥  │  同事面板 ← 专家在这里！
│  🔗  │  政务平台
│  🔌  │  连接器
│  ... │
└──────┘

点击"同事"→ 右侧展开同事面板
├─ 已绑定的专家列表（每个专家一张卡片）
├─ [+ 新建专家]
└─ 底部"浏览专家库"按钮 → 打开 ExpertPicker 弹窗
```

### 6.3 专家召唤方式

**不是在输入框里 @提及**，而是通过两种方式：

**方式一：同事面板中点击**
```
同事面板 → 点击某个专家 → 创建该专家的会话
→ 这个专家的配置（plugin）注入到会话的 manifest 中
→ 助手的系统 prompt 里就带上了该专家的能力
```

**方式二：对话中召唤（浮窗专家栏）**
```
对话页面底部有一行浮窗专家栏（expert-rail）
├─ [排污许可] [碳排放] [环境监测] [+]
└─ 点击 → 专家插件注入当前对话
```

### 6.4 专家属性（WorkBuddy 精确字段）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识 |
| `name` | `{zh, en}` | 多语言名称 |
| `profession` | string | 职称/角色 |
| `description` | `{zh, en}` | 多语言描述 |
| `avatar` | string | 头像 URL |
| `tags` | string[] | 技能标签（最多显示3个） |
| `categoryId` | string | 行业分类 |
| `expertType` | string | `"expert"` 或 `"team"` |
| `plugin` | string | 插件包名 |
| `agentName` | string | 内部 Agent 标识 |
| `model` | string | 指定模型（可选） |
| `quickPrompts` | string[] | 快捷提问 |
| `abilities` | string[] | 能力列表 |
| `useCount` | number | 使用次数 |
| `importSecurityRisk` | `{riskLevel: "low"|"medium"|"high"}` | 安全风险等级 |

### 6.5 专家与 MCP 连接器的关系

**专家可以自带 MCP 连接器！**（WorkBuddy 的 `dependencyGate` 机制）

```
专家包导入时：
├─ 检查是否有自带的 MCP 配置
├─ 如果有同名 MCP 但配置不同 → 弹窗提示冲突
│  ├─ [覆盖并连接] → 用专家包的配置覆盖
│  └─ [暂不] → 跳过
└─ 确认后 → MCP 连接器自动连接
```

WorkBuddy 的 manifest 结构：
```json
{
  "plugins": [
    {
      "name": "permit-expert",
      "marketplace": "experts",
      "downloadUrl": "https://.../permit-expert.tar.gz"
    }
  ],
  "mcp": { ... }  // MCP 配置与 plugins 是平行关系
}
```

### 6.6 ExpertPicker 弹窗（全屏模态框）

```
┌───────────────────────────────────────────────────┐
│  👨‍💼 雇佣专家                       [🔍搜索...] [×] │
├───────────────────────────────────────────────────┤
│  [专家] [专家团]       ← tab 切换                   │
│                                                     │
│  [全部] [碳排放] [排污许可] [环境监测] [法规] [...]  │
│                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ 碳排放    │ │ 排污许可  │ │ 环境监测  │            │
│  │ 专家      │ │ 专家      │ │ 专家      │            │
│  │ 碳核算/   │ │ 许可证/   │ │ CEMS/     │            │
│  │ 配额/市场 │ │ 执行报告   │ │ 自行监测  │            │
│  │ [选择]    │ │ [选择]    │ │ [选择]    │            │
│  └──────────┘ └──────────┘ └──────────┘            │
│                                                     │
│  已选 0 个专家                    [取消] [确认(0)]    │
└───────────────────────────────────────────────────┘
```

CSS 精确值：
```css
.ec-picker-panel {
  width: min(1060px, calc(100vw - 48px));
  height: min(780px, calc(100vh - 90px));
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  background: #FFFFFF;
  box-shadow: 0 4px 24px rgba(0,0,0,0.12);
}
.ec-picker-tab {
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  color: #6B7280;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.12s ease, border-color 0.12s ease;
}
.ec-picker-tab--active {
  color: #059669;
  border-bottom-color: #059669;
}
.ec-expert-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}
```

### 6.7 EcoPilot 专家体系具体实现

```
左侧导航栏:               同事面板（点击"专家"后展开）:
┌──────┐                  ┌──────────────────────────────┐
│  💬  │  对话             │ 👥 我的专家                    │
│  🧠  │  专家 ← 点这里    │                                │
│  🗓️  │  日历             │ ┌─ 助手（Hermes）──────────┐  │
│  🔗  │  政务平台          │ │ 主代理，始终在线            │  │
│  🔌  │  连接器            │ └──────────────────────────┘  │
│  ⚙️  │  设置             │                                │
└──────┘                   │ ┌─ 排污许可专家 ──────────┐  │
                           │ │ 许可证申领/变更/执行报告   │  │
                           │ └──────────────────────────┘  │
                           │ ┌─ 碳排放专家 ────────────┐  │
                           │ │ 碳核算/配额/碳市场        │  │
                           │ └──────────────────────────┘  │
                           │ ┌─ 环境监测专家 ──────────┐  │
                           │ │ CEMS/自行监测/数据解读    │  │
                           │ └──────────────────────────┘  │
                           │ [+ 浏览专家库]                │
                           └──────────────────────────────┘
```

**对话中如何召唤专家：**
```
对话页面底部:
┌──────────────────────────────────────────────────────┐
│ [DeepSeek ▼] 输入消息...            [📎] [🎤] [▶]   │
│                                                      │
│ ┌─ 浮窗专家栏 ──────────────────────────────────┐   │
│ │ [🧾 排污许可] [🏭 碳排放] [📊 环境监测] [+ 更多] │   │
│ └────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘

点击专家卡片 → 该专家的 plugin 注入当前对话
→ 助手的 system prompt 增加该专家能力
→ 用户问相关问题 → 助手自动调用该专家
### 6.8 创建专家的完整流程（WorkBuddy 模式）

**跟你想的不一样！WorkBuddy 创建专家不是弹一个独立对话框——而是通过对话创建。**

#### 点击"创建专家"后发生的事：

```
用户点击 [+ 创建专家] 按钮
    ↓
导航回聊天首页
    ↓
输入框中自动插入一个特殊的 skill block: skill://custom-expert
    ↓
输入框自动填入默认 prompt（获取默认创建专家的提示）
    ↓
用户发送 → AI 开始对话引导用户创建专家
    ↓
    或者走弹窗模式（同事创建）
```

#### 同事创建弹窗（两条路径，同一组件）

WorkBuddy 同事创建有**两种方式**：
1. **对话创建**：通过 AI 对话引导
2. **弹窗创建**：3 步表单弹窗（create-colleague-modal）

#### 弹窗创建 3 步流程：

```
第一步：基础信息
┌──────────────────────────────────────────┐
│ 创建同事                         第1/3步  │
├──────────────────────────────────────────┤
│                                          │
│  助理职称 *  [___________]               │
│  角色快捷选项                             │
│  [前端] [资深] [小程序] [移动] [AI] ...  │
│                                          │
│  助理介绍 *  [___________]               │
│             [___________]                │
│                                          │
│  姓名 *     [___________]                │
│                                          │
│  头像                                    │
│  [○] [○] [○] [○] [+ 上传]              │
│                                          │
│                    [下一步]               │
└──────────────────────────────────────────┘

第二步：配置（选择模型 + 雇佣专家）
┌──────────────────────────────────────────┐
│ 创建同事                         第2/3步  │
├──────────────────────────────────────────┤
│                                          │
│  选择模型  [DeepSeek-Chat ▼]             │
│                                          │
│  雇佣专家                                 │
│  [从专家、专家团或企业智能体中选1个来源]  │
│  → 点击弹出 ExpertPicker（单选模式）      │
│                                          │
│  已选: [碳排放专家]                       │
│                                          │
│              [上一步] [下一步]             │
└──────────────────────────────────────────┘

第三步：确认创建
┌──────────────────────────────────────────┐
│ 创建同事                         第3/3步  │
├──────────────────────────────────────────┤
│                                          │
│  摘要信息:                                │
│  - 名称: 碳排放分析师                     │
│  - 职称: 碳排放管理                       │
│  - 模型: DeepSeek-Chat                   │
│  - 专家插件: 碳排放专家                   │
│                                          │
│               [上一步] [创建]             │
└──────────────────────────────────────────┘
```

#### 创建后的 Manifest 结构

```json
{
  "agentName": "碳排放分析师",
  "description": "负责企业碳排放核算与碳资产管理",
  "model": "deepseek-chat",
  "avatar": "avatar-3",
  "draft": false,
  "manifest": {
    "id": "tan-pai-fang-fen-xi-shi",
    "name": "碳排放分析师",
    "manifestVersion": "1.0",
    "description": "负责企业碳排放核算与碳资产管理",
    "system_prompt": "你是碳排放分析师...",
    "annotations": {
      "agent-title": "碳排放管理"
    },
    "plugins": [{
      "name": "carbon-expert",
      "marketplace": "experts",
      "agentName": "carbon-expert",
      "downloadUrl": "https://.../carbon-expert.tar.gz"
    }],
    "mcp": [],
    "workspaces": [],
    "memory": { "enable": true }
  }
}
```

#### 编辑和删除

**编辑：**
- 上下文菜单 → "修改专家"
- 导航回首页 → createExpertMode$.next({ editExpert: { id } })
- 调 publishCloudAgentVersion（不是 createCloudAgent）
- 表单字段跟创建完全一样

**删除：**
- 上下文菜单 → "删除"
- 弹 ConfirmDialog 确认
- 调 deleteCustomExpert API
- 成功后 toast "专家已删除"

#### EcoPilot 专家创建设计

```
"我的专家"页面:
┌──────────────────────────────────┐
│ 👥 我的专家                       │
│  [最近使用]  [我创建的]            │
├──────────────────────────────────┤
│                                  │
│  ┌─────────┐ ┌─────────┐        │
│  │ 碳排放    │ │ 排污许可 │        │
│  │ 分析师    │ │ 专家     │        │
│  │ ...      │ │ ...     │        │
│  │ [使用]   │ │ [使用]  │        │
│  │ [⋮]     │ │ [⋮]    │        │
│  └─────────┘ └─────────┘        │
│  ┌─────────────────────────┐    │
│  │       ＋ 创建专家        │    │
│  └─────────────────────────┘    │
│                                  │
│              [浏览专家库]         │
└──────────────────────────────────┘

点击"创建专家" → 跟 WorkBuddy 一样走对话/弹窗双路径
```

#### 和旧版 EcoPilot 的关键区别

| 维度 | 旧版 | 新版（WorkBuddy 模式） |
|------|------|----------------------|
| 专家创建 | 代码里硬编码 7 个 | 用户可自定义创建 |
| 创建方式 | 无 | 对话引导 / 3步弹窗 |
| 雇佣能力 | 无 | ExpertPicker 选专家插件 |
| manifest | 无 | 标准 JSON 结构 |
| 存储 | 前端 store | 后端 API 持久化 |
| | 旧版（前端硬编码） | 新版（WorkBuddy 模式） |
|--|-------------------|----------------------|
| 专家在哪 | 左侧可选 | 独立的专家面板，弹窗选择 |
| 怎么召唤 | 切换专家=切换角色 | 注入 plugin → 助手多了能力 |
| 谁来对话 | 切换后的专家 | 始终是助手（Hermes） |
| 扩展性 | 代码里写死7个 | 可以从市场安装任意专家 |

```
~/Desktop/ecopilot/
├── hermes-agent/          ← Hermes 引擎（子模块引用）
├── desktop/               ← 桌面端主开发目录
│   ├── electron/          ← 主进程
│   ├── src/
│   │   ├── app/           ← 页面
│   │   │   └── chat/      ← 对话页 + 右侧记忆/日记/资产面板
│   │   ├── components/
│   │   │   └── assets/    ← 资产组件
│   │   │   ├── sidebar/    ← 导航栏组件
│   │   │   ├── chat/       ← 对话组件
│   │   │   └── panels/     ← 右侧面板组件
│   │   ├── styles.css      ← CSS 变量主题系统
│   │   ├── package.json
│   │   └── vite.config.ts
├── govmcp/                 ← govmcp 协议（信创底座）
└── DEVELOPMENT_PLAN.md     ← 本方案

---

## 十一、EcoPilot 自有模块清单

以下模块来自旧前端（`~/EcoMind-OS/frontend/src/pages/`），将全部融入桌面端。

### 11.1 导航栏完整设计

```
左侧导航栏（52px 宽）:
┌──────┐
│  💬  │  对话       → 聊天/专家圆桌会议
│  🧠  │  专家       → 专家面板（同事面板 + 创建/雇佣）
│  🗓️  │  日历/日程   → 任务日历 + 排污许可到期提醒
│  📧  │  邮箱       → 飞书邮箱集成
│  🔗  │  政务平台    → 20 个生态环境平台快捷入口
│  📚  │  知识库     → 法规/标准/案例检索
│  🔌  │  连接器     → MCP 连接器管理
│  ⚙️  │  设置       → 系统设置
└──────┘
```

### 11.2 各模块功能说明

#### 💬 对话（Chat）
- 消息气泡（用户/AI/工具调用，参考 QClaw 折叠卡片）
- 流式输出（Hermes SSE 流式）
- 输入框（模型选择 + 附件 + 语音 + 发送）
- **专家圆桌会议**（原创 — 一键召集多专家并行讨论）
- 思维链展示（AI 推理过程展开/折叠）
- 浮窗专家栏（对话底部快速召唤专家）

#### 🧠 专家（Experts / Agents）
- **我的专家**：已绑定的专家卡片列表（WorkBuddy 同事面板）
- **浏览专家库**：ExpertPicker 全屏弹窗（WorkBuddy）
- **创建专家**：对话引导 / 3 步弹窗（WorkBuddy）
- **雇佣能力**：选现有专家作为 plugin 注入（WorkBuddy）
- **专家市场**：下载安装社区专家包（WorkBuddy）

#### 🗓️ 日历/日程（Projects）
- **任务日历**：月/周/日视图，任务卡片（旧前端 Projects）
- **排污许可到期提醒**：许可证有效期倒计时（EcoPilot 自有）
- **监测报告截止日期**：自行监测方案提交时间线（EcoPilot 自有）
- **例行会议**：定时例会的日历展示（EcoPilot 自有）
- **日历同步**：飞书日历集成（feishu）

#### 📧 邮箱（Mail）
- **收件箱**：飞书邮件列表（lark-mail）
- **写信**：起草/发送邮件（lark-mail）
- **邮件搜索**：全文搜索邮件（lark-mail）
- **邮箱通知**：新邮件桌面通知（Electron 原生）

---

## 十二、会话列表与新建会话设计

### 12.1 布局

```
┌──────────┬────────────────────────────────────────────┐
│ 导航栏    │  会话列表（可折叠）                          │
│ (52px)   │                                            │
│          │  ┌─ Top Bar ────────────────────────────┐  │
│          │  │ [新建任务]   [🔍 搜索]   [▼ 筛选]    │  │
│          │  └──────────────────────────────────────┘  │
│          │                                            │
│          │  ┌─ 今日 ──────────────────────────────┐  │
│          │  │ ○ 排污许可证延续申请         14:30   │  │
│          │  │ ○ 碳排放数据核查             11:20   │  │
│          │  ├─ 昨天 ──────────────────────────────┤  │
│          │  │ ○ 合规巡检报告                    │  │
│          │  ├─ 更早 ──────────────────────────────┤  │
│          │  │ ○ 环评预评价                     │  │
│          │  └──────────────────────────────────────┘  │
│          │                              [查看更多 N]  │
│          │                                            │
│          │  折叠态：                                 │
│          │  [≡]  [➕]                                 │
│          │  (48px 宽)                                 │
└──────────┴────────────────────────────────────────────┘
```

### 12.2 会话列表项（参考 WorkBuddy）

```css
/* 会话卡片 */
.session-card {
  padding: 4px 12px;              /* WorkBuddy 精确 */
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;               /* QClaw */
  transition: background-color 0.15s ease;
}
.session-card:hover {
  background: var(--wb-todo-menu-bg-hover);
}
.session-card--active {
  background: var(--wb-todo-menu-bg-active);
}

/* 状态图标（左） */
.session-card__icon {
  width: 16px;                    /* WorkBuddy */
  height: 16px;
  flex-shrink: 0;
}

/* 标题 */
.session-card__title {
  flex: 1;
  font-size: 13px;               /* WorkBuddy */
  line-height: 22px;
  font-weight: 400;
  color: var(--wb-todo-menu-text-default);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 时间（右） */
.session-card__time {
  font-size: 12px;               /* WorkBuddy */
  line-height: 20px;
  color: var(--wb-todo-menu-text-heading);
  flex-shrink: 0;
}

/* 未读点 */
.session-card__unread {
  width: 8px;                    /* QClaw */
  height: 8px;
  background: var(--wb-accent-unread);
  border-radius: 50%;
  border: 1.5px solid #FFFFFF;
  flex-shrink: 0;
}

/* 悬停操作按钮（默认隐藏） */
.session-card__action {
  width: 16px;
  height: 16px;
  opacity: 0;
  color: var(--wb-color-text-tertiary);
  transition: opacity 0.15s ease;
}
.session-card:hover .session-card__action {
  opacity: 1;
  color: var(--wb-color-text-primary);
}
```

### 12.3 分组标题

```css
/* 分组容器 */
.session-group {
  margin-bottom: 4px;
}

/* 分组标题 */
.session-group__header {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  cursor: pointer;
  border-radius: 6px;
}
.session-group__header:hover {
  background: rgba(0,0,0,0.03);
}

/* 分组图标 */
.session-group__icon {
  width: 16px;
  height: 16px;
  margin-right: 8px;
}

/* 分组标题文字 */
.session-group__label {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
  color: var(--wb-todo-menu-text-heading);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* 分组成员数 */
.session-group__count {
  font-size: 11px;
  color: var(--wb-color-text-tertiary);
  margin-right: 8px;
}

/* 分组内子项缩进 */
.session-group__child {
  padding-left: 36px !important;   /* WorkBuddy */
}
```

### 12.4 新建会话

**新建按钮位置（三处）：**

| 位置 | 状态 | 交互 |
|------|------|------|
| 会话列表顶部 | 展开态 | `[新建任务]` 按钮（高度 30px，圆角 8px，13px 字体） |
| 每个分组内 | 展开态 | `[➕]` 小图标按钮（16×16） |
| 侧边栏底部 | 折叠态 | `[➕]` 大图标按钮（36×36，圆角 6px，Tooltip"新建任务"） |

**点击新建后发生：**
1. 当前会话被清除（如有未保存内容先提示）
2. 新建一个空白会话
3. 聚焦到输入框
4. 快捷键：Cmd+N

```css
/* 新建任务按钮（顶部） */
.new-task-btn {
  width: 100%;
  height: 30px;
  padding: 4px 12px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 400;
  cursor: pointer;
  transition: background 0.15s ease;
  border: none;
  background: transparent;
  color: var(--wb-todo-menu-text-default);
}
.new-task-btn:hover {
  background: var(--wb-button-ghost-bg-hover);
}

/* 折叠态新建按钮 */
.new-task-btn--collapsed {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
```

### 12.5 搜索

```css
/* 搜索胶囊 */
.search-pill {
  height: 32px;
  padding: 0 8px 0 4px;
  background: var(--wb-bg-tertiary);
  border-radius: 100px;
  border: 1px solid transparent;
  display: flex;
  align-items: center;
  gap: 4px;
}
.search-pill__input {
  flex: 1;
  font-size: 14px;
  border: none;
  outline: none;
  background: transparent;
}
.search-pill__filter-btn {
  width: 24px;
  height: 24px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

/* 筛选菜单（Popover） */
.filter-menu {
  width: 240px;
  padding: 8px;
  border-radius: 8px;
  background: #FFFFFF;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
```

### 12.7 与旧版 EcoPilot 关键区别

| 维度 | 旧版（左侧可选专家） | 新版（WorkBuddy 模式） |
|------|-------------------|----------------------|
| 会话列表位置 | 左侧切换专家时显示 | 固定在左侧，按时间分组 |
| 分组方式 | 按专家分组 | 按日期分组（今天/昨天/更早）|
| 新建会话 | 选择专家自动创建 | 顶部[新建任务]按钮 / Cmd+N |
| 折叠 | 不可折叠 | 可折叠到 48px |
| 搜索 | 无 | 搜索胶囊 + 筛选菜单 |
| 悬停操作 | 无 | 重命名/更多菜单 |

---

## 十三、补全模块清单（最后一轮扫描发现）

以下为深度扫描 WorkBuddy + QClaw 后发现的方案遗漏模块，按优先级排列。

### P0 - 必须补全

#### 13.1 通知消息中心

参考 WorkBuddy `notification-panel` 组件：

```
会话列表底部铃铛按钮（32x32，圆角6px）
  → 显示未读计数徽章（14px高，#f56c6c，圆角7px）
  → 或小红点（6x6，#f56c6c）
  → 点击弹出通知面板（320px宽，圆角16px）

通知面板内容：
├── 标题 + [全部已读] 按钮
├── Tabs: [全部] [请求] [系统] [任务] [@提及] [截止]
├── 按时间段分组（今天/昨天/更早）
├── 每个通知卡片（flex row, gap 10px）
│   ├── 类型色标（橙/绿/蓝/紫/红）
│   ├── 头像（24x24，圆角full）
│   ├── 内容（可展开）
│   └── 操作按钮/下拉菜单
└── 右键菜单（标记已读/删除/屏蔽）
```

CSS 精确值：
```css
.notification-panel { width: 320px; border-radius: 16px; }
.notification-title { font-size: 16px; font-weight: 600; }
.notification-card { display: flex; gap: 10px; padding: 12px; }
.notification-card-request { border-left: 3px solid #f59e0b; }
.notification-card-system { border-left: 3px solid #10b981; }
.notification-card-task { border-left: 3px solid #3b82f6; }
.notification-card-mention { border-left: 3px solid #8b5cf6; }
.notification-card-deadline { border-left: 3px solid #ef4444; }
.notification-avatar { width: 24px; height: 24px; border-radius: 50%; }
.notification-list { max-height: 70vh; overflow-y: auto; }
```

#### 13.2 用户菜单（用户中心）

参考 WorkBuddy `user-menu` 组件：

```
会话列表底部用户头像入口
  → 显示头像（32x32）+ 名称 + 企业徽章
  → 消息中心铃铛 + 小程序入口
  → 点击弹出 popover（用户菜单）

用户菜单 popover 内容：
├── 用户信息头部（头像 + 名称 + 手机号 + 复制UID）
├── 主题切换器（浅色/深色/系统，thumb滑动动画）
├── 分隔线
├── 菜单项列表
│   ├── 计费与套餐（展示积分/用量）
│   ├── 成长记录
│   ├── 签到指示器（带红点）
│   └── 退出登录（红色）
└── Footer
```

CSS 精确值：
```css
.user-menu-popover { border-radius: 12px; padding: 8px; min-width: 240px; }
.user-menu-trigger-avatar { width: 32px; height: 32px; border-radius: 50%; }
.user-menu-item { padding: 8px 12px; border-radius: 8px; font-size: 13px; cursor: pointer; }
.user-menu-item:hover { background: rgba(0,0,0,0.05); }
.user-menu-item--logout { color: #ef4444; }
.user-menu-theme-switcher { display: flex; gap: 4px; padding: 8px; }
.user-menu-theme-option { width: 32px; height: 32px; border-radius: 50%; cursor: pointer; }
```

#### 13.3 全局搜索

参考 WorkBuddy `conversation-search-modal`：

```
快捷键 Cmd+K 或点击搜索胶囊
  → 弹出搜索模态框

搜索模态框：
├── 搜索输入框 + 搜索图标 + 清除按钮
├── 搜索结果计数
├── 结果列表
│   ├── 每条结果：标题 + 元信息（时间/专家/来源图标）
│   ├── 关键词高亮
│   └── 点击跳转到对应会话
└── 加载/重试/空状态
```

CSS 精确值：
```css
.conversation-search-modal { width: 600px; max-height: 80vh; border-radius: 16px; }
.search-result-modal__input { font-size: 14px; padding: 12px 16px; border-radius: 8px; }
.search-result-modal__item { padding: 12px 16px; border-radius: 8px; cursor: pointer; }
.search-result-modal__item-title { font-size: 14px; font-weight: 500; }
.search-result-modal__item-meta { font-size: 12px; color: #909090; }
```

### P1 - 重要遗漏

#### 13.4 右键菜单系统

```css
.cb-context-menu {
  padding: 4px; min-width: 160px;
  background: #FFFFFF; border: 1px solid #E6E6E6;
  border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
.cb-context-menu-item {
  padding: 6px 12px; border-radius: 4px;
  font-size: 13px; cursor: pointer;
  display: flex; align-items: center; justify-content: space-between;
}
.cb-context-menu-item:hover { background: rgba(0,0,0,0.05); }
.cb-context-menu-item-shortcut { font-size: 11px; color: #909090; }
.cb-context-menu-item.danger { color: #ef4444; }
```

#### 13.5 空状态统一组件

```css
.empty-state { 
  display: flex; flex-direction: column; align-items: center; 
  justify-content: center; padding: 48px 24px; gap: 12px; 
}
.empty-state__icon { width: 48px; height: 48px; opacity: 0.3; }
.empty-state__title { font-size: 14px; font-weight: 500; color: #6B7280; }
.empty-state__desc { font-size: 12px; color: #909090; }
.empty-state__action { margin-top: 8px; }
```

#### 13.6 加载骨架屏

```css
.skeleton-card { 
  padding: 16px; border-radius: 8px; background: #FFFFFF; 
}
.skeleton-line {
  height: 12px; border-radius: 4px; background: #F3F4F6;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}
.skeleton-line--title { width: 60%; height: 16px; margin-bottom: 8px; }
.skeleton-line--desc { width: 80%; }
@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}
```

### P2 - 深化覆盖

| 模块 | 说明 | 参考 |
|------|------|------|
| 文件版本管理 | 版本列表 + Diff 面板（类似 Git GUI） | WorkBuddy file-version |
| 文件上传/导入 | 拖拽 drop zone + 进度 + 安全扫描 | WorkBuddy skill-upload |
| 新手引导 | 首次使用时的服务绑定引导 | WorkBuddy kb-onboarding |
| 技能安全扫描 | 上传前风险检测结果弹窗 | WorkBuddy skill-scan |
| 拖拽交互 | 列宽调整 + 列表排序 + 标签拖拽 | WorkBuddy col-resize |
| QR 码/扫码 | 微信/QQ 二维码展示 | QClaw + WorkBuddy |
| 快捷键提示 | 右键菜单中显示快捷键标注 | WorkBuddy |

### 各阶段任务更新

**阶段一追加（P0）：通知消息中心 + 用户菜单 + 全局搜索 + 项目管理**
**阶段二追加（P1）：任务系统（创建/执行/归档）**
**阶段三追加（P1）：协作系统（活动流 + 权限 + 分享）**
**阶段四追加（P1）：右键菜单 + 空状态组件 + 加载骨架屏 + 文件预览 + 技能市场**
**阶段六追加（P2）：版本管理 + 新手引导 + 拖拽交互**

---

## 十四、最终补全模块（最后一次扫描发现）

以下为全量扫描 WorkBuddy 710 个 JS 文件 + 55 个 CSS 文件后的新增发现。

### P0 - 必须补全的新增模块

#### 14.1 项目管理系统（Project System）

**方案中完全遗漏！** WorkBuddy 有完整的项目系统，这是资产组织的最高层级。

```
项目列表页：
├── 项目网格（卡片视图）
│   ├── 卡片：项目名 + 描述 + 进度 + 成员头像 + 更新时间
│   └── 空状态：project-grid__empty（icon + title + subtitle）
├── 项目详情页
│   ├── 活动流（activity feed）
│   ├── 任务列表
│   ├── 文件/产物
│   ├── 成员管理
│   └── 项目设置
├── 创建项目弹窗
└── 归档/删除
```

**EcoPilot 需要**：企业环境合规项目（如"湘江流域治理"、"冷水江大气溯源"）的组织和管理。每个项目可包含多个会话、多个专家、多个资产产出。

#### 14.2 协作系统（Collaboration）

**方案中完全遗漏！** WorkBuddy 的同事面板包含完整的团队成员协作。

```
同事面板：
├── 团队成员列表
│   ├── 每个成员：头像 + 名称 + 角色 + 在线状态
│   ├── 邀请成员
│   └── 移除成员
├── 审批流
│   ├── 审批请求
│   ├── 审批/拒绝
│   └── 审批历史
├── 活动流
│   ├── 谁做了什么
│   └── 时间线
└── 权限设置
    ├── 角色（管理员/编辑者/查看者）
    └── 权限控制
```

**EcoPilot 需要**：企业环境合规需要多角色协作（环保管理员 → 厂长 → 第三方咨询机构）。

#### 14.3 任务系统（Task System）

**方案中提到但不完整。** WorkBuddy 有独立的任务创建/执行/归档系统。

```
任务系统：
├── 创建任务（对话中 / 手动创建）
├── 任务列表（按状态/优先级/截止日期筛选）
├── 任务详情
│   ├── 描述 + 附件
│   ├── 执行进度
│   ├── 相关人员
│   └── 活动记录
├── 任务归档
└── 定时任务（Cron）
```

#### 14.4 文件预览（File Preview）

**方案遗漏。** WorkBuddy 支持 10+ 种文件格式预览。

```
文件预览组件：
├── 图片预览（缩放/旋转/翻页）
├── PDF 预览
├── 代码预览（语法高亮）
├── Markdown 预览
├── Excel/CSV 预览
├── Drawio 图表
├── Excalidraw 白板
├── 视频/音频播放
└── 文本/Diff 预览
```

### P1 - 重要补全

#### 14.5 技能市场（Skill/Expert Marketplace）

**方案提到但不完整。** WorkBuddy 有 UnifiedMarketPage 统一市场页面。

```
技能市场：
├── 分类浏览（专家/专家团/工具/技能）
├── 搜索 + 筛选
├── 技能卡片（封面/描述/安装量/评分）
├── 安装/卸载
├── 更新管理
└── 安全扫描
```

#### 14.6 权限与角色（Permission & Role）

**方案完全遗漏。** EcoPilot 作为企业级应用需要权限体系。

```
权限模型：
├── 角色：超级管理员 / 企业管理员 / 环保专员 / 查看者
├── 权限点：对话/专家/政务平台/SaaS/设置
├── 企业多用户支持
└── 操作审计
```

### 完全不需要的模块（与 EcoPilot 定位无关）

以下为 WorkBuddy/QClaw 中有但 EcoPilot 不需要的：

| 模块 | 原因 |
|------|------|
| E2B 沙箱 | 代码执行环境，EcoPilot 不需要 |
| Ghostty 终端 | 终端模拟器，EcoPilot 不需要 |
| 微信支付 MCP | 支付通道，EcoPilot 不需要 |
| Ardot 设计系统 | UI 设计工具，EcoPilot 不需要 |
| 多模态生成技能 | 图片/视频生成，EcoPilot 暂不需要 |

### 方案最终模块树

```
EcoPilot Desktop v3.0 完整模块树
═══════════════════════════════════════

第一阶段（骨架 + P0）:
├── Electron 窗口 + 系统托盘
├── 三栏布局（导航 52px / 会话列表 / 对话区 / 右侧面板）
├── CSS 变量主题（亮/暗）
├── 快捷键
├── 对接 Hermes Gateway
├── 🔔 通知消息中心 （新增）
├── 👤 用户菜单 （新增）
├── 🔍 全局搜索 （新增）
└── 📁 项目系统 （新增 P0）

第二阶段（对话）:
├── 消息气泡 + 流式 + Markdown
├── 输入框 + 语音 + 附件
├── 会话管理
└── ✅ 任务系统 （新增 P1）

第三阶段（记忆-日记-资产-持续学习）:
├── 记忆引擎 / 日记引擎 / 资产索引
├── 右侧三标签面板
├── 触发 Hook
└── 🧠 持续学习引擎（会话结束自动提炼 Skill）

第四阶段（自有模块 + P1）:
├── 💬 对话（圆桌会议）
├── 🧠 专家（同事面板 + 创建雇佣）
├── 🗓️ 日历/日程
├── 📧 邮箱
├── 🔗 政务平台
├── 📚 知识库
├── 🔌 连接器
├── ⚙️ 设置
├── 📋 右键菜单 （P1）
├── 📭 空状态组件 （P1）
├── ⏳ 加载骨架屏 （P1）
├── 👥 协作系统 （新增 P1）
├── 📄 文件预览 （新增 P1）
└── 🏪 技能市场 （新增 P1）

第五阶段（MCP 生态兼容）:
├── 标准 MCP + SSE
├── resources 协议
└── 飞书/GitHub 连接器

第六阶段（打磨 + P2）:
├── 动画 / 错误处理 / 自动更新
├── 签名公证 / 内测发布
├── 文件版本管理 （P2）
├── 新手引导 （P2）
├── 拖拽交互 （P2）
├── QR 码/扫码 （P2）
├── 快捷键提示 （P2）
├── 权限与角色 （新增 P1）
└── 技能安全扫描 （P2）
```

#### 🔗 政务平台（Links）
- **平台卡片**：20 个生态环境平台快捷入口（旧前端 Links）
- **内置浏览器**：iframe 打开平台页面（旧前端）
- **平台状态**：可访问/需登录/已登录状态标记（EcoPilot 自有）
- **govmcp 就绪标记**：标记已可对接的 7 个平台（EcoPilot 自有）
- **账号绑定**：各平台账号凭证管理（EcoPilot 自有）

#### 📚 知识库（Knowledge）
- **法规搜索**：FTS5 全文检索 4000+ 法规（旧前端）
- **分类浏览**：按法律/国务院/部委/标准层级（旧前端）
- **案例检索**：典型执法/审批/修复案例（旧前端）
- **法条引用**：对话中一键引用法条（EcoPilot 自有）

#### 🔌 连接器（Connector）
- **MCP Server 列表**：已注册的连接器（WorkBuddy）
- **添加连接器**：从市场安装 / 手动配置（WorkBuddy）
- **状态管理**：在线/离线/错误（WorkBuddy）
- **连接器市场**：浏览可用的 MCP Server（WorkBuddy）

#### ⚙️ 设置（Settings）
- **账号**：头像/昵称/企业信息/许可证绑定（旧前端 + QClaw）
- **模型**：默认模型/API 地址/Key（QClaw）
- **通用**：语言/主题/字体/发送键（QClaw + WorkBuddy）
- **快捷键**：自定义快捷键（QClaw）
- **政务平台**：各平台账号绑定/Session 管理（EcoPilot 独有）
- **SaaS**：套餐/用量/续费/升级（QClaw）
- **关于**：版本/更新日志

### 11.3 旧前端→新桌面端迁移策略

| 模块 | 旧路径 | 迁移策略 |
|------|--------|---------|
| 对话 | `~/EcoMind-OS/frontend/src/pages/Chat/` | 重写（对齐 QClaw + 圆桌会议） |
| 专家 | `~/EcoMind-OS/frontend/src/pages/Experts/` + `Agents/` | 重写（对齐 WorkBuddy 同事面板） |
| 日历 | `~/EcoMind-OS/frontend/src/pages/Projects/` | **直接复用**组件逻辑，适配 Electron |
| 政务平台 | 已有 `platform_bridge.py` | **直接复用** UI 设计，适配 Electron |
| 知识库 | `~/EcoMind-OS/frontend/src/pages/Knowledge/` | **直接复用**搜索和分类逻辑 |
| 设置 | `~/EcoMind-OS/frontend/src/pages/Settings/` | 重写（对齐 QClaw 弹窗设计） |
| 技能 | `~/EcoMind-OS/frontend/src/pages/Skills/` | 合并到专家面板 |

```

---

## 七、开始顺序

**从阶段一第1项 → 阶段二 → 阶段三（核心）→ 阶段四 → 阶段五 → 阶段六**

其中阶段三是差异化核心，投入最大精力。
