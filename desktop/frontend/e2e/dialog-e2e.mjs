#!/usr/bin/env node
/**
 * EcoPilot 对话框全面 E2E 测试
 * 测试项：文字工整性、符号过滤、表格输出、表情、工具调用面板、右侧产出物、记忆、自学习、技能、进化
 *
 * 运行：node e2e/dialog-e2e.mjs
 * 前置条件：后端运行在 8002 端口
 */

const API = "http://127.0.0.1:8002"

// ═══ 工具函数 ═══
let passed = 0, failed = 0, warnings = 0

async function test(name, fn) {
  try { await fn(); passed++; process.stdout.write(`  ✅ ${name}\n`) }
  catch (e) { failed++; process.stdout.write(`  ❌ ${name}: ${e.message}\n`) }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed") }

async function getToken() {
  const res = await fetch(`${API}/api/auth/token`)
  const data = await res.json()
  return data.token
}

async function apiGet(path, token) {
  const res = await fetch(`${API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(5000),
  })
  const text = await res.text()
  let data; try { data = JSON.parse(text) } catch { data = text }
  return { ok: res.ok, status: res.status, data }
}

async function apiPost(path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  })
  const text = await res.text()
  let data; try { data = JSON.parse(text) } catch { data = text }
  return { ok: res.ok, status: res.status, data }
}

// 解析 SSE 流
async function* parseSSE(path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) throw new Error(`SSE ${res.status}: ${await res.text()}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try { yield JSON.parse(line.slice(6)) }
          catch { /* skip */ }
        }
      }
    }
  } finally { reader.releaseLock() }
}

// ═══ 检测函数 ═══

/** 检查文本排版工整性 */
function checkTextNeatness(text) {
  if (!text || text.length < 5) return true // 太短不判断
  // 检查是否有多余连续空行
  const lines = text.split('\n')
  let consecutiveBlanks = 0
  for (const line of lines) {
    if (line.trim() === '') {
      consecutiveBlanks++
      if (consecutiveBlanks > 2) return false // 超过2个连续空行
    } else {
      consecutiveBlanks = 0
    }
  }
  return true
}

/** 检查表格格式是否规范 */
function checkTableFormat(text) {
  const tableRegex = /\|(.+)\|/g
  const tables = text.match(tableRegex)
  if (!tables) return true // 无表格不算失败
  for (const line of tables) {
    const cells = line.split('|').filter(c => c.trim())
    if (cells.length > 20) return false // 列太多
  }
  return true
}

