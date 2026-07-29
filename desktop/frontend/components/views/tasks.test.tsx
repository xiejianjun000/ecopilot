import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import React from 'react'

// ─── Mocks (hoisted before imports by vitest) ───

vi.mock('lucide-react', () => {
  const iconNames = [
    'Zap', 'CheckCircle2', 'XCircle', 'Loader2', 'Clock', 'Play',
    'ChevronRight', 'RefreshCw', 'AlertTriangle', 'RotateCcw',
    'Settings2', 'Trash2', 'Plus', 'GripVertical', 'ArrowUp',
    'ArrowDown', 'Pencil', 'Save', 'X', 'Pause', 'ChevronDown',
    'Calendar', 'FileText', 'Shield', 'FlaskConical', 'Droplet',
    'Recycle', 'Leaf', 'AlertOctagon', 'Sun', 'BarChart3', 'Receipt',
    'Factory', 'Filter', 'Search',
  ]
  const icons: Record<string, React.FC<{ className?: string }>> = {}
  for (const name of iconNames) {
    icons[name] = ({ className }: { className?: string }) =>
      React.createElement('svg', { 'data-testid': `icon-${name}`, className })
  }
  return icons
})

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/lib/api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}))

// ─── Import after mocks ───

import { TasksView } from './tasks'

// ─── Constants derived from the static TASKS array ───

const DISABLED_TASK_IDS = [
  'permit-change',
  'cems-monitor',
  'ledger-template',
  'air-compliance',
  'water-compliance',
]
const TOTAL_TASKS = 31
const ENABLED_TASKS = TOTAL_TASKS - DISABLED_TASK_IDS.length // 26

// ─── Tests ───

