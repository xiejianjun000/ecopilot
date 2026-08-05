"use client"
import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import {
  X, Maximize2, Minimize2, Loader2, Filter, Search,
  Scale, FileText, BookOpen, Sparkles, AlertTriangle, Hash,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { apiGet } from "@/lib/api"

/* ═══════════════════════════════════════════════════════
 * EcoPilot 知识图谱 — 纯 SVG 力导向可视化
 * 无外部依赖，自实现 force simulation
 * 节点 = 文档，边 = wikilink
 * ═══════════════════════════════════════════════════════ */

interface GNode {
  id: string; name: string; title: string; category: string
  color: string; size: number; tags: string[]; industry: string[]
  x: number; y: number; vx: number; vy: number; fx?: number; fy?: number
}
interface GEdge { source: string; target: string }
interface GraphData { nodes: GNode[]; edges: GEdge[] }

interface Props {
  onNodeClick?: (id: string) => void
  className?: string
}

/** 类别配色 */
const CAT_COLORS: Record<string, string> = {
  "法规": "#ef4444",
  "标准": "#3b82f6",
  "模板": "#10b981",
  "MOC": "#8b5cf6",
  "智能体": "#f59e0b",
  "未分类": "#6b7280",
}

const CAT_ICON: Record<string, any> = {
  "法规": Scale,
  "标准": FileText,
  "模板": FileText,
  "MOC": BookOpen,
  "智能体": Sparkles,
  "未分类": FileText,
}

/** 力导向仿真（简易版） */
function useForceSimulation(nodes: GNode[], edges: GEdge[], width: number, height: number) {
  const nodesRef = useRef<GNode[]>(nodes)
  const edgesRef = useRef<GEdge[]>(edges)
  const rafRef = useRef<number>(0)
  const [tick, setTick] = useState(0)

  // 初始化节点位置（圆形布局）
  useEffect(() => {
    if (nodes.length === 0) return
    if (width < 10 || height < 10) return // 等容器测量完毕
    const cx = width / 2, cy = height / 2
    const r = Math.max(50, Math.min(width, height) * 0.35)
    nodes.forEach((n, i) => {
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || (n.x === 0 && n.y === 0)) {
        const angle = (i / nodes.length) * Math.PI * 2
        n.x = cx + Math.cos(angle) * r
        n.y = cy + Math.sin(angle) * r
      }
      n.vx = 0; n.vy = 0
    })
    nodesRef.current = nodes
    edgesRef.current = edges
  }, [nodes, edges, width, height])

  useEffect(() => {
    if (nodes.length === 0) return
    let frame = 0
    const maxFrames = 300 // 仿真 300 帧后停止

    const tick_sim = () => {
      const ns = nodesRef.current
      const es = edgesRef.current
      const cx = width / 2, cy = height / 2

      // 1. 斥力（库仑力）：所有节点对互相排斥
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const a = ns[i], b = ns[j]
          const dx = b.x - a.x, dy = b.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = 800 / (dist * dist)
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          a.vx -= fx; a.vy -= fy
          b.vx += fx; b.vy += fy
        }
      }

      // 2. 引力（弹簧力）：边连接的节点互相吸引
      const edgeMap = new Map<string, Set<string>>()
      es.forEach(e => {
        if (!edgeMap.has(e.source)) edgeMap.set(e.source, new Set())
        if (!edgeMap.has(e.target)) edgeMap.set(e.target, new Set())
        edgeMap.get(e.source)!.add(e.target)
        edgeMap.get(e.target)!.add(e.source)
      })
      const nodeMap = new Map(ns.map(n => [n.id, n]))
      es.forEach(e => {
        const a = nodeMap.get(e.source), b = nodeMap.get(e.target)
        if (!a || !b) return
        const dx = b.x - a.x, dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const targetDist = 120
        const force = (dist - targetDist) * 0.05
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx += fx; a.vy += fy
        b.vx -= fx; b.vy -= fy
      })

      // 3. 中心引力：所有节点被拉向中心
      ns.forEach(n => {
        n.vx += (cx - n.x) * 0.005
        n.vy += (cy - n.y) * 0.005
      })

      // 4. 更新位置 + 阻尼 + 边界
      ns.forEach(n => {
        if (n.fx != null) { n.x = n.fx; n.vx = 0; return }
        if (n.fy != null) { n.y = n.fy; n.vy = 0; return }
        n.vx *= 0.85 // 阻尼
        n.vy *= 0.85
        n.x += n.vx
        n.y += n.vy
        // 边界约束
        const margin = 30
        n.x = Math.max(margin, Math.min(width - margin, n.x))
        n.y = Math.max(margin, Math.min(height - margin, n.y))
      })

      frame++
      setTick(t => t + 1)
      if (frame < maxFrames) {
        rafRef.current = requestAnimationFrame(tick_sim)
      }
    }

    rafRef.current = requestAnimationFrame(tick_sim)
    return () => cancelAnimationFrame(rafRef.current)
  }, [nodes, edges, width, height])

  return { nodes: nodesRef.current, tick }
}

