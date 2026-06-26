/**
 * 排污许可证 OCR 结果解析与结构化
 *
 * 从 AI vision_analyze 返回的文本中提取结构化字段。
 * 支持多种许可证格式（PDF 文本提取、图片 OCR、平台页面抓取）。
 */

export interface PermitInfo {
  /** 企业名称 */
  enterpriseName: string
  /** 统一社会信用代码 */
  creditCode: string
  /** 排污许可证编号 */
  permitNumber: string
  /** 发证机关 */
  issuingAuthority: string
  /** 发证日期 */
  issueDate: string
  /** 有效期起始 */
  validFrom: string
  /** 有效期截止 */
  validTo: string
  /** 行业类别 */
  industryCategory: string
  /** 行业代码 */
  industryCode: string
  /** 管理类别 */
  managementLevel: '重点管理' | '简化管理' | '登记管理' | '未知'
  /** 生产经营场所地址 */
  address: string
  /** 法定代表人 */
  legalRepresentative: string

  /** 主要排放口 */
  emissionOutlets: EmissionOutlet[]
  /** 管理要求清单 */
  managementRequirements: ManagementRequirement[]
}

export interface EmissionOutlet {
  /** 排放口编号 */
  code: string
  /** 排放口名称 */
  name: string
  /** 排放口类型：主要/一般/特殊 */
  type: '主要' | '一般' | '特殊'
  /** 管控因子及限值 */
  limits: EmissionLimit[]
}

export interface EmissionLimit {
  /** 因子名称（COD/NH3-N/SO₂/NOx/颗粒物等） */
  factor: string
  /** 排放限值 */
  limit: number
  /** 单位 */
  unit: string
  /** 标准来源 */
  standardSource: string
}

export interface ManagementRequirement {
  /** 要求类别 */
  category: '自行监测' | '台账记录' | '执行报告' | '信息公开' | '其他'
  /** 具体要求内容 */
  content: string
  /** 执行频次 */
  frequency: string
}

/** 从 OCR 文本中解析许可证信息 */
export function parsePermitFromText(ocrText: string): Partial<PermitInfo> {
  const info: Partial<PermitInfo> = {}

  // 许可证编号：数字+字母组合，通常包含统一社会信用代码前缀
  const permitMatch = ocrText.match(/(\d{18}[A-Za-z0-9]{5})/)
  if (permitMatch) info.permitNumber = permitMatch[1]

  // 企业名称：常见前缀模式
  const namePatterns = [
    /企业名称[：:]\s*(.+?)(?:\n|$)/,
    /单位名称[：:]\s*(.+?)(?:\n|$)/,
    /排污单位名称[：:]\s*(.+?)(?:\n|$)/,
  ]
  for (const pattern of namePatterns) {
    const match = ocrText.match(pattern)
    if (match) { info.enterpriseName = match[1].trim(); break }
  }

  // 统一社会信用代码
  const creditMatch = ocrText.match(/统一社会信用代码[：:]\s*(\d{18})/)
  if (creditMatch) info.creditCode = creditMatch[1]

  // 行业类别
  const industryMatch = ocrText.match(/行业类别[：:]\s*(.+?)(?:\n|$)/)
  if (industryMatch) info.industryCategory = industryMatch[1].trim()

  // 有效期
  const validMatch = ocrText.match(/有效期限[：:]\s*(\d{4}[./-]\d{1,2}[./-]\d{1,2})\s*[至到~-]\s*(\d{4}[./-]\d{1,2}[./-]\d{1,2})/)
  if (validMatch) {
    info.validFrom = validMatch[1]
    info.validTo = validMatch[2]
  }

  // 发证机关
  const authorityMatch = ocrText.match(/(?:发证机关|发证部门)[：:]\s*(.+?)(?:\n|$)/)
  if (authorityMatch) info.issuingAuthority = authorityMatch[1].trim()

  // 管理类别
  if (ocrText.includes('重点管理')) info.managementLevel = '重点管理'
  else if (ocrText.includes('简化管理')) info.managementLevel = '简化管理'
  else if (ocrText.includes('登记管理')) info.managementLevel = '登记管理'
  else info.managementLevel = '未知'

  // 生产经营场所地址
  const addrMatch = ocrText.match(/生产经营场所地址[：:]\s*(.+?)(?:\n|$)/)
  if (addrMatch) info.address = addrMatch[1].trim()

  // 法定代表人
  const legalMatch = ocrText.match(/法定代表人[：:]\s*(.+?)(?:\n|$)/)
  if (legalMatch) info.legalRepresentative = legalMatch[1].trim()

  return info
}

/** 根据行业类别推断常见排放因子 */
export function inferEmissionFactors(industry: string): string[] {
  const industryFactors: Record<string, string[]> = {
    '黑色金属冶炼': ['COD', 'NH3-N', 'SO₂', 'NOx', '颗粒物', '总氮', '总磷', '石油类', '挥发酚', '氰化物'],
    '钢压延加工': ['COD', 'NH3-N', 'SO₂', 'NOx', '颗粒物', '石油类'],
    '火力发电': ['SO₂', 'NOx', '颗粒物', '汞及其化合物'],
    '水泥制造': ['SO₂', 'NOx', '颗粒物', '氟化物', '氨'],
    '化工': ['COD', 'NH3-N', '总氮', '总磷', '特征污染物'],
  }

  for (const [key, factors] of Object.entries(industryFactors)) {
    if (industry.includes(key)) return factors
  }

  // 默认常见因子
  return ['COD', 'NH3-N', 'SO₂', 'NOx', '颗粒物']
}

/** 计算许可证到期剩余天数 */
export function daysUntilExpiry(validTo: string): number {
  if (!validTo) return 0
  const expiry = new Date(validTo.replace(/[./]/g, '-'))
  const today = new Date()
  const diff = expiry.getTime() - today.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

/** 到期状态 */
export type ExpiryStatus = 'safe' | 'warning' | 'urgent' | 'expired'

export function getExpiryStatus(days: number): ExpiryStatus {
  if (days <= 0) return 'expired'
  if (days <= 30) return 'urgent'
  if (days <= 90) return 'warning'
  return 'safe'
}