describe('TasksView', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  // ── Basic Render ──

  it('renders without crashing', () => {
    const { container } = render(<TasksView />)
    expect(container).toBeInTheDocument()
  })

  it('shows header subtitle', () => {
    render(<TasksView />)
    expect(
      screen.getByText('钢铁行业 31 项合规工作 · 自动化执行与提醒'),
    ).toBeInTheDocument()
  })

  it('renders all 14 category group headers', () => {
    render(<TasksView />)
    const categories = [
      '排污许可',
      '执行报告',
      '自行监测',
      '台账记录',
      '大气污染防治',
      '水污染防治',
      '固废管理',
      '土壤防治',
      '应急预案',
      '清洁生产',
      '环境信息公开',
      '碳排放管理',
      '环境统计',
      '环境保护税',
    ]
    for (const cat of categories) {
      expect(screen.getByText(cat)).toBeInTheDocument()
    }
  })

  it('renders spot-checked task names across categories', () => {
    render(<TasksView />)
    const names = [
      '许可证数据全量同步',
      '月报草稿生成',
      'CEMS 数据自动监测',
      '五类台账条数巡检',
      '大气达标自动判定',
      '一般工业固废台账',
      '应急预案修订提醒',
      '碳排放月度信息化存证',
      '环保税按季申报',
    ]
    for (const name of names) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
  })

  it('shows correct counts of enabled/disabled toggle buttons', () => {
    render(<TasksView />)
    expect(screen.getAllByLabelText('停用')).toHaveLength(ENABLED_TASKS)
    expect(screen.getAllByLabelText('启用')).toHaveLength(DISABLED_TASK_IDS.length)
  })

  it('disables play buttons on disabled tasks', () => {
    render(<TasksView />)
    const allPlayBtns = screen.getAllByLabelText('立即执行')
    expect(allPlayBtns).toHaveLength(TOTAL_TASKS)
    const disabledCount = allPlayBtns.filter(b => b.hasAttribute('disabled')).length
    expect(disabledCount).toBe(DISABLED_TASK_IDS.length)
  })

  // ── Stat Cards ──

  it('displays stat cards with automation level breakdowns', () => {
    render(<TasksView />)
    // these labels appear in stat cards (and also elsewhere as filter buttons + badges)
    // use getAllByText to confirm they exist at least once
    expect(screen.getAllByText('已启用任务').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('全自动').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('半自动').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('人工辅助').length).toBeGreaterThanOrEqual(1)
  })

  // ── Filtering ──

  it('filters to show only 全自动 tasks', () => {
    render(<TasksView />)
    fireEvent.click(screen.getByRole('button', { name: '全自动' }))
    // full-auto tasks visible
    expect(screen.getByText('许可证数据全量同步')).toBeInTheDocument()
    // semi-auto tasks hidden
    expect(screen.queryByText('月报草稿生成')).not.toBeInTheDocument()
    // manual tasks hidden
    expect(screen.queryByText('土壤隐患排查提醒')).not.toBeInTheDocument()
  })

  it('filters to show only 半自动 tasks', () => {
    render(<TasksView />)
    fireEvent.click(screen.getByRole('button', { name: '半自动' }))
    expect(screen.getByText('月报草稿生成')).toBeInTheDocument()
    expect(screen.queryByText('CEMS 数据自动监测')).not.toBeInTheDocument()
    expect(screen.queryByText('土壤隐患排查提醒')).not.toBeInTheDocument()
  })

  it('filters to show only 人工辅助 tasks', () => {
    render(<TasksView />)
    fireEvent.click(screen.getByRole('button', { name: '人工辅助' }))
    expect(screen.getByText('土壤隐患排查提醒')).toBeInTheDocument()
    expect(screen.queryByText('许可证数据全量同步')).not.toBeInTheDocument()
    expect(screen.queryByText('月报草稿生成')).not.toBeInTheDocument()
  })

  // ── Search ──

  it('filters tasks by name search (case-insensitive)', () => {
    render(<TasksView />)
    fireEvent.change(screen.getByLabelText('搜索任务或法规'), {
      target: { value: 'cems' },
    })
    expect(screen.getByText('CEMS 数据自动监测')).toBeInTheDocument()
    expect(screen.queryByText('许可证数据全量同步')).not.toBeInTheDocument()
  })

  it('filters tasks by law text search', () => {
    render(<TasksView />)
    fireEvent.change(screen.getByLabelText('搜索任务或法规'), {
      target: { value: 'HJ 944' },
    })
    expect(screen.getByText('月报草稿生成')).toBeInTheDocument()
    expect(screen.getByText('五类台账条数巡检')).toBeInTheDocument()
    expect(screen.queryByText('环保税按季申报')).not.toBeInTheDocument()
  })

  // ── Empty State ──

  it('shows empty state with clear-filter button when no tasks match', () => {
    render(<TasksView />)
    fireEvent.change(screen.getByLabelText('搜索任务或法规'), {
      target: { value: 'zzzznotexist' },
    })
    expect(screen.getByText('未找到匹配的任务')).toBeInTheDocument()
    expect(screen.getByText('清除筛选')).toBeInTheDocument()
  })

  it('clears filter via empty-state button and restores all tasks', () => {
    render(<TasksView />)
    fireEvent.change(screen.getByLabelText('搜索任务或法规'), {
      target: { value: 'zzzznotexist' },
    })
    fireEvent.click(screen.getByText('清除筛选'))
    // all tasks restored
    expect(screen.getByText('许可证数据全量同步')).toBeInTheDocument()
    expect(screen.getByText('月报草稿生成')).toBeInTheDocument()
    // search cleared, filter reset
    expect(screen.getByLabelText('搜索任务或法规')).toHaveValue('')
  })

  // ── Toggle Enabled ──

  it('toggles a task from enabled to disabled', () => {
    render(<TasksView />)
    expect(screen.getAllByLabelText('停用')).toHaveLength(ENABLED_TASKS)
    fireEvent.click(screen.getAllByLabelText('停用')[0])
    expect(screen.getAllByLabelText('停用')).toHaveLength(ENABLED_TASKS - 1)
    expect(screen.getAllByLabelText('启用')).toHaveLength(DISABLED_TASK_IDS.length + 1)
  })

  it('toggles a task from disabled to enabled', () => {
    render(<TasksView />)
    expect(screen.getAllByLabelText('启用')).toHaveLength(DISABLED_TASK_IDS.length)
    fireEvent.click(screen.getAllByLabelText('启用')[0])
    expect(screen.getAllByLabelText('启用')).toHaveLength(DISABLED_TASK_IDS.length - 1)
    expect(screen.getAllByLabelText('停用')).toHaveLength(ENABLED_TASKS + 1)
  })

  // ── Expand / Collapse ──

  it('expands and collapses task details', () => {
    render(<TasksView />)
    const desc = '自动登录 permit.mee.gov.cn 读取 20 张卡 + 16 个顶级模块'
    expect(screen.queryByText(desc)).not.toBeInTheDocument()
    // expand
    fireEvent.click(screen.getAllByLabelText('展开详情')[0])
    expect(screen.getByText(desc)).toBeInTheDocument()
    expect(screen.getByLabelText('删除任务')).toBeInTheDocument()
    // collapse
    fireEvent.click(screen.getByLabelText('收起详情'))
    expect(screen.queryByText(desc)).not.toBeInTheDocument()
  })

  // ── Run Now ──

  it('disables play button during execution then re-enables after completion', async () => {
    vi.useFakeTimers()
    render(<TasksView />)
    const playBtn = screen.getAllByLabelText('立即执行')[0]
    expect(playBtn).not.toBeDisabled()
    fireEvent.click(playBtn)
    expect(playBtn).toBeDisabled()
    // advance past the simulated 2s execution
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    await act(async () => {})
    expect(playBtn).not.toBeDisabled()
    vi.useRealTimers()
  })

  // ── Create Task ──

  it('creates a new task via the editor modal', () => {
    render(<TasksView />)
    fireEvent.click(screen.getByText('新建任务'))
    // modal opened
    expect(screen.getByText('创建任务')).toBeInTheDocument()
    // fill required name
    const nameInput = screen.getByPlaceholderText('如：月度排放数据归档')
    fireEvent.change(nameInput, { target: { value: '自定义测试任务' } })
    // submit
    fireEvent.click(screen.getByText('创建任务'))
    // toast and new task visible (toast persists for 2.5s, so both are in DOM)
    expect(screen.getByText('已新建任务「自定义测试任务」')).toBeInTheDocument()
    // the name appears in both the toast text and the task-list item
    expect(
      screen.queryAllByText('自定义测试任务', { exact: false }).length,
    ).toBeGreaterThanOrEqual(1)
  })

  // ── Edit Task ──

  it('edits an existing task via the editor modal', () => {
    render(<TasksView />)
    fireEvent.click(screen.getAllByLabelText('编辑任务')[0])
    // modal opened with pre-filled data
    expect(screen.getByText('保存修改')).toBeInTheDocument()
    const nameInput = screen.getByPlaceholderText('如：月度排放数据归档')
    fireEvent.change(nameInput, { target: { value: '许可证数据全量同步（已编辑）' } })
    fireEvent.click(screen.getByText('保存修改'))
    // toast and updated task visible
    expect(
      screen.getByText('已更新任务「许可证数据全量同步（已编辑）」'),
    ).toBeInTheDocument()
    expect(screen.getByText('许可证数据全量同步（已编辑）')).toBeInTheDocument()
  })

  // ── Delete Task ──

  it('deletes a task with confirmation dialog', () => {
    render(<TasksView />)
    const target = '许可证数据全量同步'
    expect(screen.getByText(target)).toBeInTheDocument()
    // expand to reveal delete button
    fireEvent.click(screen.getAllByLabelText('展开详情')[0])
    fireEvent.click(screen.getByLabelText('删除任务'))
    // confirmation dialog
    expect(screen.getByText('确认删除任务？')).toBeInTheDocument()
    // confirm
    fireEvent.click(screen.getByText('删除'))
    expect(screen.queryByText(target)).not.toBeInTheDocument()
    expect(screen.getByText('已删除任务「许可证数据全量同步」')).toBeInTheDocument()
  })

  // ── localStorage Persistence ──

  it('persists enabled-state changes to localStorage', () => {
    render(<TasksView />)
    const toggleBtn = screen.getAllByLabelText('停用')[0]
    fireEvent.click(toggleBtn)
    const saved = JSON.parse(localStorage.getItem('tasks_enabled_state')!)
    expect(saved['permit-sync']).toBe(false)
    expect(saved['permit-renew-reminder']).toBe(true)
  })

  it('restores enabled state from localStorage on mount', () => {
    localStorage.setItem(
      'tasks_enabled_state',
      JSON.stringify({ 'permit-sync': false, 'permit-renew-reminder': true }),
    )
    render(<TasksView />)
    // one extra disabled → 5 + 1 = 6 disabled toggles
    expect(screen.getAllByLabelText('启用')).toHaveLength(
      DISABLED_TASK_IDS.length + 1,
    )
    expect(screen.getAllByLabelText('停用')).toHaveLength(ENABLED_TASKS - 1)
  })

  it('falls back to default TASKS when localStorage value is corrupted', () => {
    localStorage.setItem('tasks_enabled_state', 'not-valid-json')
    render(<TasksView />)
    expect(screen.getAllByLabelText('停用')).toHaveLength(ENABLED_TASKS)
    expect(screen.getAllByLabelText('启用')).toHaveLength(DISABLED_TASK_IDS.length)
  })

  // ── Toast ──

  it('shows a toast on "全部同步" click', () => {
    render(<TasksView />)
    fireEvent.click(screen.getByText('全部同步'))
    expect(
      screen.getByText('开始同步所有启用的任务...'),
    ).toBeInTheDocument()
  })
})
