/**
 * 第四步：平台登录 — 输入账号密码 + 验证码
 */

import { useState } from 'react'
import { setStep, setPlatformCredentials } from '../store/onboarding'
import { PERMIT_PLATFORM_LOGIN } from '../lib/platform-urls'

export function PlatformLogin() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [captcha, setCaptcha] = useState('')

  const handleSubmit = () => {
    setPlatformCredentials(username, password)
    setStep('register')
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">🔐 登录排污许可平台</h2>
        <p className="text-muted-foreground">
          EcoPilot 将登录全国排污许可证管理信息平台<br />
          全面检查企业的合规状态
        </p>
      </div>

      {/* 表单 */}
      <div className="space-y-4 max-w-sm mx-auto">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            平台账号
          </label>
          <input
            type="text"
            className="w-full px-3 py-2.5 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            placeholder="请输入平台账号"
            value={username}
            onChange={e => setUsername(e.target.value)}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            平台密码
          </label>
          <input
            type="password"
            className="w-full px-3 py-2.5 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            placeholder="请输入平台密码"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            验证码
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              className="flex-1 px-3 py-2.5 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              placeholder="请输入验证码"
              value={captcha}
              onChange={e => setCaptcha(e.target.value)}
            />
            <div className="w-24 h-10 rounded-lg bg-muted flex items-center justify-center text-xs text-muted-foreground border cursor-pointer hover:border-emerald-300 transition-colors">
              验证码
            </div>
          </div>
        </div>
      </div>

      {/* 安全声明 */}
      <div className="bg-muted/50 rounded-xl p-4 max-w-sm mx-auto space-y-2 text-xs text-muted-foreground">
        <p>🔒 凭据仅存储在本地，不上传云端</p>
        <p>🔒 仅用于查询合规状态，不执行任何写操作</p>
      </div>

      {/* 检查清单 */}
      <div className="bg-card border rounded-xl p-4 max-w-sm mx-auto space-y-2">
        <p className="text-sm font-medium">🔍 EcoPilot 将自动检查：</p>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>✅ 执行报告提交情况</li>
          <li>✅ 自行监测数据上传情况</li>
          <li>✅ 是否存在超标或违规记录</li>
          <li>✅ 许可证状态是否正常</li>
        </ul>
      </div>

      <div className="flex flex-col items-center gap-3">
        <button
          className="px-8 py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!username || !password}
          onClick={handleSubmit}
        >
          开始全面检查
        </button>
        <button
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setStep('register')}
        >
          跳过，稍后配置
        </button>
      </div>
    </div>
  )
}
