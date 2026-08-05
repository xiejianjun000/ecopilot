import { Input as InputPrimitive } from '@base-ui/react/input'
import { cn } from '@/lib/utils'

function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(
        'flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-body text-foreground',
        'shadow-sm transition-colors',
        'file:border-0 file:bg-transparent file:text-body file:font-medium',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:border-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export { Input }
