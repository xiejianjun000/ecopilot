/**
 * 合规状态徽章
 */

import type { ExpiryStatus } from '../lib/permit-parser'

interface ComplianceBadgeProps {
  status: ExpiryStatus | 'compliant' | 'attention' | 'risk'
  className?: string
}

const badgeConfig: Record<string, { bg: string; text: string; label: string }> = {
  safe: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', label: '正常' },
  warning: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', label: '需关注' },
  urgent: { bg: 'bg-red-50 border-red-200', text: 'text-red-700', label: '紧急' },
  expired: { bg: 'bg-red-100 border-red-300', text: 'text-red-800', label: '已过期' },
  compliant: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', label: '合规' },
  attention: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', label: '需关注' },
  risk: { bg: 'bg-red-50 border-red-200', text: 'text-red-700', label: '存在风险' },
}

export function ComplianceBadge({ status, className = '' }: ComplianceBadgeProps) {
  const config = badgeConfig[status] || badgeConfig.safe

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.bg} ${config.text} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${status === 'safe' || status === 'compliant' ? 'bg-emerald-500' : status === 'warning' || status === 'attention' ? 'bg-amber-500' : 'bg-red-500'}`} />
      {config.label}
    </span>
  )
}
