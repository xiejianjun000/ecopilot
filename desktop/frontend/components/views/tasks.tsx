"use client"
import { useEffect, useState, useMemo } from "react"
import {
  Zap, Loader2, RefreshCw, CheckCircle2, AlertTriangle, Clock, Play, Pause,
  ChevronDown, ChevronRight, Calendar, FileText, Shield, FlaskConical,
  Droplet, Recycle, Leaf, AlertOctagon, Sun, BarChart3, Receipt, Factory,
  Filter, Search, Plus, Pencil, X, Trash2
} from "lucide-react"
import { cn } from "@/lib/utils"
import { apiGet, apiPost } from "@/lib/api"

// ─── 类型 ───
type Auto = "full" | "semi" | "manual"
type Status = "running" | "idle" | "error" | "paused" | "never"

interface TaskItem {
  id: string
  category: string
  categoryIcon: typeof Zap
  name: string
  law: string
  frequency: string
  nextRun: string
  lastRun: string
  lastStatus: Status
  auto: Auto
  requiredData: string[]
  enabled: boolean
  description: string
}

interface CategoryGroup {
  key: string
  label: string
  icon: typeof Zap
  items: TaskItem[]
}

// ─── 钢铁行业 31 项合规工作（按 EcoPilot 自动化能力分级）───
const TASKS: TaskItem[] = [
  // 一、排污许可
  { id: "permit-sync", category: "排污许可", categoryIcon: FileText, name: "许可证数据全量同步", law: "《排污许可管理条例》§14；HJ 846-2017", frequency: "每周一次", nextRun: "周日 03:00", lastRun: "—", lastStatus: "never", auto: "full", enabled: true, requiredData: ["平台账号密码"], description: "自动登录 permit.mee.gov.cn 读取 20 张卡 + 16 个顶级模块" },
  { id: "permit-renew-reminder", category: "排污许可", categoryIcon: FileText, name: "许可证到期提醒", law: "条例§14 第2款（届满 60 日前）", frequency: "到期前 90/60/30 天", nextRun: "每日检查", lastRun: "—", lastStatus: "never", auto: "full", enabled: true, requiredData: ["许可证有效期"], description: "提前 90/60/30 天推送延续申请提醒" },
  { id: "permit-change", category: "排污许可", categoryIcon: FileText, name: "许可证变更跟踪", law: "条例§14 第3款（变更后 30 日）", frequency: "每周一次", nextRun: "周日 03:05", lastRun: "—", lastStatus: "never", auto: "semi", enabled: false, requiredData: ["工商变更信息", "新执行标准文件"], description: "检测企业信息/标准变化，提醒 30 日内提交变更申请" },

  // 二、执行报告
  { id: "exec-report-monthly", category: "执行报告", categoryIcon: BarChart3, name: "月报草稿生成", law: "条例§22；HJ 944-2018 §5（每月 10 日前）", frequency: "每月 5 日", nextRun: "每月 5 日 02:00", lastRun: "—", lastStatus: "never", auto: "semi", enabled: true, requiredData: ["生产设施运行记录", "治污设施运行参数", "CEMS 数据"], description: "汇总本月台账数据，生成月报草稿待人工签章" },
  { id: "exec-report-quarterly", category: "执行报告", categoryIcon: BarChart3, name: "季报草稿生成", law: "条例§22；HJ 944-2018 §5（季末 15 日内）", frequency: "每季次月 5 日", nextRun: "次季 5 日 02:00", lastRun: "—", lastStatus: "never", auto: "semi", enabled: true, requiredData: ["季度生产数据", "监测报告"], description: "生成季度执行报告草稿" },
  { id: "exec-report-annual", category: "执行报告", categoryIcon: BarChart3, name: "年报草稿生成", law: "条例§22；环办便函〔2025〕436号（1月31日前）", frequency: "次年 1 月 5 日", nextRun: "次年 1 月 5 日", lastRun: "—", lastStatus: "never", auto: "semi", enabled: true, requiredData: ["全年生产台账", "监测数据", "固废/危废流向", "污染防治投资"], description: "生成统一信息报表年报草稿（替代原执行年报）" },
  { id: "exec-status-check", category: "执行报告", categoryIcon: BarChart3, name: "执行报告提交状态检查", law: "条例§22 第1款", frequency: "每周一次", nextRun: "周日 03:10", lastRun: "—", lastStatus: "never", auto: "full", enabled: true, requiredData: [], description: "扫描月/季/年报提交状态，缺失项告警" },

  // 三、自行监测
  { id: "cems-monitor", category: "自行监测", categoryIcon: FlaskConical, name: "CEMS 数据自动监测", law: "HJ 878-2017 §5.1；HJ 75/HJ 76", frequency: "全年 24h 连续", nextRun: "实时", lastRun: "—", lastStatus: "never", auto: "full", enabled: false, requiredData: ["CEMS 设备对接凭证"], description: "实时采集 CEMS 数据，超标自动告警" },
  { id: "manual-monitor-remind", category: "自行监测", categoryIcon: FlaskConical, name: "手工监测任务提醒", law: "HJ 878-2017 §5.2-§5.4", frequency: "按监测频次（月/季/半年/年）", nextRun: "每周检查", lastRun: "—", lastStatus: "never", auto: "full", enabled: true, requiredData: ["监测方案", "点位坐标"], description: "按监测方案提醒废气无组织/废水/噪声/地下水/土壤的手工监测任务" },
  { id: "monitor-annual-report", category: "自行监测", categoryIcon: FlaskConical, name: "自行监测年度报告生成", law: "HJ 819-2017 §4、§5", frequency: "次年 1 月", nextRun: "次年 1 月 15 日", lastRun: "—", lastStatus: "never", auto: "semi", enabled: true, requiredData: ["全年监测数据", "监测方案"], description: "汇总全年监测数据生成年度报告草稿" },

  // 四、台账记录
  { id: "ledger-patrol", category: "台账记录", categoryIcon: Shield, name: "五类台账条数巡检", law: "HJ 944-2018 §4（保存 ≥5 年）", frequency: "每月一次", nextRun: "每月 1 日 02:00", lastRun: "—", lastStatus: "never", auto: "full", enabled: true, requiredData: [], description: "扫描生产/治污/监测/燃料/固废五类台账条数，0 条告警" },
  { id: "ledger-template", category: "台账记录", categoryIcon: Shield, name: "台账模板填充", law: "HJ 944-2018 附录 A", frequency: "每月一次", nextRun: "每月 1 日 02:30", lastRun: "—", lastStatus: "never", auto: "semi", enabled: false, requiredData: ["DCS 数据", "MES 生产数据", "燃料采购记录"], description: "从 DCS/MES/ERP 抓取数据自动填充五类台账模板" },

  // 五、大气污染防治
  { id: "air-compliance", category: "大气污染防治", categoryIcon: Factory, name: "大气达标自动判定", law: "GB 28662-28665-2012；环大气〔2019〕35号", frequency: "实时", nextRun: "实时", lastRun: "—", lastStatus: "never", auto: "full", enabled: false, requiredData: ["CEMS 实时浓度", "排放标准限值"], description: "基于 CEMS 数据实时判定是否达标，记录超限时段" },
  { id: "ultra-low-assess", category: "大气污染防治", categoryIcon: Factory, name: "超低排放评估监测", law: "环大气〔2019〕35号；环办大气函〔2019〕922号", frequency: "每年一次", nextRun: "每年 12 月", lastRun: "—", lastStatus: "never", auto: "semi", enabled: true, requiredData: ["CEMS 全年小时数据", "无组织监测微站数据", "门禁运输台账"], description: "评估颗粒物 10/SO₂ 35/NOx 50 mg/m³ 达标率 ≥95%" },
  { id: "heavy-weather-response", category: "大气污染防治", categoryIcon: Factory, name: "重污染天气应急响应", law: "《大气法》§96；2020 重污染应急技术指南", frequency: "预警触发时", nextRun: "事件触发", lastRun: "—", lastStatus: "never", auto: "semi", enabled: true, requiredData: ["预警信息接口", "生产限产比例"], description: "接收预警信息，提醒执行一厂一策减排措施" },

  // 六、水污染防治
  { id: "water-compliance", category: "水污染防治", categoryIcon: Droplet, name: "水污染达标管理", law: "GB 13456-2012 及修改单", frequency: "持续", nextRun: "实时", lastRun: "—", lastStatus: "never", auto: "full", enabled: false, requiredData: ["在线监测数据", "手工监测报告"], description: "监控废水排放浓度，总铊半年监测一次提醒" },

  // 七、固废管理
  { id: "solid-waste-ledger", category: "固废管理", categoryIcon: Recycle, name: "一般工业固废台账", law: "《固废法》§36；台账制定指南（2021）", frequency: "每月一次", nextRun: "每月 1 日 03:00", lastRun: "—", lastStatus: "never", auto: "semi", enabled: true, requiredData: ["固废产生系数", "外委利用处置合同", "转移联单"], description: "记录高炉渣/钢渣/除尘灰/脱硫石膏产生与流向" },
  { id: "hazardous-waste-plan", category: "固废管理", categoryIcon: Recycle, name: "危废管理计划备案", law: "《固废法》§78、§79；HJ 1259-2022", frequency: "每年一次", nextRun: "每年 1 月 15 日", lastRun: "—", lastStatus: "never", auto: "semi", enabled: true, requiredData: ["危废种类清单", "贮存设施信息", "转移联单"], description: "每年通过国家危废信息系统备案管理计划，按月申报" },

  // 八、土壤防治
  { id: "soil-hidden-check", category: "土壤防治", categoryIcon: Leaf, name: "土壤隐患排查提醒", law: "《土壤法》§21；HJ 1478-2026（2026.8.15 施行）", frequency: "每 2-3 年一次", nextRun: "按企业排查周期", lastRun: "—", lastStatus: "never", auto: "manual", enabled: true, requiredData: ["有毒有害物质清单", "重点场所设施清单"], description: "提醒每 2-3 年开展土壤和地下水污染隐患排查整治" },
  { id: "soil-self-monitor", category: "土壤防治", categoryIcon: Leaf, name: "土壤地下水自行监测提醒", law: "《土壤法》§21；HJ 1209-2021", frequency: "年/半年", nextRun: "每年 6 月", lastRun: "—", lastStatus: "never", auto: "manual", enabled: true, requiredData: ["监测点位坐标", "监测因子"], description: "提醒表层土壤年测、地下水年测（重点区域半年测）" },
  { id: "toxic-report", category: "土壤防治", categoryIcon: Leaf, name: "有毒有害物质排放年报", law: "《土壤法》§21 第2款第（一）项", frequency: "每年一次", nextRun: "次年 1 月 20 日", lastRun: "—", lastStatus: "never", auto: "semi", enabled: true, requiredData: ["原辅料成分", "生产工艺", "排放监测数据"], description: "基于物料平衡核算有毒有害物质排放数据" },

  // 九、应急预案
  { id: "emergency-plan-review", category: "应急预案", categoryIcon: AlertOctagon, name: "应急预案修订提醒", law: "环发〔2015〕4号；国办发〔2024〕5号", frequency: "每 3 年一次", nextRun: "按备案日期", lastRun: "—", lastStatus: "never", auto: "manual", enabled: true, requiredData: ["备案日期", "风险单元分布图"], description: "每 3 年回顾性评估，重大风险变化时及时修订" },
  { id: "emergency-drill", category: "应急预案", categoryIcon: AlertOctagon, name: "应急演练提醒", law: "国办发〔2024〕5号 §32", frequency: "每年至少 1 次", nextRun: "每年 11 月", lastRun: "—", lastStatus: "never", auto: "manual", enabled: true, requiredData: ["演练脚本", "参演人员清单"], description: "提醒每年至少 1 次综合或专项演练" },

  // 十、清洁生产
  { id: "cleaner-production", category: "清洁生产", categoryIcon: FlaskConical, name: "清洁生产审核提醒", law: "《清洁生产促进法》§27；第38号令 §8", frequency: "每 5 年一轮", nextRun: "按上次审核日期", lastRun: "—", lastStatus: "never", auto: "manual", enabled: true, requiredData: ["上次审核验收日期"], description: "钢铁企业作为「双有」企业，两次审核间隔不得超过 5 年" },

  // 十一、环境信息公开
  { id: "info-disclosure-annual", category: "环境信息公开", categoryIcon: Sun, name: "年度环境信息披露报告", law: "生态环境部令第24号 §7、§12、§14", frequency: "每年 3 月 15 日前", nextRun: "每年 3 月 1 日", lastRun: "—", lastStatus: "never", auto: "full", enabled: true, requiredData: ["执行报告", "监测数据", "环保处罚记录", "碳排放数据"], description: "自动汇总 8 类环境信息，生成依法披露年报草稿" },
  { id: "info-disclosure-temp", category: "环境信息公开", categoryIcon: Sun, name: "临时环境信息披露", law: "生态环境部令第24号 §15、§16", frequency: "事件触发 5 工作日内", nextRun: "事件触发", lastRun: "—", lastStatus: "never", auto: "semi", enabled: true, requiredData: ["法律文书数据库", "行政许可变更记录"], description: "许可变更/处罚/损害赔偿等触发后 5 工作日内披露" },

  // 十二、碳排放
  { id: "carbon-monthly", category: "碳排放管理", categoryIcon: BarChart3, name: "碳排放月度信息化存证", law: "《碳排放权交易管理暂行条例》；2025 钢铁扩围方案", frequency: "每月一次", nextRun: "每月 5 日", lastRun: "—", lastStatus: "never", auto: "semi", enabled: true, requiredData: ["化石燃料消耗量", "低位发热量", "含碳量", "产品产量"], description: "通过全国碳市场管理平台提交关键数据存证" },
  { id: "carbon-annual", category: "碳排放管理", categoryIcon: BarChart3, name: "碳排放年度报告与核查", law: "《企业温室气体排放核算与报告指南 钢铁工业》", frequency: "次年报告", nextRun: "次年 3 月 31 日", lastRun: "—", lastStatus: "never", auto: "semi", enabled: true, requiredData: ["全年能耗数据", "活性数据", "排放因子"], description: "核算 CO₂/CF₄/C₂F₆ 排放，省级核查 8 月 31 日前完成" },
  { id: "carbon-compliance", category: "碳排放管理", categoryIcon: BarChart3, name: "碳配额清缴提醒", law: "国环规气候〔2025〕2号", frequency: "每年一次", nextRun: "每年 12 月", lastRun: "—", lastStatus: "never", auto: "full", enabled: true, requiredData: ["配额账户余额", "经核查排放量"], description: "提醒年末前完成配额清缴履约" },

  // 十三、环境统计
  { id: "env-statistics", category: "环境统计", categoryIcon: BarChart3, name: "排放源统计年报填报", law: "《生态环境统计管理办法》；《排放源统计调查制度》", frequency: "每年 1 月 31 日前", nextRun: "每年 1 月 20 日", lastRun: "—", lastStatus: "never", auto: "full", enabled: true, requiredData: ["全年生产台账", "监测数据", "产排污系数"], description: "自动汇总生成基 101-113 表数据" },

  // 十四、环境保护税
  { id: "env-tax", category: "环境保护税", categoryIcon: Receipt, name: "环保税按季申报", law: "《环境保护税法》§7、§18（季后 15 日）", frequency: "每季次月 10 日", nextRun: "每季次月 10 日", lastRun: "—", lastStatus: "never", auto: "full", enabled: true, requiredData: ["自动监测数据", "产排污系数", "排放标准限值"], description: "按月计算按季申报，浓度低于标准 30%/50% 自动减免判定" },
]

