// ═══════════════ EcoPilot 核心类型 ═══════════════

/** 许可证信息 */
export interface PermitInfo {
  enterpriseName: string
  permitNumber: string
  creditCode: string
  validFrom: string
  validTo: string
  industryCategory: string
  managementLevel: string
  address?: string
  province?: string
  city?: string
  county?: string
  emissionOutlets: EmissionOutlet[]
  managementRequirements: ManagementRequirement[]
  executionReportStatus?: string
  permitStatus?: string
  reapplicationHistory?: { name: string; status: string; date: string }[]
}

export interface EmissionOutlet {
  code: string
  name: string
  type?: string
  latitude?: number
  longitude?: number
  limits: { factor: string; value: string }[]
}

export interface ManagementRequirement {
  category: string
  content: string
  frequency?: string
}

/** 合规态势 */
export interface ComplianceSnapshot {
  daysRemaining: number
  expiryStatus: 'normal' | 'urgent' | 'expired'
  pendingCount: number
  urgentCount: number
  ledgerRate: number
  ledgerMissing: number
  complianceScores: ComplianceScore[]
  calendarEvents: CalendarEvent[]
  alerts: Alert[]
}

export interface ComplianceScore {
  label: string
  key: string
  score: number
  color: string
}

export interface CalendarEvent {
  date: string
  title: string
  level: 'urgent' | 'warn' | 'normal'
  desc: string
}

export interface Alert {
  level: 'urgent' | 'warn'
  icon: string
  title: string
  desc: string
}

/** 对话 */
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  pending?: boolean
  error?: string
  /** 用户消息附件（dataUrl 格式，仅图片直接预览） */
  attachments?: { name: string; dataUrl: string }[]
  /** Hermes 风格：思考过程 */
  reasoning?: string
  /** Hermes 风格：工具调用列表 */
  toolCalls?: { name: string; args?: string; result?: string }[]
}

/** 会话 */
export interface Conversation {
  id: string
  title: string
  lastMessage: string
  /** 显示用时间 "HH:MM" */
  time: string
  /** ISO 时间戳，用于分组（今日/昨日/更早） */
  timestamp: string
  unread: boolean
  active?: boolean
  messages: Message[]
}

/** 活跃视图 */
export type ActiveNav = 'chat' | 'dashboard'
export type ActiveView = 'inspection' | 'calendar' | 'links' | 'vault' | 'knowledge' | 'connector' | 'settings' | 'tasks' | 'notify'

/** 工具调用名 → 友好名称（单一来源，避免 chat-main 与 chat-message 重复定义） */
export const TOOL_LABELS: Record<string, string> = {
  check_permit_status: "检查许可证状态",
  check_report_status: "检查执行报告",
  check_monitoring_data: "检查监测数据",
  check_ledger_status: "检查台账状态",
  check_compliance: "合规态势分析",
  search_knowledge: "知识库检索",
  get_permit_info: "获取许可证信息",
  permit_quick_check: "快速许可检查",
  permit_report_status: "许可报告状态",
  monitoring_check: "监测数据检查",
  carbon_check: "碳排放检查",
  knowledge_search: "知识检索",
  permit_login_guide: "登录引导",
  platform_login: "平台登录",
  platform_list: "平台列表",
  vault_guide: "档案库引导",
}
