/**
 * 到期倒计时组件
 */

import { memo } from 'react'

interface CountdownTimerProps {
  days: number
  label: string
}

export const CountdownTimer = memo(function CountdownTimer({ days, label }: CountdownTimerProps) {
  const isUrgent = days <= 30
  const isWarning = days <= 90 && days > 30

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-card">
      <div
        className={`flex items-center justify-center w-14 h-14 rounded-xl text-lg font-bold ${
          isUrgent
            ? 'bg-red-50 text-red-600 border-2 border-red-200'
            : isWarning
              ? 'bg-amber-50 text-amber-600 border-2 border-amber-200'
              : 'bg-emerald-50 text-emerald-600 border-2 border-emerald-200'
        }`}
      >
        {days <= 0 ? '已过期' : days}
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-sm font-medium ${isUrgent ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-emerald-600'}`}>
          {days <= 0
            ? '请立即处理'
            : isUrgent
              ? '紧急处理'
              : isWarning
                ? '尽快准备'
                : '正常'}
        </div>
      </div>
    </div>
  )
})