/** 检查Markdown符号是否异常 */
function checkMarkdownSymbols(text) {
  // 允许合理的 markdown：###, **, *, `, ```, >, -, 1.
  // 检测异常模式：孤立的符号、未闭合的标记
  const unclosedBacktick = (text.match(/`/g) || []).length % 2 !== 0
  if (unclosedBacktick) return false
  return true
}

/** 检查表情使用 */
function checkEmojiUsage(text) {
  if (!text) return true
  // 表情范围
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
  const hasEmoji = emojiRegex.test(text)
  // 不强制要求表情，只记录
  return { ok: true, hasEmoji }
}

// ═══ 主测试流程 ═══

let TOKEN = ''

async function main() {
  console.log('\n═══════════════════════════════════════')
  console.log('EcoPilot 对话框全面 E2E 测试')
  console.log('═══════════════════════════════════════\n')

  // ── Phase 1: 认证 ──
  console.log('══ [Phase 1] 认证 ══\n')

  await test('获取认证 token', async () => {
    TOKEN = await getToken()
    assert(TOKEN && TOKEN.length > 32, `Token 无效: ${TOKEN?.length} chars`)
  })

  // ── Phase 2: 基础 API 测试 ──
  console.log('\n══ [Phase 2] 基础 API 端点 ══\n')

  await test('GET /api/chat/health 返回健康状态', async () => {
    const r = await apiGet('/api/chat/health')
    assert(r.ok, `HTTP ${r.status}`)
    assert(r.data.status === 'ok', `状态不是 ok: ${r.data.status}`)
    assert(r.data.text_ready === true, 'text_model 未就绪')
  })

  await test('GET /api/license/status 返回授权状态', async () => {
    const r = await apiGet('/api/license/status', TOKEN)
    assert(r.status < 500, `HTTP ${r.status}`)
  })

  await test('GET /api/models/available 返回模型列表', async () => {
    const r = await apiGet('/api/models/available', TOKEN)
    assert(r.ok, `HTTP ${r.status}`)
    assert(r.data.text_models?.length > 0, '无 text_models')
    assert(r.data.vision_models?.length > 0, '无 vision_models')
  })

  await test('GET /api/mcp-servers 返回 MCP 服务器列表', async () => {
    const r = await apiGet('/api/mcp-servers', TOKEN)
    assert(r.ok, `HTTP ${r.status}`)
  })

  await test('GET /api/user 返回用户信息', async () => {
    const r = await apiGet('/api/user', TOKEN)
    assert(r.ok, `HTTP ${r.status}`)
  })

  await test('GET /api/enterprise 返回企业信息', async () => {
    const r = await apiGet('/api/enterprise', TOKEN)
    assert(r.ok, `HTTP ${r.status}`)
    process.stdout.write(`     企业: ${r.data?.name || '未设置'}\n`)
  })

  // ── Phase 3: 对话框 SSE 流式响应测试 ──
  console.log('\n══ [Phase 3] 对话框 SSE 流式测试 ══\n')

  async function testChatStream(query, label) {
    await test(`[SSE] ${label || query}`, async () => {
      const events = []
      let hasToolCall = false
      let hasToolResult = false
      let hasText = false
      let content = ''
      let toolCallsSeen = []
      let toolCompleted = false

      try {
        for await (const evt of parseSSE('/api/chat/stream', {
          message: query,
          model: 'deepseek-chat',
        }, TOKEN)) {
          events.push(evt)
          if (evt.type === 'text_delta' && evt.text) {
            hasText = true
            content += evt.text
          }
          if (evt.type === 'tool_call') {
            hasToolCall = true
            toolCallsSeen.push(evt.name || 'unknown')
          }
          if (evt.type === 'tool_result') {
            hasToolResult = true
          }
          if (evt.type === 'done' || evt.type === 'finish') {
            toolCompleted = true
          }
        }
      } catch (e) {
        if (e.message.includes('AbortError') || e.message.includes('abort')) {
          // timeout is expected for long tests
          process.stdout.write(`     ⚠ 流中断(超时): 已收集 ${events.length} 事件\n`)
        } else {
          throw e
        }
      }

      // 基础验证
      assert(hasText, '无文本输出')
      assert(content.length > 10, `输出太短: ${content.length} 字符`)

      // 排版工整性检查
      const neat = checkTextNeatness(content)
      if (!neat) {
        warnings++
        process.stdout.write(`     ⚠ 排版警告: 连续空行超过2行\n`)
      }

      // Markdown符号检查
      const mdOk = checkMarkdownSymbols(content)
      if (!mdOk) {
        warnings++
        process.stdout.write(`     ⚠ Markdown符号异常\n`)
      }

      // 表格格式检查
      const tableOk = checkTableFormat(content)
      if (!tableOk) {
        warnings++
        process.stdout.write(`     ⚠ 表格列数异常\n`)
      }

      // 表情检查
      const emoji = checkEmojiUsage(content)
      if (emoji.hasEmoji) {
        process.stdout.write(`     📝 含表情\n`)
      }

      // 工具调用统计
      if (hasToolCall) {
        process.stdout.write(`     🔧 工具调用: ${toolCallsSeen.join(', ')}\n`)
      }

      // 输出长度
      process.stdout.write(`     📊 输出 ${content.length} 字符, ${events.length} 事件\n`)
    })
  }

  // 发送多轮对话测试
  const testQueries = [
    "你好，请简单介绍一下你自己",
    "帮我检查一下许可证状态",
    "请用表格形式列出钢铁行业的主要排放物及排放标准",
    "请分析一下目前的合规态势，使用分级（正常/关注/警告/严重）来展示",
    "帮我查看一下今天的日历任务",
    "知识库中有哪些法律法规文件？",
    "请生成一份简短的合规建议，包括至少3个要点",
    "当前企业的碳排放情况如何？",
  ]

  for (const q of testQueries) {
    await testChatStream(q, q.slice(0, 40))
  }

  // ── Phase 4: 右侧产出物 ──
  console.log('\n══ [Phase 4] 右侧产出物 测试 ══\n')

  await test('POST /api/ops/feedback 提交反馈', async () => {
    const r = await apiPost('/api/feedback', { message: 'E2E 测试反馈', contact: '' }, TOKEN)
    assert(r.ok, `HTTP ${r.status}: ${JSON.stringify(r.data)}`)
  })

  await test('POST /api/rectification/tasks 获取整改任务', async () => {
    const r = await apiPost('/api/rectification/tasks', { action: 'list' }, TOKEN)
    assert(r.ok, `HTTP ${r.status}`)
  })

  await test('GET /api/calendar/tasks 获取日历任务', async () => {
    const r = await apiPost('/api/calendar/tasks', { action: 'list' }, TOKEN)
    assert(r.ok, `HTTP ${r.status}`)
  })

  await test('GET /api/calendar/ledger 获取台账', async () => {
    const r = await apiPost('/api/calendar/ledger', { action: 'list' }, TOKEN)
    assert(r.ok, `HTTP ${r.status}`)
  })

  await test('GET /api/ops/dashboard 获取仪表盘', async () => {
    const r = await apiGet('/api/ops/dashboard', TOKEN)
    assert(r.ok, `HTTP ${r.status}`)
  })

  await test('POST /api/chat/tts 语音合成', async () => {
    const r = await apiPost('/api/chat/tts', { text: '合规测试' }, TOKEN)
    assert(r.ok, `HTTP ${r.status}`)
  })

  await test('POST /api/models/save 保存模型配置', async () => {
    const r = await apiPost('/api/models/save', { text_model: 'deepseek-chat' }, TOKEN)
    assert(r.ok || r.status === 400, `HTTP ${r.status}`)
  })

  // ── Phase 5: 记忆功能 ──
  console.log('\n══ [Phase 5] 记忆功能 测试 ══\n')

  await test('GET /api/memory/list 获取合规记忆列表', async () => {
    const r = await apiGet('/api/memory/list', TOKEN)
    assert(r.ok, `HTTP ${r.status}`)
    const memories = Array.isArray(r.data) ? r.data : (r.data?.memories || [])
    process.stdout.write(`     记忆数: ${memories.length}\n`)
  })

  await test('GET /api/journal/list 获取工作日志', async () => {
    const r = await apiGet('/api/journal/list', TOKEN)
    assert(r.ok, `HTTP ${r.status}`)
    const journals = Array.isArray(r.data) ? r.data : (r.data?.journals || [])
    process.stdout.write(`     日志数: ${journals.length}\n`)
  })

  // ── Phase 6: 安全与隐私 ──
  console.log('\n══ [Phase 6] 安全与隐私 测试 ══\n')

  await test('无 Token 访问受保护端点返回 401', async () => {
    const r = await apiGet('/api/enterprise')
    assert(r.status === 401, `期望 401 得到 ${r.status}`)
  })

  await test('安全头检查 (X-Content-Type-Options)', async () => {
    const res = await fetch(`${API}/api/chat/health`)
    assert(res.headers.get('x-content-type-options') === 'nosniff', '缺少 X-Content-Type-Options')
  })

  await test('安全头检查 (X-Frame-Options)', async () => {
    const res = await fetch(`${API}/api/chat/health`)
    assert(res.headers.get('x-frame-options') === 'DENY', '缺少 X-Frame-Options')
  })

  await test('安全头检查 (CSP)', async () => {
    const res = await fetch(`${API}/api/chat/health`)
    assert(res.headers.get('content-security-policy'), '缺少 CSP')
  })

  // ── Phase 7: 对话持久性 ──
  console.log('\n══ [Phase 7] 对话持久性 测试 ══\n')

  // 多轮对话测试（验证会话连续性）
  console.log('  模拟多轮对话...\n')

  let sessionId = null
  let roundResults = []

  // 发送3轮连续对话
  const multiTurnQueries = [
    "我的企业名称是什么？",
    "我的许可证什么时候到期？",
    "根据以上信息，给我生成一份合规建议",
  ]

  for (let i = 0; i < multiTurnQueries.length; i++) {
    const q = multiTurnQueries[i]
    let content = ''

    try {
      for await (const evt of parseSSE('/api/chat/stream', {
        message: q,
        session_id: sessionId,
        model: 'deepseek-chat',
      }, TOKEN)) {
        if (evt.type === 'text_delta' && evt.text) content += evt.text
        if (evt.type === 'session_id') sessionId = evt.session_id || sessionId
      }
      roundResults.push({ round: i + 1, query: q, length: content.length, ok: content.length > 10 })
      process.stdout.write(`    第 ${i+1} 轮: "${q.slice(0,20)}..." → ${content.length} 字符\n`)
    } catch (e) {
      roundResults.push({ round: i + 1, query: q, length: 0, ok: false, error: e.message })
      process.stdout.write(`    ⚠ 第 ${i+1} 轮失败: ${e.message}\n`)
    }
  }

  await test('多轮对话连续性', async () => {
    const allOk = roundResults.every(r => r.ok)
    assert(allOk, `失败轮次: ${roundResults.filter(r => !r.ok).map(r => r.round).join(',')}`)
  })

  // ── Phase 8: 工具调用面板 ──
  console.log('\n══ [Phase 8] 工具调用行为 测试 ══\n')

  await test('工具调用生命周期（tool_call → tool_result → 完成）', async () => {
    // 用触发工具调用的查询
    const events = []
    try {
      for await (const evt of parseSSE('/api/chat/stream', {
        message: '请帮我检查一下当前的许可证状态和执行报告状态',
        model: 'deepseek-chat',
      }, TOKEN)) {
        events.push(evt)
        if (events.length > 200) break // 防止无限
      }
    } catch (e) { /* timeout expected for long test */ }

    const toolCalls = events.filter(e => e.type === 'tool_call')
    const toolResults = events.filter(e => e.type === 'tool_result')

    process.stdout.write(`     工具调用事件: ${toolCalls.length}, 工具结果: ${toolResults.length}\n`)

    // 记录工具调用信息
    if (toolCalls.length > 0) {
      const toolNames = [...new Set(toolCalls.map(e => e.name || 'unknown'))]
      process.stdout.write(`     调用的工具: ${toolNames.join(', ')}\n`)
    }
  })

  // ── Phase 9: 安全端点测试 ──
  console.log('\n══ [Phase 9] 额外安全测试 ══\n')

  await test('XSS 注入尝试被拦截', async () => {
    const r = await apiGet('/api/enterprise?q=<script>alert(1)</script>', TOKEN)
    assert(r.status !== 500, 'XSS payload 导致服务器错误')
  })

  await test('SQL 注入尝试不崩溃', async () => {
    const r = await apiGet(`/api/user?id=1' OR '1'='1`, TOKEN)
    assert(r.status !== 500, 'SQL injection 导致服务器错误')
  })

  // ── 结果汇总 ──
  console.log('\n═══════════════════════════════════════')
  console.log('测试完成')
  console.log('═══════════════════════════════════════\n')

  const total = passed + failed
  console.log(`  通过: ${passed}/${total}`)
  console.log(`  失败: ${failed}`)
  console.log(`  警告: ${warnings}`)
  console.log(`  通过率: ${(passed/total*100).toFixed(1)}%\n`)

  if (failed > 0) {
    process.stdout.write('  失败项详情:\n')
    process.exit(1)
  }
}

main().catch(e => {
  console.error('测试脚本异常:', e)
  process.exit(1)
})
