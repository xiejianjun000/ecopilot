import { cn } from '@/lib/utils'

interface ProgressProps {
  value: number  // 0-100
  className?: string
  indicatorClassName?: string
  showLabel?: boolean
  label?: string
}

export function Progress({ value, className, indicatorClassName, showLabel, label }: ProgressProps) {
  const v = Math.max(0, Math.min(100, value))
  const color = v >= 80 ? 'bg-success' : v >= 50 ? 'bg-warning' : v === 0 ? 'bg-muted-foreground/30' : 'bg-destructive'
  return (
    <div className={cn('w-full', className)}>
      <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-300', color, indicatorClassName)}
          style={{ width: `${Math.max(v, 2)}%` }}
        />
      </div>
      {showLabel && (
        <div className="flex items-center justify-between mt-1 text-caption text-muted-foreground">
          <span>{label}</span>
          <span className="tabular-nums">{v}%</span>
        </div>
      )}
    </div>
  )
}