// ─── 分组排序（按字数从短到长：3字 → 4字 → 5字）───
const CATEGORY_ORDER = [
  "排污许可", "执行报告", "自行监测", "台账记录", "固废管理", "土壤防治",
  "应急预案", "清洁生产", "环境统计", "环境保护税",
  "大气污染防治", "水污染防治", "环境信息公开", "碳排放管理",
]

// ─── 辅助函数 ───
const autoMeta: Record<Auto, { label: string; bg: string; text: string; border: string }> = {
  full: { label: "全自动", bg: "bg-success/10", text: "text-success", border: "border-success/30" },
  semi: { label: "半自动", bg: "bg-eco-50", text: "text-eco-700", border: "border-eco-200" },
  manual: { label: "人工辅助", bg: "bg-muted/40", text: "text-muted-foreground", border: "border-border" },
}

const statusMeta: Record<Status, { label: string; color: string; icon: typeof Clock }> = {
  running: { label: "运行中", color: "text-eco-600", icon: Loader2 },
  idle: { label: "已就绪", color: "text-muted-foreground", icon: CheckCircle2 },
  error: { label: "失败", color: "text-destructive", icon: AlertTriangle },
  paused: { label: "已暂停", color: "text-amber-600", icon: Pause },
  never: { label: "未执行", color: "text-muted-foreground/60", icon: Clock },
}

