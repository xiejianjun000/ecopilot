'use client'
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const SIZE: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
}

export function Modal({ open, onClose, title, description, children, footer, size = 'md', className }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    // 记录当前焦点，关闭后恢复
    prevFocusRef.current = document.activeElement as HTMLElement
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      // Tab/Shift+Tab 焦点陷阱
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    // 自动聚焦关闭按钮
    setTimeout(() => closeBtnRef.current?.focus(), 100)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      // 恢复焦点
      prevFocusRef.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-foreground/40 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={cn(
          'relative w-full bg-card rounded-2xl shadow-modal border border-border',
          'animate-in fade-in zoom-in-95 duration-200',
          'focus:outline-none',
          SIZE[size],
          className
        )}
      >
        {(title || description) && (
          <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
            <div className="min-w-0 flex-1">
              {title && <h2 className="text-section font-semibold text-foreground truncate">{title}</h2>}
              {description && <p className="text-body text-muted-foreground mt-1">{description}</p>}
            </div>
            <button
              ref={closeBtnRef}
              onClick={onClose}
              aria-label="关闭弹窗"
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <X className="size-4" />
            </button>
          </header>
        )}
        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/30 rounded-b-2xl">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
