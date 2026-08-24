"use client"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Droplets,
  Factory,
  FileCheck2,
  Gauge,
  LinkIcon,
  Radiation,
  Recycle,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Sprout,
  Target,
  Volume2,
  Wind,
  Wrench,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { getPermitSummary, type PermitSummary, type LicenseDetail, type LicenseDetailCard } from "@/lib/api"
import { LinksView } from "./links"

const TABS = [
  { key: "analysis", label: "合规分析", icon: ShieldCheck, desc: "管理要素 · 如何管 · 台账监测 · 风险整改" },
  { key: "platforms", label: "政务平台", icon: LinkIcon, desc: "12 个官方申报入口 · 新建自定义平台" },
] as const

type TabKey = (typeof TABS)[number]["key"]

type ElementKey =
  | "water"
  | "air"
  | "noise"
  | "solid"
  | "soil"
  | "radiation"
  | "carbon"
  | "permit"
  | "inspection"

type ManagementElement = {
  key: ElementKey
  name: string
  icon: LucideIcon
  summary: string
  goal: string
  /** 环评批复要求 —— 环评文件及批复中载明的污染防治措施、总量、标准 */
  eia: string[]
  /** 排污许可证载明要求 —— 排放口、限值、许可排放量、自行监测、执行报告、台账 */
  permit: string[]
  /** 上位法律法规与排放标准（兜底依据） */
  basis: string[]
  actions: string[]
  records: string[]
  monitoring: string[]
  risks: string[]
  rectification: string[]
}

/**
 * 9 个生态环境管理要素 —— 每个要素回答"在企业里到底怎么管"。
 * 内容为静态要点（秒开、离线可用），详细方案由 industry_compliance 子代理动态生成。
 */