export function KnowledgeGraph({ onNodeClick, className }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [rawData, setRawData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [dims, setDims] = useState({ width: 800, height: 600 })
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [draggingNode, setDraggingNode] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [filterCats, setFilterCats] = useState<Set<string>>(new Set())
  const [filterTags, setFilterTags] = useState<Set<string>>(new Set())
  const [filterIndustry, setFilterIndustry] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)

  // 加载图谱数据
  useEffect(() => {
    apiGet<{ ok: boolean; nodes?: GNode[]; edges?: GEdge[] }>('/api/knowledge/graph')
      .then(r => {
        if (r.ok && r.data?.ok) {
          setRawData({ nodes: r.data.nodes || [], edges: r.data.edges || [] })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // 容器尺寸
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        setDims({ width: e.contentRect.width, height: e.contentRect.height })
      }
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // 筛选 + 搜索
  const visibleData = useMemo(() => {
    if (!rawData) return { nodes: [], edges: [] }
    const q = search.trim().toLowerCase()
    const filteredNodes = rawData.nodes.filter(n => {
      if (filterCats.size > 0 && !filterCats.has(n.category)) return false
      if (filterTags.size > 0 && !n.tags?.some(t => filterTags.has(t))) return false
      if (filterIndustry && !n.industry?.includes(filterIndustry)) return false
      if (q && !n.title.toLowerCase().includes(q) && !n.name.toLowerCase().includes(q)) return false
      return true
    })
    const visibleIds = new Set(filteredNodes.map(n => n.id))
    const filteredEdges = rawData.edges.filter(e => visibleIds.has(e.source) && visibleIds.has(e.target))
    return { nodes: filteredNodes, edges: filteredEdges }
  }, [rawData, filterCats, filterTags, filterIndustry, search])

  // 复制节点（带位置）用于仿真
  const simNodes = useMemo(() => visibleData.nodes.map(n => ({ ...n })), [visibleData.nodes])
  const { nodes: simNodesLive, tick } = useForceSimulation(simNodes, visibleData.edges, dims.width, dims.height)

  // 拖拽
  const handleMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.preventDefault()
    setDraggingNode(nodeId)
    const node = simNodesLive.find(n => n.id === nodeId)
    if (node) { node.fx = node.x; node.fy = node.y }
  }
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingNode || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const node = simNodesLive.find(n => n.id === draggingNode)
    if (node) { node.fx = x; node.fy = y }
  }, [draggingNode, simNodesLive])
  const handleMouseUp = () => {
    if (draggingNode) {
      const node = simNodesLive.find(n => n.id === draggingNode)
      if (node) { node.fx = undefined; node.fy = undefined }
      setDraggingNode(null)
    }
  }

  // 缩放/平移
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStart = useRef({ x: 0, y: 0 })
  // 滚轮缩放（原生非被动监听，支持 preventDefault）
  // 以鼠标位置为中心缩放，符合直觉
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      // 鼠标在 SVG 世界坐标中的位置（考虑当前 pan/zoom）
      const worldX = (mx - pan.x) / zoom
      const worldY = (my - pan.y) / zoom
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const newZoom = Math.max(0.3, Math.min(3, zoom * delta))
      // 缩放后调整 pan，使鼠标位置的世界坐标保持不变
      const newPanX = mx - worldX * newZoom
      const newPanY = my - worldY * newZoom
      setZoom(newZoom)
      setPan({ x: newPanX, y: newPanY })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [zoom, pan])
  const handleSvgMouseDown = (e: React.MouseEvent) => {
    if (e.target === svgRef.current || (e.target as Element).tagName === 'rect') {
      setIsPanning(true)
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
    }
  }
  const handleSvgMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y })
    } else if (draggingNode) {
      handleMouseMove(e)
    }
  }
  const handleSvgMouseUp = () => {
    setIsPanning(false)
    handleMouseUp()
  }

  // 所有可用筛选选项
  const allCats = useMemo(() => Array.from(new Set(rawData?.nodes.map(n => n.category) || [])), [rawData])
  const allTags = useMemo(() => Array.from(new Set(rawData?.nodes.flatMap(n => n.tags || []) || [])).slice(0, 20), [rawData])
  const allIndustries = useMemo(() => Array.from(new Set(rawData?.nodes.flatMap(n => n.industry || []) || [])), [rawData])

  // hover 节点的连接信息
  const hoveredInfo = useMemo(() => {
    if (!hoveredNode) return null
    const node = simNodesLive.find(n => n.id === hoveredNode)
    if (!node) return null
    const linkedIds = new Set<string>()
    visibleData.edges.forEach(e => {
      if (e.source === hoveredNode) linkedIds.add(e.target)
      if (e.target === hoveredNode) linkedIds.add(e.source)
    })
    return { node, links: linkedIds.size }
  }, [hoveredNode, simNodesLive, visibleData.edges])

  const toggleCat = (c: string) => setFilterCats(p => {
    const n = new Set(p)
    n.has(c) ? n.delete(c) : n.add(c)
    return n
  })
  const toggleTag = (t: string) => setFilterTags(p => {
    const n = new Set(p)
    n.has(t) ? n.delete(t) : n.add(t)
    return n
  })

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center h-full text-muted-foreground", className)}>
        <Loader2 className="size-5 animate-spin mr-2" /> 加载知识图谱...
      </div>
    )
  }

  return (
    <div ref={containerRef} className={cn("relative h-full w-full overflow-hidden bg-background", className)}>
      {/* 顶部工具栏 */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索节点..."
            className="w-full rounded-lg border border-border bg-card/95 backdrop-blur pl-8 pr-3 py-1.5 text-caption text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
          />
        </div>
        <button
          onClick={() => setShowFilters(s => !s)}
          className={cn(
            "flex items-center gap-1 rounded-lg border border-border bg-card/95 backdrop-blur px-2.5 py-1.5 text-caption transition-colors",
            (filterCats.size > 0 || filterTags.size > 0 || filterIndustry) ? "text-eco-700 border-eco-300" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Filter className="size-3.5" />
          筛选
          {(filterCats.size + filterTags.size) > 0 && (
            <span className="rounded bg-eco-100 px-1 text-eco-700">{filterCats.size + filterTags.size}</span>
          )}
        </button>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card/95 backdrop-blur px-1 py-1">
          <button onClick={() => setZoom(z => Math.max(0.3, z * 0.9))} className="rounded p-1 hover:bg-accent text-muted-foreground" aria-label="缩小">−</button>
          <span className="text-caption text-muted-foreground tabular-nums w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, z * 1.1))} className="rounded p-1 hover:bg-accent text-muted-foreground" aria-label="放大">+</button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} className="rounded p-1 hover:bg-accent text-muted-foreground text-caption">重置</button>
        </div>
      </div>

      {/* 筛选面板 */}
      {showFilters && (
        <div className="absolute top-14 left-3 z-10 w-72 rounded-xl border border-border bg-card/95 backdrop-blur shadow-popover p-3 space-y-3">
          <div>
            <div className="text-caption font-semibold text-muted-foreground mb-1.5">类别</div>
            <div className="flex flex-wrap gap-1">
              {allCats.map(c => (
                <button
                  key={c}
                  onClick={() => toggleCat(c)}
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-caption transition-colors",
                    filterCats.has(c) ? "text-white" : "bg-secondary text-muted-foreground hover:bg-accent"
                  )}
                  style={filterCats.has(c) ? { backgroundColor: CAT_COLORS[c] || '#6b7280' } : {}}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          {allTags.length > 0 && (
            <div>
              <div className="text-caption font-semibold text-muted-foreground mb-1.5">标签</div>
              <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                {allTags.map(t => (
                  <button
                    key={t}
                    onClick={() => toggleTag(t)}
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-caption transition-colors",
                      filterTags.has(t) ? "bg-eco-100 text-eco-700" : "bg-secondary text-muted-foreground hover:bg-accent"
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          {allIndustries.length > 0 && (
            <div>
              <div className="text-caption font-semibold text-muted-foreground mb-1.5">行业</div>
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => setFilterIndustry(null)}
                  className={cn("rounded-md px-1.5 py-0.5 text-caption", !filterIndustry ? "bg-eco-100 text-eco-700" : "bg-secondary text-muted-foreground hover:bg-accent")}
                >
                  全部
                </button>
                {allIndustries.map(i => (
                  <button
                    key={i}
                    onClick={() => setFilterIndustry(filterIndustry === i ? null : i)}
                    className={cn("rounded-md px-1.5 py-0.5 text-caption", filterIndustry === i ? "bg-eco-100 text-eco-700" : "bg-secondary text-muted-foreground hover:bg-accent")}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </div>
          )}
          {(filterCats.size > 0 || filterTags.size > 0 || filterIndustry) && (
            <button
              onClick={() => { setFilterCats(new Set()); setFilterTags(new Set()); setFilterIndustry(null) }}
              className="text-caption text-destructive hover:underline"
            >
              清除所有筛选
            </button>
          )}
        </div>
      )}

      {/* SVG 画布 */}
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full cursor-grab"
        style={{ cursor: isPanning ? 'grabbing' : draggingNode ? 'grabbing' : 'grab' }}
        onMouseDown={handleSvgMouseDown}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleSvgMouseUp}
        onMouseLeave={handleSvgMouseUp}
      >
        <rect width="100%" height="100%" fill="transparent" />
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {/* 边 */}
          {visibleData.edges.map((e, i) => {
            const a = simNodesLive.find(n => n.id === e.source)
            const b = simNodesLive.find(n => n.id === e.target)
            if (!a || !b) return null
            // 坐标必须是有限数，否则 SVG 会报 NaN 错误
            const x1 = Number.isFinite(a.x) ? a.x : 0
            const y1 = Number.isFinite(a.y) ? a.y : 0
            const x2 = Number.isFinite(b.x) ? b.x : 0
            const y2 = Number.isFinite(b.y) ? b.y : 0
            if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) return null
            const isHighlighted = hoveredNode && (e.source === hoveredNode || e.target === hoveredNode)
            const isDimmed = hoveredNode && !isHighlighted
            return (
              <line
                key={i}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={isHighlighted ? "#10b981" : "currentColor"}
                strokeOpacity={isHighlighted ? 0.7 : isDimmed ? 0.05 : 0.2}
                strokeWidth={isHighlighted ? 1.5 : 1}
                className="text-muted-foreground transition-opacity"
              />
            )
          })}
          {/* 节点 */}
          {simNodesLive.map(n => {
            const isHovered = hoveredNode === n.id
            const isSelected = selectedNode === n.id
            const isLinked = hoveredNode && visibleData.edges.some(e =>
              (e.source === hoveredNode && e.target === n.id) ||
              (e.target === hoveredNode && e.source === n.id)
            )
            const isDimmed = hoveredNode && !isHovered && !isLinked
            const r = Math.max(8, Math.min(24, n.size))
            const Icon = CAT_ICON[n.category] || FileText
            const nx = Number.isFinite(n.x) ? n.x : 0
            const ny = Number.isFinite(n.y) ? n.y : 0
            return (
              <g
                key={n.id}
                transform={`translate(${nx},${ny})`}
                className={cn("cursor-pointer transition-opacity", isDimmed && "opacity-30")}
                onMouseEnter={() => setHoveredNode(n.id)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={(e) => { e.stopPropagation(); setSelectedNode(n.id); onNodeClick?.(n.id) }}
                onMouseDown={(e) => handleMouseDown(e, n.id)}
              >
                {/* 选中环 */}
                {isSelected && <circle r={r + 6} fill="none" stroke="#10b981" strokeWidth={2} strokeDasharray="3 3" />}
                {/* hover 环 */}
                {isHovered && !isSelected && <circle r={r + 4} fill="none" stroke={n.color} strokeWidth={1.5} opacity={0.5} />}
                {/* 节点圆 */}
                <circle
                  r={r}
                  fill={n.color}
                  fillOpacity={isHovered ? 0.9 : 0.7}
                  stroke={n.color}
                  strokeWidth={2}
                />
                {/* 类别首字 */}
                <text
                  textAnchor="middle"
                  dy="0.35em"
                  fontSize={r * 0.6}
                  fontWeight="bold"
                  fill="white"
                  pointerEvents="none"
                >
                  {n.category[0]}
                </text>
                {/* 标题 */}
                {((isHovered || isSelected) || zoom > 1.2) && (
                  <g transform={`translate(0,${r + 6})`}>
                    <rect
                      x={-Math.max(40, n.title.length * 4)}
                      y={-2}
                      width={Math.max(80, n.title.length * 8)}
                      height={16}
                      rx={3}
                      fill="white"
                      stroke="currentColor"
                      strokeOpacity={0.2}
                      className="text-border"
                    />
                    <text
                      textAnchor="middle"
                      dy="9"
                      fontSize={10}
                      fill="currentColor"
                      className="text-foreground"
                      pointerEvents="none"
                    >
                      {n.title.length > 12 ? n.title.slice(0, 12) + '…' : n.title}
                    </text>
                  </g>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      {/* Tooltip */}
      {hoveredInfo && (
        <div className="absolute bottom-3 left-3 z-10 w-72 rounded-xl border border-border bg-card/95 backdrop-blur shadow-popover p-3">
          <div className="flex items-start gap-2">
            <div
              className="flex size-8 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: hoveredInfo.node.color + '20' }}
            >
              <span style={{ color: hoveredInfo.node.color }} className="text-body font-bold">
                {hoveredInfo.node.category[0]}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-body font-semibold text-foreground truncate">{hoveredInfo.node.title}</h4>
              <p className="text-caption text-muted-foreground">{hoveredInfo.node.category} · {hoveredInfo.links} 个连接</p>
              {hoveredInfo.node.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {hoveredInfo.node.tags.slice(0, 4).map(t => (
                    <span key={t} className="rounded bg-eco-50 px-1 py-0.5 text-caption text-eco-700">{t}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 图例 */}
      <div className="absolute bottom-3 right-3 z-10 rounded-xl border border-border bg-card/95 backdrop-blur shadow-popover p-2.5">
        <div className="text-caption font-semibold text-muted-foreground mb-1.5">类别图例</div>
        <div className="space-y-1">
          {allCats.map(c => (
            <div key={c} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: CAT_COLORS[c] || '#6b7280' }} />
              <span className="text-caption text-foreground">{c}</span>
              <span className="text-caption text-muted-foreground">({rawData?.nodes.filter(n => n.category === c).length || 0})</span>
            </div>
          ))}
        </div>
      </div>

      {/* 统计 */}
      <div className="absolute top-3 right-3 z-10 hidden md:block">
        {/* 已在工具栏右侧处理 */}
      </div>

      {/* 节点/边统计 */}
      <div className="absolute top-14 right-3 z-10 rounded-lg border border-border bg-card/95 backdrop-blur px-2.5 py-1 text-caption text-muted-foreground">
        节点 <span className="font-semibold text-foreground">{visibleData.nodes.length}</span> · 边 <span className="font-semibold text-foreground">{visibleData.edges.length}</span>
      </div>
    </div>
  )
}

/** 全屏包装 */
export function KnowledgeGraphFullscreen({ onClose, onNodeClick }: { onClose: () => void; onNodeClick?: (id: string) => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-eco-600" />
          <h3 className="text-body font-semibold text-foreground">知识图谱 — 全屏视图</h3>
        </div>
        <button
          onClick={onClose}
          aria-label="退出全屏"
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Minimize2 className="size-4" />
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <KnowledgeGraph onNodeClick={onNodeClick} className="h-full" />
      </div>
    </div>
  )
}
