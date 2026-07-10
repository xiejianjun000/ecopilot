import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github.css'
import 'highlight.js/styles/github-dark.css'
import { MonitorProvider } from '@/components/monitor-provider'

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

export const metadata: Metadata = {
  title: 'EcoPilot · 企业生态环境合规AI管家',
  description: '全生命周期生态环境合规专家 — 排污许可 · 碳排放 · 督察整改 · 台账管理',
  icons: {
    icon: '/icon.svg',
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
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable} bg-background`}>
      <body className="antialiased font-sans">
        <MonitorProvider>{children}</MonitorProvider>
      </body>
    </html>
  )
}