const ELEMENTS: ManagementElement[] = [
  {
    key: "water",
    name: "水环境",
    icon: Droplets,
    summary: "废水达标 · 排放口规范 · 设施运维",
    goal: "全厂废水清污分流、雨污分流，各排放口稳定达标排放，排放口设置规范化，杜绝偷排漏排。",
    eia: [
      "废水处理设施工艺与规模须与环评及批复一致（中和、沉淀、生化等）",
      "清污分流、雨污分流，初期雨水收集处理，废水回用率符合环评承诺",
      "外排去向与纳污水体/市政管网符合环评批复，不得擅自变更",
      "COD、氨氮等总量控制指标以环评批复核定值为准",
    ],
    permit: [
      "废水排放口编号、位置（DWxxx）与许可证载明一致",
      "各排放口污染物排放限值（mg/L）严格执行",
      "许可排放量（吨/年）不得超总量排污",
      "自行监测因子、频次、方法按许可证执行",
      "执行报告（年报/季报）按期提交",
    ],
    basis: [
      "《中华人民共和国水污染防治法》（2017 修订）",
      "GB 8978-1996《污水综合排放标准》",
      "行业水污染物排放标准（钢铁 GB 13456-2012）",
      "排污许可证载明的排放限值与总量",
    ],
    actions: [
      "厂区实行清污分流、雨污分流，初期雨水收集处理",
      "污水处理设施日常运行与维护，确保稳定达标",
      "排放口规范化：编号、标识牌、计量、采样口",
      "在线监测设备（COD/氨氮/流量）联网并正常运行",
    ],
    records: [
      "污水处理设施运行记录（按日）",
      "加药/药剂消耗记录",
      "水质自行监测记录",
      "废水排放量台账（按月统计）",
    ],
    monitoring: [
      "pH、COD、氨氮、总磷、悬浮物等，按许可证频次",
      "重金属等特征因子按行业标准执行",
      "在线监测 + 定期手工比对",
    ],
    risks: [
      "私设暗管、超越排放口偷排",
      "超标排放、雨水口排污",
      "在线监测数据异常或造假",
    ],
    rectification: [
      "立即停产整治、封堵非法排口",
      "按日计罚、行政处罚",
      "涉嫌犯罪的移送司法机关",
    ],
  },
  {
    key: "air",
    name: "大气环境",
    icon: Wind,
    summary: "废气达标 · 超低排放 · CEMS 联网",
    goal: "有组织排放口稳定达标，落实超低排放要求，无组织排放得到有效控制。",
    eia: [
      "脱硫、脱硝、除尘设施工艺及脱除效率须与环评一致",
      "排气筒数量、高度、内径符合环评批复，不得擅自并排或降低高度",
      "颗粒物 / SO₂ / NOx 排放标准及总量指标以环评批复核定值为准",
      "无组织排放管控措施、卫生防护距离符合环评要求",
    ],
    permit: [
      "废气排放口编号（DAxxx）与许可证载明一致",
      "各排放口污染物排放限值（mg/m³）严格执行",
      "许可排放量（吨/年）不得超总量排污",
      "CEMS 安装联网、数据有效传输率符合许可证要求",
      "自行监测因子、频次按许可证执行",
    ],
    basis: [
      "《中华人民共和国大气污染防治法》（2018 修订）",
      "GB 28665-2012《钢铁烧结、球团工业大气污染物排放标准》",
      "环大气〔2019〕35 号 超低排放意见",
      "排污许可证载明的排放限值",
    ],
    actions: [
      "除尘、脱硫、脱硝设施运维，确保脱除效率",
      "原料场封闭、皮带通廊密闭，控制无组织逸散",
      "CEMS 全覆盖并与生态环境部门联网",
      "提升清洁运输比例（超低排放要求）",
    ],
    records: [
      "废气治理设施运行记录（按日）",
      "脱硫剂/脱硝剂用量记录",
      "CEMS 在线监测数据",
      "无组织排放管控措施记录",
    ],
    monitoring: [
      "颗粒物、SO₂、NOx、氟化物、二噁英等",
      "CEMS 数据有效传输率 ≥95%",
      "手工监测按 HJ 878 及许可证频次",
    ],
    risks: [
      "超标排放、脱除效率下降",
      "CEMS 数据异常或停运未报备",
      "无组织排放逸散（料场/皮带）",
    ],
    rectification: [
      "限产限排、停炉整改",
      "超低排放改造",
      "行政处罚、按日计罚",
    ],
  },
  {
    key: "noise",
    name: "噪声",
    icon: Volume2,
    summary: "厂界达标 · 高噪源隔声 · 夜间管控",
    goal: "厂界噪声昼间、夜间均达标，高噪声源有效隔声减振，避免扰民投诉。",
    eia: [
      "厂界噪声执行标准（GB 12348 类别）以环评批复为准",
      "高噪声源清单及降噪措施（隔声、减振、消声）与环评一致",
      "声环境敏感点预测值及保护措施落实环评要求",
    ],
    permit: [
      "厂界噪声排放限值（昼间/夜间 dB(A)）严格执行",
      "厂界噪声监测频次按许可证执行",
    ],
    basis: [
      "《中华人民共和国噪声污染防治法》（2022 施行）",
      "GB 12348-2008《工业企业厂界环境噪声排放标准》",
    ],
    actions: [
      "高噪声设备（风机、破碎机、磨机）隔声减振",
      "厂界噪声定期监测（昼间/夜间）",
      "夜间作业管控、错峰生产",
    ],
    records: [
      "厂界噪声监测记录",
      "高噪设备维护记录",
    ],
    monitoring: [
      "厂界昼间/夜间等效声级 Leq",
      "敏感点噪声监测",
    ],
    risks: [
      "夜间超标排放",
      "居民投诉或信访",
    ],
    rectification: [
      "隔声改造、加装消声器",
      "调整作业时段",
    ],
  },
  {
    key: "solid",
    name: "固体废物",
    icon: Recycle,
    summary: "分类贮存 · 转移联单 · 资质委托",
    goal: "一般固废与危废分类收集、规范贮存、合法转移处置，全流程可追溯。",
    eia: [
      "固废 / 危废种类、产生量以环评核定为准",
      "贮存设施防渗、防腐、防雨要求落实环评措施",
      "危废委托处置去向（资质单位）符合环评批复",
    ],
    permit: [
      "固废 / 危废管理信息在许可证中如实载明",
      "危废转移联单（五联单）如实执行",
      "固废产生 / 贮存 / 转移 / 处置台账按许可证记录",
    ],
    basis: [
      "《中华人民共和国固体废物污染环境防治法》（2020 修订）",
      "《国家危险废物名录》（2025 年版）",
      "GB 18597/18599 危废/一般固废贮存污染控制标准",
    ],
    actions: [
      "一般固废、危废分类收集、分区贮存",
      "危废标识、贮存场所防渗防腐",
      "危废转移联单（五联单）管理",
      "委托有资质单位处置并签订合同",
    ],
    records: [
      "固废产生/贮存/转移/处置台账",
      "危废管理计划及申报",
      "转移联单存档",
    ],
    monitoring: [
      "贮存场所防渗、渗滤液收集检查",
      "危废标识、标签规范性核查",
    ],
    risks: [
      "非法倾倒、非法转移",
      "危废混入一般固废",
      "超期贮存（危废 ≤1 年）",
    ],
    rectification: [
      "清运处置、规范贮存",
      "行政处罚，涉嫌犯罪的移送司法机关",
    ],
  },
  {
    key: "soil",
    name: "土壤",
    icon: Sprout,
    summary: "隐患排查 · 自行监测 · 防渗防腐",
    goal: "土壤污染隐患排查到位，自行监测按方案执行，防止渗漏污染。",
    eia: [
      "土壤环境影响评价等级、范围与结论落实环评要求",
      "防渗分区（重点 / 一般）及防渗措施符合环评批复",
      "土壤隐患排查、自行监测方案以环评及批复为准",
    ],
    permit: [
      "土壤自行监测因子、频次按许可证执行",
      "重点监管单位隐患排查、监测报告义务落实",
    ],
    basis: [
      "《中华人民共和国土壤污染防治法》（2019 施行）",
      "《工矿用地土壤环境管理办法（试行）》",
      "重点监管单位土壤污染隐患排查指南",
    ],
    actions: [
      "土壤污染隐患排查（重点监管单位）",
      "制定并执行土壤自行监测方案",
      "生产设施防渗、防腐、防泄漏",
      "土壤环境信息公开",
    ],
    records: [
      "隐患排查报告",
      "自行监测数据及报告",
    ],
    monitoring: [
      "土壤重金属、有机物等特征因子",
      "地下水监测（重点监管单位）",
    ],
    risks: [
      "渗漏导致土壤/地下水污染",
      "未开展隐患排查或自行监测",
    ],
    rectification: [
      "调查评估、风险管控",
      "污染修复治理",
    ],
  },
  {
    key: "radiation",
    name: "辐射",
    icon: Radiation,
    summary: "辐射许可 · 人员剂量 · 场所屏蔽",
    goal: "辐射工作单位持证合规，人员与场所辐射安全受控。",
    eia: [
      "辐射环境影响评价（放射源 / 射线装置）结论与批复落实",
      "场所屏蔽设计、防护设施符合环评要求",
    ],
    permit: [
      "辐射安全许可证（而非排污许可证）须持证并在有效期内",
      "个人剂量监测、场所辐射水平监测按许可执行",
    ],
    basis: [
      "《中华人民共和国放射性污染防治法》",
      "《放射性同位素与射线装置安全和防护条例》",
    ],
    actions: [
      "办理辐射安全许可证并按时延续",
      "辐射工作人员培训、个人剂量监测",
      "场所屏蔽防护、警示标识",
      "编制辐射事故应急预案",
    ],
    records: [
      "辐射源/射线装置台账",
      "个人剂量监测档案",
      "培训记录",
    ],
    monitoring: [
      "场所辐射水平监测",
      "个人剂量当量监测",
    ],
    risks: [
      "无证使用、超许可范围",
      "防护不到位、剂量超标",
    ],
    rectification: [
      "补办许可、停用整改",
      "行政处罚",
    ],
  },
  {
    key: "carbon",
    name: "碳排放",
    icon: Factory,
    summary: "核算报告 · 第三方核查 · 配额履约",
    goal: "碳排放数据真实准确，按期完成报送与配额清缴履约。",
    eia: [
      "碳排放评价、能耗指标与环评及批复一致",
      "减污降碳协同措施落实环评要求",
    ],
    permit: [
      "碳排放报送、统一报表按期完成（重点行业）",
      "配额清缴履约（纳入碳排放权交易范围时）",
    ],
    basis: [
      "《碳排放权交易管理办法（试行）》",
      "行业温室气体排放核算方法与报告指南",
    ],
    actions: [
      "温室气体排放核算与月度/年度报告",
      "配合第三方核查",
      "配额清缴履约",
      "碳数据质量管理（活动数据、排放因子）",
    ],
    records: [
      "活动数据、煤质/油质检测报告",
      "排放报告及核查报告",
    ],
    monitoring: [
      "燃煤/燃油含碳量、低位发热量检测",
      "排放因子数据",
    ],
    risks: [
      "数据造假、虚报瞒报",
      "未按期履约清缴",
    ],
    rectification: [
      "补缴配额、核减",
      "行政处罚",
    ],
  },
  {
    key: "permit",
    name: "许可",
    icon: ScrollText,
    summary: "按证排污 · 执行报告 · 信息公开",
    goal: "严格按排污许可证载明事项排污，执行报告、自行监测、信息公开按期落实。",
    eia: [
      "环评批复文号、批复日期及批复要求逐项落实",
      "竣工环境保护自主验收按期完成并公示",
    ],
    permit: [
      "许可证编号、有效期（validFrom / validTo）严格执行",
      "按证排污：排放口、排放限值、许可排放量逐一对照",
      "执行报告（年报 / 季报）按期提交",
      "自行监测方案执行，污染物排放信息公开",
    ],
    basis: [
      "《排污许可管理条例》（2021 施行）",
      "《排污许可管理办法》",
    ],
    actions: [
      "按证排污，排放口/排放限值/总量对照",
      "执行报告（年报/季报）按期提交",
      "自行监测方案执行",
      "污染物排放信息公开",
    ],
    records: [
      "执行报告",
      "自行监测数据",
      "环境管理台账",
    ],
    monitoring: [
      "按许可证载明的因子、频次、方法",
    ],
    risks: [
      "无证排污、超许可排放",
      "执行报告逾期或不实",
      "未按证自行监测",
    ],
    rectification: [
      "按日计罚、责令整改",
      "吊销排污许可证",
    ],
  },
  {
    key: "inspection",
    name: "督察",
    icon: ShieldAlert,
    summary: "问题清单 · 整改方案 · 销号归档",
    goal: "环保督察交办问题整改到位、按期销号，资料闭环归档。",
    eia: [
      "环评批后监管要求（排污许可、验收、监测）纳入整改闭环",
      "环评批复承诺事项未落实项列入问题清单",
    ],
    permit: [
      "许可证改正规定、执法检查交办问题按期整改销号",
      "整改佐证材料（照片 / 报告 / 监测数据）归档备查",
    ],
    basis: [
      "《中央生态环境保护督察工作规定》",
      "省级环保督察相关规定",
    ],
    actions: [
      "建立问题清单、整改台账",
      "制定整改方案（措施/责任/时限）",
      "整改销号、逐项验收",
      "资料归档备查",
    ],
    records: [
      "整改台账、销号材料",
      "佐证材料（照片/报告/监测数据）",
    ],
    monitoring: [
      "整改完成情况跟踪",
    ],
    risks: [
      "整改不力、虚假整改",
      "未按期销号",
    ],
    rectification: [
      "挂牌督办、追责问责",
    ],
  },
]

