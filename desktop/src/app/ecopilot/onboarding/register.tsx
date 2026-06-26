/**
 * 第四步：注册账号
 */

import { useState } from 'react'
import { useStore } from '@nanostores/react'
import { $onboarding, setUserInfo, completeOnboarding } from '../store/onboarding'

export function Register() {
  const { userName } = useStore($onboarding)
  const [phone, setPhone] = useState('')
  const [name, setName] = useState(userName || '军哥')
  const [role, setRole] = useState<'环保专员' | '厂长' | '第三方咨询' | ''>('环保专员')

  const handleSubmit = () => {
    setUserInfo(phone, name, role)
    completeOnboarding()
    window.location.reload()
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">👤 创建您的账号</h2>
        <p className="text-muted-foreground">
          最后一步，创建账号即可开始使用
        </p>
      </div>

      {/* 表单 */}
      <div className="space-y-4 max-w-sm mx-auto">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            手机号
          </label>
          <div className="flex gap-2">
            <input
              type="tel"
              className="flex-1 px-3 py-2.5 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              placeholder="请输入手机号"
              value={phone}
              onChange={e => setPhone(e.target.value)}
            />
            <button className="px-3 py-2.5 rounded-lg border text-sm hover:bg-muted transition-colors flex-shrink-0">
              发送验证码
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            姓名
          </label>
          <input
            type="text"
            className="w-full px-3 py-2.5 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            placeholder="请输入您的姓名"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            角色
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['环保专员', '厂长', '第三方咨询'] as const).map(r => (
              <button
                key={r}
                className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                  role === r
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'hover:bg-muted'
                }`}
                onClick={() => setRole(r)}
              >
                {r === '环保专员' ? '🌿 ' : r === '厂长' ? '🏭 ' : '📋 '}
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-center">
        <button
          className="px-8 py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors"
          onClick={handleSubmit}
        >
          进入 EcoPilot
        </button>
      </div>
    </div>
  )
}
