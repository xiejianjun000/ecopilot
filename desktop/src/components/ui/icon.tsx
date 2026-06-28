const ICON_MAP: Record<string, string> = {
  "chart-bar": "📊", message: "💬", brain: "🧠", calendar: "🗓️",
  "external-link": "🔗", folder: "📁", "book-2": "📚",
  "plug-connected": "🔌", settings: "⚙️", search: "🔍",
  "chevron-left": "◀",
}
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <span style={{ fontSize: size, lineHeight: 1 }}>{ICON_MAP[name] || "●"}</span>
}