// ═══════════════ 合规诊断（状态映射）═══════════════

type Tone = "ok" | "warn" | "danger" | "unknown"

type Diagnosis = {
  tone: Tone
  label: string
  detail: string
}

const TONE_DOT: Record<Tone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  danger: "bg-destructive",
  unknown: "bg-muted-foreground/40",
}

const TONE_BADGE: Record<Tone, string> = {
  ok: "border-success/30 bg-success/5 text-success",
  warn: "border-warning/30 bg-warning/5 text-warning",
  danger: "border-destructive/30 bg-destructive/5 text-destructive",
  unknown: "border-border bg-secondary/40 text-muted-foreground",
}

const TONE_RANK: Record<Tone, number> = { danger: 3, warn: 2, ok: 1, unknown: 0 }

/** 每个要素的状态来源字段（对应 permit-data.json 的 parsed） */
const STATUS_KEYS: Record<ElementKey, Array<keyof PermitSummary>> = {
  water: ["monitoringStatus"],
  air: ["monitoringStatus"],
  noise: ["monitoringStatus"],
  solid: [],
  soil: ["monitoringStatus"],
  radiation: [],
  carbon: [],
  permit: ["permitStatus", "executionReportStatus", "validTo"],
  inspection: ["rectificationStatus"],
}

