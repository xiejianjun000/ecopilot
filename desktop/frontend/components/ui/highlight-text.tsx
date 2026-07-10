interface HighlightTextProps {
  text: string
  query: string
  className?: string
}

/** 在 text 中高亮匹配的 query 子串 */
export function HighlightText({ text, query, className }: HighlightTextProps) {
  const q = query.trim()
  if (!q || !text) return <>{text}</>
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className={`rounded bg-warning/20 px-0.5 text-foreground ${className || ''}`}>
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  )
}
