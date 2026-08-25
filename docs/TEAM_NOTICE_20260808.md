# 📋 团队通知：文档已更新至 v1.0.6，明确 Hermes 基座定位

各位，

三份核心文档已完成 v1.0.6 同步更新。最重要的变化：**首次在全部文档中明确了 Hermes AI 引擎为 EcoPilot 的 AI 基座**，请全员知悉并在对外沟通中统一口径。

---

## 一、核心变化：Hermes 基座定位

此前文档将 Hermes 描述为"一个适配器模块"，这是不准确的。已修正为：

> **EcoPilot = Hermes（AI 基座）+ 生态环境合规业务**
>
> Hermes 提供 4 层记忆、自学习、7 子代理路由、GEPA 进化、技能市场等 AI 基础设施，EcoPilot 负责排污许可、排放标准、环保法规、督察整改等垂直业务逻辑。

类比：就像 iOS 跑在 Darwin 内核上——**EcoPilot 跑在 Hermes 上**。

## 二、更新文档清单

| 文档 | 变更内容 |
|------|---------|
| [CLAUDE.md](file:///Users/mac/dev/ecopilot/CLAUDE.md) | 新增「架构：Hermes AI 引擎为基座」章节（架构图 + 5 层能力表）；导航名同步 UI 实际名称；测试数量修正（599/215） |
| [PROJECT_SPECIFICATION.md](file:///Users/mac/dev/ecopilot/PROJECT_SPECIFICATION.md) | 新增「EcoPilot 的技术底座：Hermes AI 引擎」章节；导航名全量同步（交办整改/合规日历/申报平台）；AI 管家架构章补充 v1.0.7 发布状态标注 |
| [V1.0.6_DELIVERY_REPORT.md](file:///Users/mac/dev/ecopilot/docs/V1.0.6_DELIVERY_REPORT.md) | 新增「零、架构总览」章节（3 层架构图 + 职责分工表）；完整记录本轮全面测试结果（814 自动化 / 22 端点 / 6 E2E 页面 / 安全修复） |

## 三、其他同步修复

- **安全**：`mcp_servers.json` 凭据脱敏（仓库明文 Token → 环境变量占位符），真实凭据迁至 gitignore 保护的 `.local.json`
- **测试**：vitest flaky 修复（tasks 全自动筛选），适配 Vitest 4 API
- **文档**：导航名全量对齐 UI 实际名称，删除不存在的 `/api/license/fingerprint` 独立端点

## 四、对外沟通口径

以后任何对外材料（官网、宣传、客户沟通）中涉及 AI 能力时，统一使用以下表述：

> "EcoPilot 的 AI 能力基于 Hermes 引擎——它提供记忆、自学习和多专家协作，EcoPilot 在生态环境合规这个垂直领域做了深度适配。"

避免 "EcoPilot 调用了 DeepSeek API" 这类过于简化的说法——它掩盖了 Hermes 作为 AI 基础设施的价值。

---

有任何疑问随时找我。