/**
 * 每个管理要素对应的排污许可证详情卡（cardid）。
 * cardid 与后端 LICENSE_CARDS 对齐：6 大气排放口 / 7 有组织排放 / 8 无组织排放 /
 * 9 大气总许可量 / 10 水排放口 / 11 水排放信息 / 12 固废 / 13 工业噪声 /
 * 1 基本情况 / 14 自行监测 / 15 台账记录。
 */
const ELEMENT_LICENSE_CARDS: Partial<Record<ElementKey, string[]>> = {
  water: ["card10", "card11"],
  air: ["card6", "card7", "card8", "card9"],
  noise: ["card13"],
  solid: ["card12"],
  permit: ["card1", "card14", "card15"],
}

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86400000)
}

function diagnoseText(text: string): Diagnosis | null {
  const t = (text || "").trim()
  if (!t || t === "暂无数据" || t === "未读取" || t === "无") return null
  if (/逾期|未提交|超标|异常|处罚|吊销|已过期|停产|造假|违法|不通过/.test(t)) {
    return { tone: "danger", label: "有风险", detail: t }
  }
  if (/尽快|即将|临近|待|补正|预警|整改|催办/.test(t)) {
    return { tone: "warn", label: "需关注", detail: t }
  }
  if (/已提交|审批通过|正常|达标|有效|已整改|已完成|已核验/.test(t)) {
    return { tone: "ok", label: "正常", detail: t }
  }
  return null
}

