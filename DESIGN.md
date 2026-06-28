---
version: alpha
name: EcoPilot
description: >
  EcoPilot 生态环境合规管家桌面端的品牌视觉体系。
  翡翠绿主色、暖白灰阶、克制精准的企业软件美学。
  参考 Linear 的精准克制、Stripe 的权威优雅、
  Supabase 的绿色系使用方式、Notion 的温暖专业感。
  适用场景：桌面端 Electron 应用（Vite + React + Tailwind）。
  核心调性：专业、可信赖、绿色智能、企业级沉稳。
colors:
  primary: "#059669"
  primary-hover: "#047857"
  primary-soft: "#34d399"
  primary-tint: "rgba(5,150,105,0.08)"
  on-primary: "#ffffff"
  ink: "#1d2129"
  ink-secondary: "#535353"
  ink-muted: "#909090"
  ink-disabled: "#b0b4ba"
  canvas: "#ffffff"
  canvas-soft: "#fafafa"
  surface-1: "#f2f4f7"
  surface-2: "#e8eaed"
  hairline: "#e5e7eb"
  hairline-strong: "#d1d5db"
  success: "#10b981"
  destructive: "#ef4444"
  warning: "#f59e0b"
  info: "#3b82f6"
  ink-dark: "#d2d3e0"
  ink-dark-secondary: "#858699"
  canvas-dark: "#1a1b1e"
  surface-dark-1: "#212234"
  hairline-dark: "#2a2c31"
typography:
  font-family: "Inter, PingFang SC, Microsoft YaHei, -apple-system, sans-serif"
  font-mono: "SF Mono, Cascadia Code, JetBrains Mono, Menlo, monospace"
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 72px
    fontWeight: 650
    lineHeight: 1.05
    letterSpacing: "-2px"
  headline:
    fontFamily: "Inter, PingFang SC, system-ui, sans-serif"
    fontSize: 36px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.8px"
  section-title:
    fontFamily: "Inter, PingFang SC, system-ui, sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.3px"
  body:
    fontFamily: "Inter, PingFang SC, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  caption:
    fontFamily: "Inter, PingFang SC, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0
  numeric:
    fontFamily: "Inter, SF Mono, monospace"
    fontSize: 14px
    fontWeight: 500
    letterSpacing: "-0.3px"
rounded:
  sm: 4px
  md: 8px
  pill: 9999px
spacing:
  base: 4px
  grid: 8px
  inline: 4px
  stack-xs: 4px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 24px
  stack-xl: 32px
  card-padding: 16px
  card-gap: 24px
shadow:
  sm: "0 1px 2px rgba(0,0,0,0.04)"
  md: "0 4px 12px rgba(0,0,0,0.06)"
  lg: "0 8px 24px rgba(0,0,0,0.08)"
components:
  button-primary:
    backgroundColor: "#047857"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    padding: 8px 16px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  card-default:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "{spacing.card-padding}"
  overlay:
    backgroundColor: "rgba(255,255,255,0.97)"
    backdrop-filter: "blur(20px)"
    rounded: "{rounded.md}"
---

## Overview

EcoPilot 是一个面向企业环保专员的桌面端生态环境合规管理应用。
品牌视觉的核心任务是传达专业可信赖、绿色智能、企业级沉稳的调性。

设计参考了 Linear 的精准克制、Stripe 的权威优雅、Supabase 的绿色系使用方式、
Notion 的温暖专业感。但 EcoPilot 不是任何品牌的复制，
而是基于"生态环境合规"这个具体行业属性建立的独立视觉语言。

## Colors

- **Primary (#059669)** — 翡翠绿，唯一的品牌强调色。只出现在 Logo、主按钮、品牌标识元素。不用于大面积的背景或文字颜色。
- **Primary Soft (#34d399)** — 用于装饰性点缀、选中态。
- **Ink (#1d2129)** — 主要文字颜色，近黑非纯黑。
- **Canvas (#ffffff)** 和 **Canvas Soft (#fafafa)** — 页面底色和轻微底色，替代纯白。
- **Surface 1 (#f2f4f7)** — 侧栏底色、次级表面。
- **Hairline (#e5e7eb)** — 统一的默认描边。
- 语义色（success/destructive/warning/info）只作为小面积状态指示使用。

## Typography

西文使用 Inter 可变字体，中文使用 PingFang SC。5 级层级：

1. **display (72px/650)** — 仅品牌动画/欢迎页，非日常使用
2. **headline (36px/600)** — 仪表盘首页大标题
3. **section-title (20px/600)** — 模块区块标题
4. **body (14px/400)** — 正文、列表、设置项（桌面端标准可读尺寸）
5. **caption (12px/400)** — 辅助文字、状态栏、标签

数字/数据使用 Inter 的 tabular figures，保持对齐。
中文使用 text-wrap: balance 自动平衡。

## Layout & Spacing

8px 基准网格体系。所有间距值都是 4px 的倍数。
卡片内 padding 紧凑 (16px)，卡片间 gap 宽松 (24px)。
用间距代替描边分割内容。

## Elevation & Depth

- 阴影使用向下权重、极低透明度的体系（sm/md/lg 三级）
- 弹窗/浮层使用毛玻璃效果（blur 20px + 极轻微半透明底色）
- 所有组件共享同一阴影体系，不使用硬编码的阴影值

## Shapes

全系统统一圆角风格：
- sm (4px) — 输入框、按钮
- md (8px) — 卡片、弹窗
- pill (9999px) — 标签、badge

## Components

- **button-primary** — 主按钮，品牌绿色背景白色文字
- **card-default** — 标准卡片，白色背景 8px 圆角
- **overlay** — 弹窗浮层，毛玻璃 + 大阴影

## Do's and Don'ts

- ✅ 单一强调色翡翠绿（在需要用户注意的交互点上使用）
- ✅ 负空间优先（Logo 设计通过挖空/留白来创造图形）
- ✅ 非具象环保元素（不画叶子/树/地球）
- ✅ 灰阶分层（5 级灰度：strong→primary→secondary→muted→disabled）
- ❌ 多个强调色混用
- ❌ 绿色文字（绿色只作为背景/填充色，不作为文字颜色）
- ❌ 渐变彩虹背景
- ❌ 纯白大面积背景（用 #fafafa）
- ❌ 用边框分隔一切（用间距和底色差异）
- ❌ 6+ 种字号在同一视图（最高 5 级）
- ❌ 通用 AI 审美（Inter + 紫色渐变 + 白底）
- ❌ 叶子/树/地球等环保行业陈词滥调
