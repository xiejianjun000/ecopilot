import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import './globals.css'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github.css'
import 'highlight.js/styles/github-dark.css'
import { MonitorProvider } from '@/components/monitor-provider'

export const metadata: Metadata = {
  title: 'EcoPilot · 企业生态环境合规AI管家',
  description: '全生命周期生态环境合规AI管家 — 排污许可 · 碳排放 · 督察整改 · 台账管理',
  icons: {
    // 方形图标由官方 eco 字标生成（横版字标直接做 favicon 会缩成一条线）
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ecfdf5' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${GeistSans.variable} ${GeistMono.variable} bg-background`}>
      <body className="antialiased font-sans">
        <MonitorProvider>{children}</MonitorProvider>
      </body>
    </html>
  )
}