function diagnoseValidity(validTo: string): Diagnosis | null {
  const days = daysUntil(validTo)
  if (days === null) return null
  if (days < 0) return { tone: "danger", label: "已过期", detail: `已逾期 ${-days} 天` }
  if (days <= 30) return { tone: "danger", label: "即将到期", detail: `剩余 ${days} 天` }
  if (days <= 90) return { tone: "warn", label: "临近到期", detail: `剩余 ${days} 天` }
  return { tone: "ok", label: "有效", detail: `剩余 ${days} 天` }
}

function diagnoseElement(el: ManagementElement, summary: PermitSummary | null): Diagnosis {
  if (!summary) {
    return { tone: "unknown", label: "未读取", detail: "许可证数据未读取，请先登录平台读取" }
  }
  const keys = STATUS_KEYS[el.key]
  if (keys.length === 0) {
    return { tone: "unknown", label: "待核验", detail: "该要素暂无自动数据源，可让 AI 逐项核验" }
  }
  let best: Diagnosis = { tone: "unknown", label: "待核验", detail: "状态数据未读取到，可让 AI 逐项核验" }
  for (const k of keys) {
    let d: Diagnosis | null = null
    if (k === "validTo") {
      d = diagnoseValidity(String(summary.validTo || ""))
    } else {
      d = diagnoseText(String(summary[k] || ""))
    }
    if (d && TONE_RANK[d.tone] > TONE_RANK[best.tone]) best = d
  }
  return best
}

export function IndustryComplianceView() {
  const [activeTab, setActiveTab] = useState<TabKey>("analysis")

  return (
    <div className="flex h-full flex-col">
      {/* Tab Header */}
      <header className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-2">
        <Building2 className="size-4 text-eco-600" />
        <span className="text-body font-semibold text-foreground ml-1.5">行业合规</span>
        <span className="text-caption text-muted-foreground ml-1">industry_compliance</span>

        <div className="ml-6 flex gap-1">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200",
                activeTab === tab.key
                  ? "bg-eco-50 text-eco-700 shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <tab.icon className="size-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        <span className="ml-auto text-caption text-muted-foreground">
          {TABS.find(t => t.key === activeTab)?.desc}
        </span>
      </header>

      {/* Tab Content（内部各自管理滚动） */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "analysis" ? <ComplianceAnalysisTab /> : <LinksView />}
      </div>
    </div>
  )
}

