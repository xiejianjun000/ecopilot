import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LoaderProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
  label?: string
}

const SIZE: Record<NonNullable<LoaderProps['size']>, string> = {
  sm: 'size-3.5',
  md: 'size-5',
  lg: 'size-8',
}

export function Loader({ size = 'md', className, label }: LoaderProps) {
  return (
    <div className={cn('flex items-center justify-center gap-2 text-muted-foreground', className)}>
      <Loader2 className={cn('animate-spin', SIZE[size])} />
      {label && <span className="text-body">{label}</span>}
    </div>
  )
}

/** 全屏加载占位 */
export function FullLoader({ label }: { label?: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Loader size="lg" label={label} />
    </div>
  )
}