export function TasksView() {
  // P1: 启用状态持久化到 localStorage
  const [tasks, setTasks] = useState<TaskItem[]>(() => {
    try {
      const saved = localStorage.getItem("tasks_enabled_state")
      if (saved) {
        const map: Record<string, boolean> = JSON.parse(saved)
        return TASKS.map(t => ({ ...t, enabled: map[t.id] ?? t.enabled }))
      }
    } catch {}
    return TASKS
  })
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filter, setFilter] = useState<"all" | Auto>("all")
  const [search, setSearch] = useState("")
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState<string | null>(null)
  const [stats, setStats] = useState<{ total: number; enabled: number; full: number; semi: number; manual: number }>({ total: 0, enabled: 0, full: 0, semi: 0, manual: 0 })
  // 新建/编辑任务弹窗
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // P1: 启用状态变化时持久化
  useEffect(() => {
    try {
      const map: Record<string, boolean> = {}
      tasks.forEach(t => { map[t.id] = t.enabled })
      localStorage.setItem("tasks_enabled_state", JSON.stringify(map))
    } catch {}
  }, [tasks])

  // toast 自动消失
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  // 计算统计
  useEffect(() => {
    setStats({
      total: tasks.length,
      enabled: tasks.filter(t => t.enabled).length,
      full: tasks.filter(t => t.auto === "full" && t.enabled).length,
      semi: tasks.filter(t => t.auto === "semi" && t.enabled).length,
      manual: tasks.filter(t => t.auto === "manual" && t.enabled).length,
    })
  }, [tasks])

  // 按 category 分组（按字数排序）
  const grouped = useMemo(() => {
    const filtered = tasks.filter(t => {
      if (filter !== "all" && t.auto !== filter) return false
      if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !t.law.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
    const groups: Record<string, TaskItem[]> = {}
    filtered.forEach(t => {
      if (!groups[t.category]) groups[t.category] = []
      groups[t.category].push(t)
    })
    return CATEGORY_ORDER
      .filter(k => groups[k] && groups[k].length > 0)
      .map(k => ({ key: k, label: k, items: groups[k] }))
  }, [tasks, filter, search])

  // 切换启用状态
  const toggleEnabled = (id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, enabled: !t.enabled } : t))
  }

  // 模拟立即执行
  const runNow = async (id: string) => {
    setRunning(prev => ({ ...prev, [id]: true }))
    setTasks(prev => prev.map(t => t.id === id ? { ...t, lastStatus: "running", lastRun: new Date().toLocaleString("zh-CN") } : t))
    // 模拟执行 2 秒
    await new Promise(r => setTimeout(r, 2000))
    setRunning(prev => ({ ...prev, [id]: false }))
    setTasks(prev => prev.map(t => t.id === id ? { ...t, lastStatus: "idle" } : t))
  }

  // 新建任务
  const openNewTask = () => {
    setEditingTask(null)
    setEditorOpen(true)
  }

  // 编辑任务
  const openEditTask = (task: TaskItem) => {
    setEditingTask(task)
    setEditorOpen(true)
  }

  // 保存任务（新建或编辑）
  const saveTask = (task: TaskItem) => {
    if (editingTask) {
      // 编辑现有
      setTasks(prev => prev.map(t => t.id === task.id ? task : t))
      setToast(`已更新任务「${task.name}」`)
    } else {
      // 新建
      setTasks(prev => [...prev, task])
      setToast(`已新建任务「${task.name}」`)
    }
    setEditorOpen(false)
    setEditingTask(null)
    setTimeout(() => setToast(null), 2500)
  }

  // 删除任务
  const deleteTask = (id: string) => {
    const task = tasks.find(t => t.id === id)
    setTasks(prev => prev.filter(t => t.id !== id))
    setConfirmDeleteId(null)
    setToast(`已删除任务「${task?.name || id}」`)
    setTimeout(() => setToast(null), 2500)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header — 模块标识已上移至 chat-main 统一 PageHeader */}
      <header className="flex items-center justify-between border-b border-border px-6 py-2.5">
        <p className="text-caption text-muted-foreground">钢铁行业 31 项合规工作 · 自动化执行与提醒</p>
        <div className="flex items-center gap-2">
          <button
            onClick={openNewTask}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground shadow-sm hover:bg-accent transition-colors"
          >
            <Plus className="size-3.5" /> 新建任务
          </button>
          <button
            onClick={() => {
              // P1: 全部同步——将所有启用的任务状态设为 running 后逐步执行
              setToast("开始同步所有启用的任务...")
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-eco-600 px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-eco-700 transition-colors"
          >
            <RefreshCw className="size-3.5" /> 全部同步
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto bg-canvas p-6">
        {/* 统计卡 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-caption text-muted-foreground">已启用任务</span>
              <Zap className="size-4 text-eco-600" />
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-display font-bold tabular-nums text-foreground">{stats.enabled}</span>
              <span className="text-xs text-muted-foreground">/ {stats.total}</span>
            </div>
          </div>
          <div className="rounded-xl border border-success/30 bg-success/5 p-4">
            <div className="flex items-center justify-between">
              <span className="text-caption text-muted-foreground">全自动</span>
              <CheckCircle2 className="size-4 text-success" />
            </div>
            <div className="mt-1 text-display font-bold tabular-nums text-success">{stats.full}</div>
          </div>
          <div className="rounded-xl border border-eco-200 bg-eco-50/50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-caption text-muted-foreground">半自动</span>
              <Loader2 className="size-4 text-eco-600" />
            </div>
            <div className="mt-1 text-display font-bold tabular-nums text-eco-700">{stats.semi}</div>
          </div>
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <div className="flex items-center justify-between">
              <span className="text-caption text-muted-foreground">人工辅助</span>
              <Clock className="size-4 text-muted-foreground" />
            </div>
            <div className="mt-1 text-display font-bold tabular-nums text-muted-foreground">{stats.manual}</div>
          </div>
        </div>

        {/* 筛选 + 搜索 */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            <Filter className="size-3.5 text-muted-foreground ml-1.5" />
            {([
              { k: "all", label: "全部" },
              { k: "full", label: "全自动" },
              { k: "semi", label: "半自动" },
              { k: "manual", label: "人工辅助" },
            ] as const).map(f => (
              <button
                key={f.k}
                onClick={() => setFilter(f.k)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  filter === f.k ? "bg-eco-600 text-white" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索任务或法规..."
              aria-label="搜索任务或法规"
              className="w-full rounded-lg border border-border bg-card pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-eco-300"
            />
          </div>
        </div>

        {/* 任务分组列表 */}
        <div className="space-y-3">
          {grouped.map(group => {
            // 取组内第一项的图标
            const GroupIcon = group.items[0].categoryIcon
            const enabledCount = group.items.filter(t => t.enabled).length
            return (
              <div key={group.key} className="rounded-xl border border-border bg-card overflow-hidden">
                {/* 组标题 */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30">
                  <div className="flex items-center gap-2">
                    <GroupIcon className="size-4 text-eco-600" />
                    <span className="text-body font-medium text-foreground">{group.label}</span>
                    <span className="text-caption text-muted-foreground tabular-nums">{enabledCount}/{group.items.length}</span>
                  </div>
                </div>
                {/* 任务项 */}
                <div className="divide-y divide-border">
                  {group.items.map(task => {
                    const isExpanded = expanded === task.id
                    const auto = autoMeta[task.auto]
                    const status = statusMeta[task.lastStatus]
                    const StatusIcon = status.icon
                    const isRunning = running[task.id] || task.lastStatus === "running"
                    return (
                      <div key={task.id} className={cn("transition-colors", !task.enabled && "opacity-50")}>
                        <div className="flex items-center gap-3 px-4 py-3">
                          {/* 状态指示 */}
                          <StatusIcon className={cn("size-4 shrink-0", status.color, isRunning && "animate-spin")} />
                          {/* 主信息 */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-body font-medium text-foreground truncate">{task.name}</span>
                              <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-caption font-medium", auto.bg, auto.text, auto.border)}>
                                {auto.label}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-caption text-muted-foreground">
                              <span className="truncate">{task.law}</span>
                            </div>
                          </div>
                          {/* 频次/下次 */}
                          <div className="hidden md:flex flex-col items-end shrink-0 text-caption text-muted-foreground">
                            <span className="text-foreground/80">{task.frequency}</span>
                            <span>下次: {task.nextRun}</span>
                          </div>
                          {/* 操作 */}
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => runNow(task.id)}
                              disabled={!task.enabled || isRunning}
                              aria-label="立即执行"
                              title="立即执行"
                              className="rounded-lg p-1.5 text-muted-foreground hover:text-eco-600 hover:bg-eco-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              <Play className="size-3.5" />
                            </button>
                            <button
                              onClick={() => toggleEnabled(task.id)}
                              aria-label={task.enabled ? "停用" : "启用"}
                              title={task.enabled ? "停用" : "启用"}
                              className={cn(
                                "rounded-lg p-1.5 transition-colors",
                                task.enabled ? "text-eco-600 hover:bg-eco-50" : "text-muted-foreground hover:bg-accent"
                              )}
                            >
                              {task.enabled ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                            </button>
                            <button
                              onClick={() => openEditTask(task)}
                              aria-label="编辑任务"
                              title="编辑任务"
                              className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              onClick={() => setExpanded(isExpanded ? null : task.id)}
                              aria-label={isExpanded ? "收起详情" : "展开详情"}
                              title={isExpanded ? "收起详情" : "展开详情"}
                              className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent transition-colors"
                            >
                              {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                            </button>
                          </div>
                        </div>
                        {/* 展开详情 */}
                        {isExpanded && (
                          <div className="px-4 py-3 bg-muted/20 border-t border-border">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                              <div>
                                <div className="text-caption font-medium text-muted-foreground mb-1">任务说明</div>
                                <div className="text-foreground/80">{task.description}</div>
                              </div>
                              <div>
                                <div className="text-caption font-medium text-muted-foreground mb-1">所需资料</div>
                                {task.requiredData.length === 0 ? (
                                  <div className="text-success">✓ 已具备（无需额外数据）</div>
                                ) : (
                                  <ul className="space-y-0.5">
                                    {task.requiredData.map((d, i) => (
                                      <li key={i} className="flex items-center gap-1.5 text-foreground/80">
                                        <span className="size-1 rounded-full bg-eco-500" />
                                        {d}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              <div>
                                <div className="text-caption font-medium text-muted-foreground mb-1">法规依据</div>
                                <div className="text-foreground/80">{task.law}</div>
                              </div>
                              <div>
                                <div className="text-caption font-medium text-muted-foreground mb-1">执行历史</div>
                                <div className="text-foreground/80">
                                  上次: {task.lastRun === "—" ? "—" : `${task.lastRun} · ${status.label}`}
                                </div>
                              </div>
                            </div>
                            {/* 删除按钮 — 放在详情区避免误触 */}
                            <div className="mt-3 pt-3 border-t border-border/60 flex justify-end">
                              <button
                                onClick={() => setConfirmDeleteId(task.id)}
                                aria-label="删除任务"
                                title="删除任务"
                                className="inline-flex items-center gap-1 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1 text-caption text-destructive hover:bg-destructive/10 transition-colors"
                              >
                                <Trash2 className="size-3" /> 删除任务
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* P1: 筛选无结果空态 */}
          {grouped.length === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
              <Search className="mx-auto size-8 text-muted-foreground/40 mb-2" />
              <div className="text-body font-medium text-foreground">未找到匹配的任务</div>
              <div className="text-caption text-muted-foreground mt-1">尝试更换关键词或清除筛选条件</div>
              <button onClick={() => { setSearch(""); setFilter("all") }} className="mt-3 text-xs text-eco-600 hover:text-eco-700 font-medium">清除筛选</button>
            </div>
          )}
        </div>

        {/* 底部说明 */}
        <div className="mt-6 rounded-xl border border-eco-200 bg-eco-50/40 p-4 text-xs text-eco-800">
          <div className="flex items-start gap-2">
            <Zap className="size-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium mb-1">关于自动化分级</div>
              <div className="space-y-1 text-eco-700">
                <div><span className="font-medium text-success">全自动</span>：系统定时自动执行，无需人工干预（如数据同步、达标判定、报告生成）</div>
                <div><span className="font-medium text-eco-700">半自动</span>：系统自动汇总数据生成草稿，需人工核对签章后提交（如执行报告、台账）</div>
                <div><span className="font-medium text-muted-foreground">人工辅助</span>：系统按周期提醒，需第三方机构现场作业（如土壤排查、应急预案、清洁生产审核）</div>
              </div>
              <div className="mt-2 text-caption text-muted-foreground">基于钢铁行业（C31）重点管理排污单位 31 项合规工作整理 · 法规截至 2026 年</div>
            </div>
          </div>
        </div>
      </div>

      {/* P1: toast 提示 */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg bg-foreground px-4 py-2.5 text-xs text-background shadow-lg animate-in fade-in slide-in-from-bottom-2">
          {toast}
        </div>
      )}

      {/* 新建/编辑任务弹窗 */}
      {editorOpen && (
        <TaskEditorModal
          task={editingTask}
          onSave={saveTask}
          onClose={() => { setEditorOpen(false); setEditingTask(null) }}
        />
      )}

      {/* 删除确认弹窗 */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-[360px] rounded-2xl border border-border bg-popover p-5 shadow-lg animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="size-5 text-destructive" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-body font-semibold text-foreground">确认删除任务？</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  删除后无法恢复。任务「{tasks.find(t => t.id === confirmDeleteId)?.name}」将被永久移除。
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => deleteTask(confirmDeleteId)}
                className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-white hover:bg-destructive/90 transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 任务编辑弹窗组件 ───
function TaskEditorModal({ task, onSave, onClose }: {
  task: TaskItem | null
  onSave: (task: TaskItem) => void
  onClose: () => void
}) {
  const isEdit = !!task
  const [form, setForm] = useState<TaskItem>(() => task ? { ...task } : {
    id: `custom-${Date.now()}`,
    category: "自定义任务",
    categoryIcon: Zap,
    name: "",
    law: "",
    frequency: "每月一次",
    nextRun: "—",
    lastRun: "—",
    lastStatus: "never",
    auto: "semi",
    requiredData: [],
    enabled: true,
    description: "",
  })

  const update = (patch: Partial<TaskItem>) => setForm(prev => ({ ...prev, ...patch }))
  const [requiredDataText, setRequiredDataText] = useState(form.requiredData.join("\n"))

  const handleSubmit = () => {
    if (!form.name.trim()) return
    const finalTask: TaskItem = {
      ...form,
      requiredData: requiredDataText.split("\n").map(s => s.trim()).filter(Boolean),
    }
    onSave(finalTask)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-[560px] max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-popover shadow-lg animate-in zoom-in-95 slide-in-from-bottom-2 duration-200">
        {/* 头部 */}
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-popover px-5 py-3.5 z-10">
          <div className="flex items-center gap-2.5">
            <div className={cn("flex size-8 items-center justify-center rounded-lg", isEdit ? "bg-eco-50 text-eco-600" : "bg-eco-600 text-white")}>
              {isEdit ? <Pencil className="size-4" /> : <Plus className="size-4" />}
            </div>
            <h2 className="text-body font-semibold text-foreground">{isEdit ? "编辑任务" : "新建任务"}</h2>
          </div>
          <button onClick={onClose} aria-label="关闭" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
            <X className="size-4" />
          </button>
        </div>

        {/* 表单 */}
        <div className="px-5 py-4 space-y-4">
          {/* 任务名称 */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">任务名称 <span className="text-destructive">*</span></label>
            <input
              value={form.name}
              onChange={e => update({ name: e.target.value })}
              placeholder="如：月度排放数据归档"
              autoFocus
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-eco-500/30 focus:border-eco-400"
            />
          </div>

          {/* 分类 + 自动化等级 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">任务分类</label>
              <input
                value={form.category}
                onChange={e => update({ category: e.target.value })}
                placeholder="如：执行报告"
                list="task-categories"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-eco-500/30 focus:border-eco-400"
              />
              <datalist id="task-categories">
                {CATEGORY_ORDER.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">自动化等级</label>
              <div className="flex rounded-lg border border-border p-0.5">
                {([
                  { k: "full", label: "全自动" },
                  { k: "semi", label: "半自动" },
                  { k: "manual", label: "人工辅助" },
                ] as const).map(o => (
                  <button
                    key={o.k}
                    onClick={() => update({ auto: o.k })}
                    className={cn(
                      "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                      form.auto === o.k ? "bg-eco-600 text-white" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 执行频次 + 下次执行 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">执行频次</label>
              <input
                value={form.frequency}
                onChange={e => update({ frequency: e.target.value })}
                placeholder="如：每月一次"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-eco-500/30 focus:border-eco-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">下次执行</label>
              <input
                value={form.nextRun}
                onChange={e => update({ nextRun: e.target.value })}
                placeholder="如：每月 1 日 02:00"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-eco-500/30 focus:border-eco-400"
              />
            </div>
          </div>

          {/* 法规依据 */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">法规依据</label>
            <input
              value={form.law}
              onChange={e => update({ law: e.target.value })}
              placeholder="如：《排污许可管理条例》§14"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-eco-500/30 focus:border-eco-400"
            />
          </div>

          {/* 任务说明 */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">任务说明</label>
            <textarea
              value={form.description}
              onChange={e => update({ description: e.target.value })}
              placeholder="描述任务的具体内容和目标"
              rows={2}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-eco-500/30 focus:border-eco-400 resize-none"
            />
          </div>

          {/* 所需资料（多行） */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">所需资料 <span className="text-muted-foreground/60">（每行一项，留空表示无需额外数据）</span></label>
            <textarea
              value={requiredDataText}
              onChange={e => setRequiredDataText(e.target.value)}
              placeholder={"如：\nCEMS 数据\n生产设施运行记录"}
              rows={3}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-eco-500/30 focus:border-eco-400 resize-none font-mono"
            />
          </div>

          {/* 启用开关 */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={e => update({ enabled: e.target.checked })}
              className="accent-eco-600 size-4"
            />
            <span className="text-body text-foreground">启用此任务</span>
          </label>
        </div>

        {/* 底部操作 */}
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-popover px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!form.name.trim()}
            className="rounded-lg bg-eco-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-eco-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isEdit ? "保存修改" : "创建任务"}
          </button>
        </div>
      </div>
    </div>
  )
}