function ComplianceAnalysisTab() {
  const [activeKey, setActiveKey] = useState<ElementKey>("water")
  const [summary, setSummary] = useState<PermitSummary | null>(null)
  const active = ELEMENTS.find(e => e.key === activeKey) ?? ELEMENTS[0]

  useEffect(() => {
    let cancelled = false
    getPermitSummary()
      .then(s => { if (!cancelled) setSummary(s) })
      .catch(() => { if (!cancelled) setSummary(null) })
    return () => { cancelled = true }
  }, [])

  const diagnoses = useMemo(
    () => Object.fromEntries(ELEMENTS.map(e => [e.key, diagnoseElement(e, summary)])) as Record<ElementKey, Diagnosis>,
    [summary],
  )

  return (
    <div className="flex h-full">
      {/* 左：管理要素导航 */}
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-border bg-canvas/50 p-3">
        {summary?.industryCategory && (
          <div className="mb-3 rounded-xl border border-eco-200 bg-eco-50 px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-caption text-eco-700">
              <Factory className="size-3" />
              <span className="font-semibold">已识别行业</span>
            </div>
            <div className="mt-1 truncate text-caption text-eco-800" title={summary.industryCategory}>
              {summary.industryCategory}
              {summary.industryCode && (
                <code className="ml-1 rounded bg-muted px-1 py-0.5 text-caption text-muted-foreground">{summary.industryCode}</code>
              )}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between px-2 pb-2 pt-1">
          <span className="text-caption font-medium uppercase tracking-wider text-muted-foreground">管理要素</span>
          <span className="flex items-center gap-1 text-caption text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" />正常
            <span className="size-1.5 rounded-full bg-warning" />关注
            <span className="size-1.5 rounded-full bg-destructive" />风险
            <span className="size-1.5 rounded-full bg-muted-foreground/40" />待核验
          </span>
        </div>
        <div className="space-y-1.5">
          {ELEMENTS.map(el => {
            const Icon = el.icon
            const isActive = el.key === activeKey
            const diag = diagnoses[el.key] ?? { tone: "unknown" as Tone, label: "待核验", detail: "" }
            return (
              <button
                key={el.key}
                onClick={() => setActiveKey(el.key)}
                aria-pressed={isActive}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all duration-200",
                  isActive
                    ? "border border-eco-200 bg-eco-50 text-eco-800 shadow-sm"
                    : "border border-transparent text-foreground hover:bg-accent",
                )}
              >
                <Icon className={cn("size-4 shrink-0", isActive ? "text-eco-600" : "text-muted-foreground")} />
                <div className="min-w-0 flex-1">
                  <span className="block text-caption font-semibold">{el.name}</span>
                  <span className="block truncate text-caption text-muted-foreground">{el.summary}</span>
                </div>
                <span
                  className={cn("size-2 shrink-0 rounded-full", TONE_DOT[diag.tone])}
                  title={diag.label}
                />
              </button>
            )
          })}
        </div>
      </aside>

      {/* 右：管理方案详情 */}
      <main className="flex-1 overflow-y-auto">
        <ElementDetail el={active} diag={diagnoses[active.key]} industryCode={summary?.industryCode} licenseDetail={summary?.licenseDetail} />
      </main>
    </div>
  )
}

