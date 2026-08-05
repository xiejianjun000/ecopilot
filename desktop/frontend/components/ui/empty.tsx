import { type LucideIcon, Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyProps {
  icon?: LucideIcon
  title?: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function Empty({ icon: Icon = Inbox, title = '暂无数据', description, action, className }: EmptyProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 px-4 text-center', className)}>
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground mb-3">
        <Icon className="size-6" />
      </div>
      <p className="text-body font-medium text-foreground">{title}</p>
      {description && <p className="text-caption text-muted-foreground mt-1 max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
