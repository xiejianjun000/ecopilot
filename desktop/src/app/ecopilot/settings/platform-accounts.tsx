/**
 * 政务平台账号管理
 *
 * 管理 7 个核心生态环境平台的账号/密码/UKey 凭据。
 * 凭据本地存储，支持显示/隐藏密码。
 */

import { useState } from 'react'
import { CORE_PLATFORMS, type GovernmentPlatform } from '../lib/platform-urls'

interface PlatformCredential {
  platformName: string
  username: string
  password: string
  saved: boolean
}

const CATEGORY_LABELS: Record<string, string> = {
  permit: '排污许可',
  monitoring: '环境监测',
  carbon: '碳排放',
  'solid-waste': '固废管理',
  eia: '环评',
  enforcement: '执法',
  disclosure: '信息公开',
  other: '其他',
}

export default function PlatformAccountsPage() {
  const [credentials, setCredentials] = useState<PlatformCredential[]>(() => {
    return CORE_PLATFORMS.map(p => ({
      platformName: p.name,
      username: '',
      password: '',
      saved: false,
    }))
  })
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)

  const updateCredential = (name: string, field: 'username' | 'password', value: string) => {
    setCredentials(prev => prev.map(c => c.platformName === name ? { ...c, [field]: value, saved: false } : c))
  }

  const saveCredential = (name: string) => {
    setCredentials(prev => prev.map(c => c.platformName === name ? { ...c, saved: true } : c))
    setEditing(null)
  }

  const togglePassword = (name: string) => {
    setVisiblePasswords(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const grouped = CORE_PLATFORMS.map((p, i) => ({
    platform: p,
    credential: credentials[i],
  }))

  const savedCount = credentials.filter(c => c.saved).length

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">🔗 政务平台账号管理</h1>
          <span className="text-sm text-muted-foreground">已配置 {savedCount}/{CORE_PLATFORMS.length} 个平台</span>
        </div>

        <div className="space-y-3">
          {grouped.map(({ platform, credential }) => {
            const isEditing = editing === platform.name
            const catLabel = CATEGORY_LABELS[platform.category] || platform.category

            return (
              <div key={platform.name} className="rounded-xl border bg-card hover:border-muted-foreground/20 transition-colors">
                <div className="p-4">
                  {/* 平台信息行 */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{platform.icon}</span>
                      <div>
                        <div className="text-sm font-medium">{platform.name}</div>
                        <div className="text-xs text-muted-foreground">{catLabel} · {platform.loginMethod === 'account' ? '账号密码' : platform.loginMethod === 'ukey' ? 'UKey' : platform.loginMethod === 'ca' ? 'CA证书' : '短信'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {platform.govmcpReady && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 font-medium">govmcp 就绪</span>}
                      {credential.saved ? (
                        <span className="text-xs text-emerald-600">✅ 已配置</span>
                      ) : (
                        <span className="text-xs text-amber-600">⚠️ 未配置</span>
                      )}
                    </div>
                  </div>

                  {/* 凭据编辑区 */}
                  {isEditing ? (
                    <div className="space-y-2 ml-10">
                      <input
                        type="text"
                        className="w-full px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        placeholder="平台账号"
                        value={credential.username}
                        onChange={e => updateCredential(platform.name, 'username', e.target.value)}
                      />
                      <div className="flex gap-2">
                        <input
                          type={visiblePasswords.has(platform.name) ? 'text' : 'password'}
                          className="flex-1 px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                          placeholder="平台密码"
                          value={credential.password}
                          onChange={e => updateCredential(platform.name, 'password', e.target.value)}
                        />
                        <button className="px-2 py-1 text-sm text-muted-foreground hover:text-foreground" onClick={() => togglePassword(platform.name)}>
                          {visiblePasswords.has(platform.name) ? '隐藏' : '显示'}
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button className="px-3 py-1.5 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => saveCredential(platform.name)}>
                          保存
                        </button>
                        <button className="px-3 py-1.5 text-sm rounded-lg border hover:bg-muted" onClick={() => setEditing(null)}>
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between ml-10">
                      <div className="text-sm text-muted-foreground">
                        {credential.saved ? (
                          <span>账号: {credential.username}</span>
                        ) : (
                          <span className="text-xs">凭据仅本地存储，不上传云端</span>
                        )}
                      </div>
                      <a href={platform.loginUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-600 hover:text-emerald-700 mr-2">
                        前往登录 →
                      </a>
                    </div>
                  )}
                </div>

                {/* 操作按钮（非编辑态） */}
                {!isEditing && (
                  <div className="px-4 pb-3 flex gap-2 ml-10">
                    <button className="text-xs px-2.5 py-1 rounded-lg border hover:bg-muted transition-colors" onClick={() => setEditing(platform.name)}>
                      {credential.saved ? '修改' : '配置'}
                    </button>
                    {credential.saved && (
                      <button className="text-xs px-2.5 py-1 rounded-lg border text-red-500 hover:bg-red-50 transition-colors" onClick={() => {
                        setCredentials(prev => prev.map(c => c.platformName === platform.name ? { ...c, username: '', password: '', saved: false } : c))
                      }}>
                        清除
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="text-center text-xs text-muted-foreground">
          🔒 凭据仅存储在本地，不会上传到任何云端服务器
        </div>
      </div>
    </div>
  )
}