function ElementDetail({ el, diag, industryCode, licenseDetail }: { el: ManagementElement; diag?: Diagnosis; industryCode?: string; licenseDetail?: LicenseDetail }) {
  const Icon = el.icon
  const prefill = `请严格按我企业环评批复和排污许可证载明要求，为「${el.name}」生成一份合规管理自查方案。要求：逐项列出环评批复要求、排污许可证载明事项（排放口编号、限值、许可排放量、自行监测频次、执行报告、台账）、管理动作、法规条款编号、常见不合规项；并结合我企业排污许可证载明的排放口与限值逐条对照。注意：当前处于条例/法典过渡期，法律依据请双版本对照标注。`
  // 该要素对应的许可证详情卡（真实载明内容）
  const licenseCards = useMemo(() => {
    const ids = ELEMENT_LICENSE_CARDS[el.key] || []
    const cards: LicenseDetailCard[] = []
    if (licenseDetail?.ok && licenseDetail.cards) {
      for (const id of ids) {
        const c = licenseDetail.cards[id]
        if (c && c.tables?.length) cards.push(c)
      }
    }
    return cards
  }, [el.key, licenseDetail])

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
      {/* 头部 */}
      <div className="rounded-2xl border border-eco-200 bg-gradient-eco-tint p-5">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-eco-600 text-white shadow-sm">
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-section font-semibold text-foreground">{el.name}管理</h2>
            <p className="mt-0.5 text-caption text-muted-foreground">{el.summary}</p>
          </div>
        </div>
      </div>

      {/* 状态诊断条 */}
      {diag && (
        <div className={cn("flex items-center gap-2.5 rounded-xl border px-4 py-3", TONE_BADGE[diag.tone])}>
          <span className={cn("size-2.5 shrink-0 rounded-full", TONE_DOT[diag.tone])} />
          <span className="text-caption font-semibold">{diag.label}</span>
          <span className="min-w-0 flex-1 truncate text-caption opacity-80" title={diag.detail}>{diag.detail}</span>
        </div>
      )}

      <DimensionCard icon={Target} title="管理目标">
        <p className="text-caption leading-relaxed text-foreground">{el.goal}</p>
      </DimensionCard>

      <DimensionCard icon={FileCheck2} title="环评批复要求">
        <ItemList items={el.eia} />
      </DimensionCard>

      <DimensionCard icon={BadgeCheck} title="排污许可证载明要求">
        {licenseCards.length > 0 ? <LicenseCardTables cards={licenseCards} /> : <ItemList items={el.permit} />}
      </DimensionCard>

      <DimensionCard icon={BookOpen} title="上位法规与标准">
        <ItemList items={el.basis} />
      </DimensionCard>

      <DimensionCard icon={Wrench} title="管理动作">
        <ItemList items={el.actions} />
      </DimensionCard>

      <DimensionCard icon={ClipboardList} title="台账记录">
        <ItemList items={el.records} />
      </DimensionCard>

      <DimensionCard icon={Gauge} title="监测要求">
        <ItemList items={el.monitoring} />
      </DimensionCard>

      <DimensionCard icon={AlertTriangle} title="风险点" tone="warning">
        <ItemList items={el.risks} />
      </DimensionCard>

      <DimensionCard icon={CheckCircle2} title="整改应对" tone="success">
        <ItemList items={el.rectification} />
      </DimensionCard>

      {/* 大气要素附带钢铁行业专项自查清单（仅钢铁行业 C31 显示） */}
      {el.key === "air" && <SteelChecklistSection industryCode={industryCode} />}

      {/* AI 逐项核验 */}
      <div className="flex items-center justify-end gap-3 pt-1">
        <p className="text-caption text-muted-foreground/70">详细方案由子代理动态生成</p>
        <button
          onClick={() =>
            window.dispatchEvent(new CustomEvent("ecopilot:prefill-input", { detail: { text: prefill } }))
          }
          className="rounded-lg bg-eco-600 px-3 py-1.5 text-caption font-medium text-white transition-colors hover:bg-eco-700"
        >
          让 AI 逐项核验
        </button>
      </div>
    </div>
  )
}

function DimensionCard({
  icon: Icon,
  title,
  tone = "default",
  children,
}: {
  icon: LucideIcon
  title: string
  tone?: "default" | "warning" | "success"
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md",
            tone === "warning"
              ? "bg-warning-50 text-warning-600"
              : tone === "success"
                ? "bg-success-50 text-success-600"
                : "bg-eco-50 text-eco-600",
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <h3 className="text-title font-semibold text-foreground">{title}</h3>
      </div>
      {children}
    </section>
  )
}

function ItemList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-caption leading-relaxed text-foreground">
          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-eco-400" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * 许可证详情真实载明内容渲染：把每个数据卡的表格原样渲染为 HTML table。
 * 表格为许可证平台逐卡提取的结构化二维单元格，忠实呈现排放口编号、限值、许可量。
 */
