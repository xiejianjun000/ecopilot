---
version: alpha
name: ecopilot-design-system
description: "EcoPilot — 生态环境合规管家桌面端的品牌视觉体系。翡翠绿主色 + 暖白灰阶 + 克制精准的企业软件美学。参考 Linear 的精准克制、Stripe 的权威优雅、Supabase 的绿色系使用方式、Notion 的温暖专业感。适用场景：桌面端 Electron 应用（Vite + React + Tailwind）。
核心调性：专业 · 可信赖 · 绿色智能 · 企业级沉稳"
---

# EcoPilot Design System

## 品牌色板

### 品牌色 — 翡翠绿（单一强调色）
colors:
  primary: "#059669"            # emerald-600 — 品牌色、主按钮、Logo Mark
  primary-hover: "#047857"      # emerald-700 — hover/active
  primary-soft: "#34d399"       # emerald-400 — 浅绿点缀
  primary-tint: "rgba(5,150,105,0.08)"  # 极轻薄品牌底色，侧栏选中态
  primary-bg: "rgba(5,150,105,0.1)"     # 按钮/标签的浅背景
  on-primary: "#ffffff"         # 品牌色上的文字

### 灰阶（分5级，参考 Supabase 的灰度梯度）
  ink: "#1d2129"                # 主要文字（近黑，不是纯黑）
  ink-secondary: "#535353"      # 二级文字
  ink-muted: "#909090"          # 三级文字/图标
  ink-disabled: "#b0b4ba"       # 禁用态
  canvas: "#ffffff"             # 页面/卡片底色
  canvas-soft: "#fafafa"        # 轻微底色（代替纯白做背景）
  surface-1: "#f2f4f7"         # 侧栏底色、Card 次级底色
  surface-2: "#e8eaed"         # 悬停态底色
  hairline: "#e5e7eb"          # 默认描边（极淡灰）
  hairline-strong: "#d1d5db"   # 强调描边

### 语义色（仅小面积使用）
  success: "#10b981"            # 成功 — 仅用于小点/标签文字
  destructive: "#ef4444"        # 错误 — 仅用于图标/状态点
  warning: "#f59e0b"            # 警告 — 仅用于图标
  info: "#3b82f6"               # 信息/链接

### 暗色模式
  ink-dark: "#d2d3e0"          # 暗色模式主要文字
  ink-dark-secondary: "#858699" # 暗色模式二级文字
  canvas-dark: "#1a1b1e"       # 暗色模式页面底色
  surface-dark-1: "#212234"    # 暗色模式表面色
  hairline-dark: "#2a2c31"     # 暗色模式描边

---

## 字体体系（参考 Linear + Stripe 的精确层级）

typography:
  font-family: "Inter", "PingFang SC", "Microsoft YaHei", -apple-system, sans-serif
  font-mono: "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, monospace

  # 展示级（仅欢迎页/品牌动画使用）
  display:
    fontSize: 72px
    fontWeight: 650
    lineHeight: 1.05
    letterSpacing: -2px
    fontFamily: "Inter", system-ui, sans-serif

  # 大标题（仪表盘首页使用）
  headline:
    fontSize: 36px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.8px

  # 区块标题（模块标题）
  section-title:
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.3px

  # 正文（UI 正文、列表、设置项）
  body:
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0

  # 辅助文字（状态栏、标签、Caption）
  caption:
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0

  # 数字/数据（参考 Stripe 的 tabular 数字字体）
  numeric:
    fontFamily: "Inter", "SF Mono", monospace
    fontSize: 14px
    fontWeight: 500
    letterSpacing: -0.3px

---

## 间距与布局（8px 基准网格——styleseed §C1 规则）

spacing:
  base: 4px
  grid: 8px                    # 8px 递进基准
  inline: 4px                  # icon ↔ 文字的间距
  stack-xs: 4px                # label ↔ input
  stack-sm: 8px                # 小间距
  stack-md: 16px               # UI controls 间距
  stack-lg: 24px               # 卡片间距
  stack-xl: 32px               # 区块间距
  card-padding: 16px           # 卡片内边距
  card-gap: 24px              # 卡片间距

  # 圆角体系（styleseed Coherence Law：全系统一个圆角风格）
  radius-sm: 4px               # 输入框、button 小圆角
  radius-md: 8px               # 卡片、弹窗默认圆角
  radius-pill: 9999px          # 标签、Badge 药丸圆角

  # 阴影体系（参照 styleseed - 向下权重、极低透明度）
  shadow-sm: "0 1px 2px rgba(0,0,0,0.04)"
  shadow-md: "0 4px 12px rgba(0,0,0,0.06)"
  shadow-lg: "0 8px 24px rgba(0,0,0,0.08)"

---

## 组件风格

### 按钮
btns:
  primary-bg: "--color-primary"
  primary-text: "--color-on-primary"
  priamry-hover: "--color-primary-hover"
  padding-x: 16px
  padding-y: 8px
  radius: --radius-md
  secondary-bg: transparent
  secondary-border: --color-hairline

### 卡片
cards:
  bg: --color-canvas
  border: --color-hairline (1px)
  radius: --radius-md
  padding: --spacing-card-padding
  inner-gap: 12px

### 弹窗/浮层（参考 Stripe 的大阴影 + 毛玻璃风格）
overlays:
  bg: rgba(255,255,255,0.97)   # 极轻微毛玻璃
  backdrop-filter: blur(20px)
  radius: --radius-md
  shadow: --shadow-lg
  border: 1px solid rgba(0,0,0,0.04)

---

## Logo Mark 设计准则

### 图形语言
  - 翡翠绿单色可识别（16px Favicon 可辨）
  - 不用叶子/树/动物等具象环保元素
  - 负空间优先——有留白、有回味的余地
  - 克制几何，不堆砌图形
  - 参考 Stripe 的"零图形干扰"、Linear 的"单色 lavender mark"

### 字体搭配
  - 字标 "EcoPilot" 用 Inter 650 weight
  - letter-spacing: -1px
  - Logo Mark 在字标左侧或上方

### 应用场景
  - 主 Logo（128px × 128px App Icon）：绿底白 Mark
  - Favicon（16px × 16px）：绿底单色简版 Mark
  - Titlebar（22px × 22px）：绿底 Mark
  - 横版 Logo Mark + EcoPilot 文字（欢迎页/关于页）
  - 纯文字 Logo（仅"EcoPilot"字标，用于空间有限的标题栏）

---

## 禁止事项（反模式 — 参考 styleseed §18）

  ❌ 渐变彩虹背景、多个强调色混用
  ❌ 通用 AI 审美（Inter + 紫色渐变 + 白底 = 零辨识度）
  ❌ 纯白大面积背景（用 --color-canvas-soft: #fafafa 替代）
  ❌ 用边框分隔一切（间距和背景色差异是更优雅的分离方式）
  ❌ leaf/树/地球图标（环境行业陈词滥调）
  ❌ 绿色文字色（绿色只作为品牌强调色背景，不作为文字颜色出现）
  ❌ 单视图 6+ 种字号（最高 5 级，见 typography）
  ❌ 字号用 vw 没 clamp
