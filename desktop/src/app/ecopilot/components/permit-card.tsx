/**
 * 排污许可证信息卡片
 */

import type { PermitInfo } from '../lib/permit-parser'
import { daysUntilExpiry } from '../lib/permit-parser'
import { ComplianceBadge } from './compliance-badge'
import { CountdownTimer } from './countdown-timer'

interface PermitCardProps {
  permit: PermitInfo
}

export function PermitCard({ permit }: PermitCardProps) {
  const days = daysUntilExpiry(permit.validTo)

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      {/* 头部 */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold">排污许可证</h3>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            {permit.permitNumber}
          </p>
        </div>
        <ComplianceBadge
          status={days <= 0 ? 'expired' : days <= 30 ? 'urgent' : days <= 90 ? 'warning' : 'safe'}
        />
      </div>

      {/* 倒计时 */}
      <CountdownTimer days={days} label={days <= 0 ? '许可证已到期' : '距到期'} />

      {/* 详细信息 */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-muted-foreground">发证机关</span>
          <p className="font-medium mt-0.5">{permit.issuingAuthority || '未知'}</p>
        </div>
        <div>
          <span className="text-muted-foreground">行业类别</span>
          <p className="font-medium mt-0.5">{permit.industryCategory || '未知'}</p>
        </div>
        <div>
          <span className="text-muted-foreground">管理类别</span>
          <p className="font-medium mt-0.5">{permit.managementLevel || '未知'}</p>
        </div>
        <div>
          <span className="text-muted-foreground">排放口数量</span>
          <p className="font-medium mt-0.5">{permit.emissionOutlets.length} 个</p>
        </div>
      </div>

      {/* 排放标准速览 */}
      {permit.emissionOutlets.length > 0 && (
        <div className="border-t pt-3">
          <span className="text-xs text-muted-foreground">主要排放标准</span>
          <div className="mt-2 space-y-1.5">
            {permit.emissionOutlets.flatMap(o =>
              o.limits.slice(0, 2).map(l => (
                <div key={`${o.code}-${l.factor}`} className="flex justify-between text-xs">
                  <span>{o.name} · {l.factor}</span>
                  <span className="font-mono font-medium">
                    ≤ {l.limit} {l.unit}
                  </span>
                </div>
              ))
            ).slice(0, 5)}
          </div>
        </div>
      )}
    </div>
  )
}