function LicenseCardTables({ cards }: { cards: LicenseDetailCard[] }) {
  return (
    <div className="space-y-3">
      {cards.map((card, i) => (
        <div key={`${card.name}-${i}`} className="overflow-hidden rounded-lg border border-border/70">
          <div className="flex items-center gap-1.5 border-b border-border bg-secondary/40 px-2.5 py-1.5">
            <ScrollText className="size-3.5 text-eco-600" />
            <span className="text-caption font-semibold text-foreground">{card.name}</span>
          </div>
          <div className="space-y-2 p-2">
            {card.tables.map((table, ti) => <LicenseTable key={ti} table={table} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

function LicenseTable({ table }: { table: { rows: string[][] } }) {
  const rows = table.rows || []
  if (rows.length === 0) return null
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0)
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-caption">
        <tbody>
          {rows.map((row, ri) => {
            const cells = [...row]
            while (cells.length < maxCols) cells.push("")
            return (
              <tr key={ri} className={ri === 0 ? "bg-secondary/40" : ri % 2 ? "bg-muted/20" : ""}>
                {cells.map((cell, ci) =>
                  ri === 0 ? (
                    <th key={ci} className="whitespace-nowrap border border-border px-2 py-1.5 text-left font-semibold text-foreground">
                      {cell}
                    </th>
                  ) : (
                    <td key={ci} className="border border-border px-2 py-1.5 align-top text-foreground">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * 钢铁行业专项自查清单（大气要素）
 *
 * GB 28665-2012《钢铁烧结、球团工业大气污染物排放标准》+ 环大气〔2019〕35号 超低排放
 * 可展开查看核查要点，一键让 industry_compliance 子代理逐项核查
 */
function SteelChecklistSection({ industryCode }: { industryCode?: string }) {
  const [open, setOpen] = useState(false)
  // 仅钢铁行业（C31）展示专项自查清单
  if (industryCode !== "C31") return null

  const CHECK_POINTS = [
    { item: "烧结机头/球团焙烧烟气", point: "颗粒物 / SO₂ / NOx / 氟化物 / 二噁英 浓度对照 GB 28665 表2（重点地区执行表3特别排放限值）" },
    { item: "烧结机尾及其他生产设施", point: "颗粒物浓度对照限值，与许可证载明值逐项核对" },
    { item: "无组织排放", point: "原料场/烧结/炼铁车间颗粒物无组织浓度限值；封闭料场、皮带通廊密闭性" },
    { item: "超低排放改造（环大气〔2019〕35号）", point: "烧结机头 颗粒物10 / SO₂ 35 / NOx 50 mg/m³ 达标率≥95%；清洁运输比例" },
    { item: "CEMS 安装联网", point: "烧结机头/机尾 CEMS 全覆盖，与生态环境部门联网，数据有效传输率" },
    { item: "手工监测频次", point: "按 HJ 878 及许可证载明频次执行（氟化物/二噁英等非常规因子）" },
    { item: "台账记录", point: "烧结机运行参数、脱硫脱硝设施运行记录按日记录，保存≥5年（HJ 944 §4）" },
  ]

  const PREFILL = `请按 GB 28665-2012《钢铁烧结、球团工业大气污染物排放标准》和环大气〔2019〕35号超低排放要求，为我生成一份钢铁烧结/球团工序专项合规自查清单。要求：逐项列出核查项、标准限值、法规条款编号、自查方法、常见不符合项；结合我企业许可证载明的排放口和限值逐条对照。注意：当前处于条例/法典过渡期，法律依据请双版本对照标注。`

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-accent/40"
      >
        <ClipboardCheck className="size-4 shrink-0 text-eco-600" />
        <div className="min-w-0 flex-1">
          <span className="text-caption font-semibold text-foreground">钢铁行业专项自查清单</span>
          <span className="ml-2 text-caption text-muted-foreground">
            GB 28665-2012 烧结/球团 + 超低排放 · {CHECK_POINTS.length} 项核查要点
          </span>
        </div>
        {open ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
      </button>

      {open && (
        <div className="space-y-2 border-t border-border px-4 py-3">
          {CHECK_POINTS.map((cp, i) => (
            <div key={i} className="flex gap-2.5 text-caption">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-eco-50 font-medium text-eco-700 tabular-nums">
                {i + 1}
              </span>
              <div className="min-w-0">
                <span className="font-medium text-foreground">{cp.item}</span>
                <p className="mt-0.5 leading-relaxed text-muted-foreground">{cp.point}</p>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 pt-2">
            <p className="text-caption text-muted-foreground/70">限值以标准原文及许可证载明为准</p>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("ecopilot:prefill-input", { detail: { text: PREFILL } }))}
              className="shrink-0 rounded-lg bg-eco-600 px-3 py-1.5 text-caption font-medium text-white transition-colors hover:bg-eco-700"
            >
              让 AI 逐项核查
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
