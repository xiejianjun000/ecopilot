export function translateNow(key: string): string {
  const map: Record<string, string> = {
    "ecopilot.nav.dashboard": "仪表盘", "ecopilot.nav.chat": "对话",
    "ecopilot.nav.expert": "专家", "ecopilot.nav.calendar": "日历",
    "ecopilot.nav.links": "政务", "ecopilot.nav.vault": "档案库",
    "ecopilot.nav.kb": "知识库", "ecopilot.nav.connector": "连接器",
    "ecopilot.nav.settings": "设置",
  }
  return map[key] || key
}
