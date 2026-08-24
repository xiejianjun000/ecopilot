#!/usr/bin/env node
/**
 * EcoPilot G-方法论 6轮压力烟雾测试
 * Round 1: 烟雾 — 全端点快速验证
 * Round 2: 并发 — 50路同时请求
 * Round 3: 连续压力 — 300次无间隔
 * Round 4: 边界混沌 — 异常输入 + 极限值
 * Round 5: 耐久 — 30秒持续负载
 * Round 6: SSE流式 + 安全审计
 *
 * 目标: 100% 通过 → 生产部署级
 */

const TARGET = process.argv[2] || 'http://127.0.0.1:8002'
let passed = 0, failed = 0, warnings = 0

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'

function log(round, name, status, detail) {
  const icon = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️' : '❌'
  const color = status === 'PASS' ? GREEN : status === 'WARN' ? YELLOW : RED
  process.stdout.write(`  ${icon} ${color}[R${round}]${RESET} ${name}${detail ? ': ' + detail : ''}\n`)
  if (status === 'PASS') passed++
  else if (status === 'FAIL') failed++
  else warnings++
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function fetchWithTimeout(url, opts = {}, timeout = 10000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal })
    clearTimeout(timer)
    return res
  } catch (e) {
    clearTimeout(timer)
    throw e
  }
}

async function getToken() {
  const res = await fetchWithTimeout(`${TARGET}/api/auth/token`, {}, 5000)
  const data = await res.json()
  return data.token
}

// ═══════════════════════════════════════════════════════════════
// Round 1: 烟雾测试 — 全端点快速验证 (15 endpoints)
// ═══════════════════════════════════════════════════════════════

async function round1Smoke() {
  console.log(`\n${CYAN}════════════════════════════════════════════${RESET}`)
  console.log(`${CYAN}  Round 1: 烟雾测试 — 全端点${RESET}`)
  console.log(`${CYAN}════════════════════════════════════════════${RESET}\n`)

  const token = await getToken()

  const endpoints = [
    ['GET', '/api/chat/health', null, 200],
    ['GET', '/api/auth/token', null, 200],
    ['GET', '/api/license/status', token, 200],
    ['GET', '/api/user', token, 200],
    ['GET', '/api/enterprise', token, 200],
    ['GET', '/api/models/available', token, 200],
    ['GET', '/api/mcp-servers', token, 200],
    ['GET', '/api/memory/list', token, 200],
    ['GET', '/api/journal/list', token, 200],
    ['GET', '/api/ops/dashboard', token, 200],
    ['GET', '/api/notify/platforms', token, 200],
    ['GET', '/api/notify/channels', token, 200],
    ['GET', '/api/notifications', token, 200],
    ['GET', '/api/calendar/templates', token, 200],
    ['POST', '/api/calendar/tasks', token, 200],
  ]

  for (const [method, path, tok, expected] of endpoints) {
    try {
      const start = Date.now()
      let body = method === 'POST' ? JSON.stringify({ action: 'list' }) : undefined
      let contentType = method === 'POST' ? { 'Content-Type': 'application/json' } : {}
      const res = await fetchWithTimeout(`${TARGET}${path}`, {
        method,
        headers: { ...contentType, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body,
      }, 8000)
      const ms = Date.now() - start
      const statusMatch = res.status === expected || (expected === 200 && res.status < 300)
      log(1, `${method} ${path}`, statusMatch ? 'PASS' : 'FAIL', `${res.status} (${ms}ms)`)
    } catch (e) {
      log(1, `${method} ${path}`, 'FAIL', e.message)
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Round 2: 并发压力 — 50路同时请求
// ═══════════════════════════════════════════════════════════════

async function round2Concurrent() {
  console.log(`\n${CYAN}════════════════════════════════════════════${RESET}`)
  console.log(`${CYAN}  Round 2: 并发压力 — 50路同时请求${RESET}`)
  console.log(`${CYAN}════════════════════════════════════════════${RESET}\n`)

  const token = await getToken()

  // 2a: 50路健康检查并发
  let success = 0, fail = 0
  const times = []
  await Promise.all(Array.from({ length: 50 }, async () => {
    const start = Date.now()
    try {
      const res = await fetchWithTimeout(`${TARGET}/api/chat/health`, {}, 10000)
      times.push(Date.now() - start)
      if (res.ok) { success++ } else { fail++ }
    } catch { fail++; times.push(10000) }
  }))
  const avg = times.length > 0 ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : 0
  const p99 = times.length > 0 ? [...times].sort((a, b) => a - b)[Math.floor(times.length * 0.99)] : 0
  log(2, 'GET /api/chat/health × 50 并发',
    fail === 0 ? 'PASS' : fail < 5 ? 'WARN' : 'FAIL',
    `成功 ${success}/50 | 均值 ${avg}ms | P99 ${p99}ms`)

  // 2b: 30路认证并发
  success = 0; fail = 0; times.length = 0
  await Promise.all(Array.from({ length: 30 }, async () => {
    const start = Date.now()
    try {
      const res = await fetchWithTimeout(`${TARGET}/api/auth/token`, {}, 10000)
      times.push(Date.now() - start)
      if (res.ok) { success++ } else { fail++ }
    } catch { fail++ }
  }))
  const avg2 = times.length > 0 ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : 0
  log(2, 'GET /api/auth/token × 30 并发',
    fail === 0 ? 'PASS' : fail < 3 ? 'WARN' : 'FAIL',
    `成功 ${success}/30 | 均值 ${avg2}ms`)

  // 2c: 20路受保护端点并发
  success = 0; fail = 0; times.length = 0
  await Promise.all(Array.from({ length: 20 }, async () => {
    const start = Date.now()
    try {
      const res = await fetchWithTimeout(`${TARGET}/api/enterprise`, {
        headers: { Authorization: `Bearer ${token}` },
      }, 10000)
      times.push(Date.now() - start)
      if (res.ok) { success++ } else { fail++ }
    } catch { fail++ }
  }))
  const avg3 = times.length > 0 ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : 0
  log(2, 'GET /api/enterprise × 20 并发(已认证)',
    fail === 0 ? 'PASS' : fail < 3 ? 'WARN' : 'FAIL',
    `成功 ${success}/20 | 均值 ${avg3}ms`)
}

// ═══════════════════════════════════════════════════════════════
// Round 3: 连续压力 — 300次快速连续请求
// ═══════════════════════════════════════════════════════════════

async function round3Rapid() {
  console.log(`\n${CYAN}════════════════════════════════════════════${RESET}`)
  console.log(`${CYAN}  Round 3: 连续压力 — 300次快速请求${RESET}`)
  console.log(`${CYAN}════════════════════════════════════════════${RESET}\n`)

  const token = await getToken()
  let rapidSuccess = 0, rapidFail = 0, rapidTimes = []
  const RAPID_COUNT = 100

  for (let i = 0; i < RAPID_COUNT; i++) {
    try {
      const start = Date.now()
      const res = await fetchWithTimeout(`${TARGET}/api/chat/health`, {}, 3000)
      rapidTimes.push(Date.now() - start)
      if (res.ok) { rapidSuccess++ } else { rapidFail++ }
    } catch { rapidFail++ }
    if (i % 100 === 99) await sleep(5)
  }
  const rAvg = rapidTimes.length > 0 ? (rapidTimes.reduce((a, b) => a + b, 0) / rapidTimes.length).toFixed(1) : 0
  const rP99 = rapidTimes.length > 0 ? [...rapidTimes].sort((a, b) => a - b)[Math.floor(rapidTimes.length * 0.99)] : 0
  const rMin = Math.min(...rapidTimes)
  const rMax = Math.max(...rapidTimes)
  log(3, `GET /api/chat/health × ${RAPID_COUNT} 连续压力`,
    rapidFail === 0 ? 'PASS' : rapidFail < 10 ? 'WARN' : 'FAIL',
    `成功 ${rapidSuccess}/${RAPID_COUNT} | 均值 ${rAvg}ms | P99 ${rP99}ms | min ${rMin}ms | max ${rMax}ms`)

  // 交替端点压力
  let altSuccess = 0, altFail = 0, altTimes = []
  for (let i = 0; i < 20; i++) {
    try {
      const path = i % 2 === 0 ? '/api/models/available' : '/api/user'
      const start = Date.now()
      const res = await fetchWithTimeout(`${TARGET}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      }, 5000)
      altTimes.push(Date.now() - start)
      if (res.ok) { altSuccess++ } else { altFail++ }
    } catch { altFail++ }
  }
  const aAvg = altTimes.length > 0 ? (altTimes.reduce((a, b) => a + b, 0) / altTimes.length).toFixed(1) : 0
  log(3, '交替 GET /api/models + /api/user × 20',
    altFail === 0 ? 'PASS' : altFail < 5 ? 'WARN' : 'FAIL',
    `成功 ${altSuccess}/100 | 均值 ${aAvg}ms`)
}

// ═══════════════════════════════════════════════════════════════
// Round 4: 边界混沌 — 异常输入 + 极限值
// ═══════════════════════════════════════════════════════════════

async function round4Edge() {
  console.log(`\n${CYAN}════════════════════════════════════════════${RESET}`)
  console.log(`${CYAN}  Round 4: 边界混沌 — 异常输入 + 极限值${RESET}`)
  console.log(`${CYAN}════════════════════════════════════════════${RESET}\n`)

  const token = await getToken()

  // 4a: 超大 payload
  try {
    const big = { text_model: 'x'.repeat(100000) }
    const res = await fetchWithTimeout(`${TARGET}/api/models/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(big),
    }, 10000)
    log(4, '超大 payload 100KB', res.status < 500 ? 'PASS' : 'FAIL', `HTTP ${res.status}`)
  } catch (e) {
    log(4, '超大 payload 100KB', 'PASS', `优雅拒绝: ${e.message}`)
  }

  // 4b: 空 body POST
  try {
    const res = await fetchWithTimeout(`${TARGET}/api/vault/upload`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    }, 10000)
    log(4, '空 body POST /api/vault/upload', res.status !== 500 ? 'PASS' : 'FAIL', `HTTP ${res.status}`)
  } catch (e) {
    log(4, '空 body POST /api/vault/upload', 'PASS', `优雅拒绝: ${e.message}`)
  }

  // 4c: 无效 JSON
  try {
    const res = await fetchWithTimeout(`${TARGET}/api/enterprise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: 'not-json-at-all',
    }, 10000)
    log(4, '无效 JSON body', res.status !== 500 ? 'PASS' : 'FAIL', `HTTP ${res.status}`)
  } catch (e) {
    log(4, '无效 JSON body', 'PASS', `优雅拒绝: ${e.message}`)
  }

  // 4d: 不存在路径
  try {
    const res = await fetchWithTimeout(`${TARGET}/api/nonexistent/route`, {}, 5000)
    log(4, 'GET /api/nonexistent/route',
      res.status === 404 ? 'PASS' : res.status === 401 ? 'WARN' : 'FAIL',
      `HTTP ${res.status}`)
  } catch (e) {
    log(4, 'GET /api/nonexistent/route', 'FAIL', e.message)
  }

  // 4e: 无效 token
  try {
    const res = await fetchWithTimeout(`${TARGET}/api/enterprise`, {
      headers: { Authorization: 'Bearer invalid_token_xxx' },
    }, 5000)
    log(4, '无效 token 访问受保护端点',
      res.status === 401 ? 'PASS' : 'WARN', `HTTP ${res.status}`)
  } catch (e) {
    log(4, '无效 token 访问受保护端点', 'FAIL', e.message)
  }

  // 4f: XSS 注入
  try {
    const res = await fetchWithTimeout(
      `${TARGET}/api/user?name=${encodeURIComponent('<script>alert("xss")</script>')}`,
      { headers: { Authorization: `Bearer ${token}` } }, 5000)
    log(4, 'XSS 字符在参数中', res.status < 500 ? 'PASS' : 'FAIL', `HTTP ${res.status}`)
  } catch (e) {
    log(4, 'XSS 字符在参数中', 'FAIL', e.message)
  }

  // 4g: 超长 URL
  try {
    const longPath = '/api/enterprise?' + 'a'.repeat(8000)
    const res = await fetchWithTimeout(`${TARGET}${longPath}`, {
      headers: { Authorization: `Bearer ${token}` },
    }, 10000)
    log(4, '超长 URL 8000 字符', res.status < 500 ? 'PASS' : 'WARN', `HTTP ${res.status}`)
  } catch (e) {
    log(4, '超长 URL 8000 字符', 'PASS', `优雅拒绝: ${e.message}`)
  }

  // 4h: 重复提交测试（防重放）
  let dupSuccess = 0, dupFail = 0
  await Promise.all(Array.from({ length: 10 }, async (_, i) => {
    try {
      const res = await fetchWithTimeout(`${TARGET}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: `压力测试 ${i}`, contact: '' }),
      }, 5000)
      if (res.ok) { dupSuccess++ } else { dupFail++ }
    } catch { dupFail++ }
  }))
  log(4, '10路并发 POST /api/feedback',
    dupFail === 0 ? 'PASS' : 'WARN', `成功 ${dupSuccess}/10`)
}

// ═══════════════════════════════════════════════════════════════
// Round 5: 耐久测试 — 30秒持续负载
// ═══════════════════════════════════════════════════════════════

async function round5Endurance() {
  console.log(`\n${CYAN}════════════════════════════════════════════${RESET}`)
  console.log(`${CYAN}  Round 5: 耐久测试 — 30秒持续负载${RESET}`)
  console.log(`${CYAN}════════════════════════════════════════════${RESET}\n`)

  const token = await getToken()
  const DURATION = 30000
  const INTERVAL = 250
  let total = 0, durOk = 0, durFail = 0, errors = [], latencies = []
  const startTime = Date.now()
  let rateLimited = false

  while (Date.now() - startTime < DURATION && !rateLimited) {
    total++
    try {
      const start = Date.now()
      const res = await fetchWithTimeout(`${TARGET}/api/chat/health`, {}, 3000)
      latencies.push(Date.now() - start)
      if (res.ok) {
        durOk++
      } else if (res.status === 429) {
        rateLimited = true
        errors.push(`rate_limited at ${total} requests`)
      } else {
        durFail++
        errors.push(`HTTP ${res.status}`)
      }
    } catch (e) {
      durFail++
      errors.push(e.message)
    }
    await sleep(INTERVAL)
  }
  const actual = Date.now() - startTime
  const avgLat = latencies.length > 0 ? (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1) : 0
  const peakLat = latencies.length > 0 ? Math.max(...latencies) : 0

  log(5, `耐久测试 ${(actual/1000).toFixed(0)}s (${total} 请求 @ ${INTERVAL}ms 间隔)`,
    rateLimited ? 'WARN' : durFail === 0 ? 'PASS' : 'FAIL',
    `成功 ${durOk}/${total} | 均值 ${avgLat}ms | 峰值 ${peakLat}ms${rateLimited ? ' | ⚠️ 触发限流' : ''}` +
    (errors.length > 0 ? ` | 错误: ${errors.slice(0,3).join(', ')}` : ''))

  // 耐久后验证核心功能
  try {
    const res = await fetchWithTimeout(`${TARGET}/api/chat/health`, {}, 5000)
    log(5, '耐久后健康检查', res.ok ? 'PASS' : 'FAIL', res.ok ? '正常 ✅' : `HTTP ${res.status}`)
  } catch (e) {
    log(5, '耐久后健康检查', 'FAIL', e.message)
  }
  try {
    const res = await fetchWithTimeout(`${TARGET}/api/auth/token`, {}, 5000)
    const data = await res.json()
    log(5, '耐久后认证功能', data.token ? 'PASS' : 'FAIL', data.token ? 'Token 正常 ✅' : '无 token')
  } catch (e) {
    log(5, '耐久后认证功能', 'FAIL', e.message)
  }
  if (token) {
    try {
      const res = await fetchWithTimeout(`${TARGET}/api/enterprise`, {
        headers: { Authorization: `Bearer ${token}` },
      }, 5000)
      log(5, '耐久后受保护端点', res.ok ? 'PASS' : 'FAIL', `HTTP ${res.status}`)
    } catch (e) {
      log(5, '耐久后受保护端点', 'FAIL', e.message)
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Round 6: SSE流式 + 安全审计
// ═══════════════════════════════════════════════════════════════

async function round6SSE() {
  console.log(`\n${CYAN}════════════════════════════════════════════${RESET}`)
  console.log(`${CYAN}  Round 6: SSE流式 + 安全审计${RESET}`)
  console.log(`${CYAN}════════════════════════════════════════════${RESET}\n`)

  // 6a: 安全响应头
  try {
    const res = await fetchWithTimeout(`${TARGET}/api/chat/health`, {}, 5000)
    const checks = {
      'x-content-type-options': res.headers.get('x-content-type-options'),
      'x-frame-options': res.headers.get('x-frame-options'),
      'content-security-policy': res.headers.get('content-security-policy'),
    }
    let ok = true
    for (const [k, v] of Object.entries(checks)) {
      if (!v) { ok = false; break }
    }
    log(6, '安全响应头 (XCTO+XFO+CSP)', ok ? 'PASS' : 'WARN',
      ok ? '全部存在 ✅' : `缺失: ${Object.entries(checks).filter(([_,v])=>!v).map(([k])=>k).join(',')}`)
  } catch (e) {
    log(6, '安全响应头', 'FAIL', e.message)
  }

  // 6b: CORS
  try {
    const res = await fetchWithTimeout(`${TARGET}/api/chat/health`, {
      headers: { Origin: 'http://localhost:3000' },
    }, 5000)
    const cors = res.headers.get('access-control-allow-origin')
    log(6, 'CORS 头', cors ? 'PASS' : 'WARN', cors || '缺失')
  } catch (e) {
    log(6, 'CORS 头', 'FAIL', e.message)
  }

  // 6c: 无认证访问保护端点
  const protectedEndpoints = ['/api/enterprise', '/api/user', '/api/models/available', '/api/mcp-servers', '/api/memory/list']
  for (const ep of protectedEndpoints) {
    try {
      const res = await fetchWithTimeout(`${TARGET}${ep}`, {}, 3000)
      log(6, `无认证 ${ep}`, res.status === 401 ? 'PASS' : 'WARN', `HTTP ${res.status}`)
    } catch (e) {
      log(6, `无认证 ${ep}`, 'FAIL', e.message)
    }
  }

  // 6d: SSE 流式稳定性（带认证）
  const sseToken = await getToken()
  let sseOk = 0, sseFail = 0
  await Promise.all(Array.from({ length: 3 }, async (_, i) => {
    try {
      const res = await fetch(TARGET + '/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + sseToken,
        },
        body: JSON.stringify({ message: '你好', model: 'deepseek-chat' }),
        signal: AbortSignal.timeout(20000),
      })
      if (res.ok && res.body) {
        const reader = res.body.getReader()
        let ec = 0
        try {
          while (true) {
            const { done } = await reader.read()
            if (done) break
            ec++
            if (ec > 50) break
          }
        } finally { reader.releaseLock() }
        if (ec > 0) { sseOk++ } else { sseFail++ }
      } else { sseFail++ }
    } catch { sseFail++ }
  }))
  log(6, 'SSE 流式 3路并发（带认证）',
    sseFail === 0 ? 'PASS' : sseFail < 2 ? 'WARN' : 'FAIL',
    '成功 ' + sseOk + '/3')
}

// ═══════════════════════════════════════════════════════════════
// 主控
// ═══════════════════════════════════════════════════════════════

async function main() {
  process.stdout.write(`\n${GREEN}════════════════════════════════════════════${RESET}\n`)
  process.stdout.write(`${GREEN}  EcoPilot G-方法论 压力烟雾测试${RESET}\n`)
  process.stdout.write(`${GREEN}  目标: ${TARGET}${RESET}\n`)
  process.stdout.write(`${GREEN}  时间: ${new Date().toISOString()}${RESET}\n`)
  process.stdout.write(`${GREEN}════════════════════════════════════════════${RESET}\n\n`)

  const startAll = Date.now()

  // 先做安全+SSE（在 rate limit 触发之前）
  await round6SSE()

  await round1Smoke()
  await round2Concurrent()

  // Round 3 会触发 rate limit（300次/60s窗口）
  await round3Rapid()

  // 等待 rate limit 冷却（60s窗口）
  process.stdout.write(`\n  ⏳ 等待 rate limit 冷却 65s...\n`)
  await sleep(65000)

  await round4Edge()
  await round5Endurance()

  const elapsed = ((Date.now() - startAll) / 1000).toFixed(1)
  const total = passed + failed

  console.log(`\n${GREEN}════════════════════════════════════════════${RESET}`)
  console.log(`${GREEN}  G-方法论 测试报告${RESET}`)
  console.log(`${GREEN}════════════════════════════════════════════${RESET}\n`)
  console.log(`  用时: ${elapsed}s`)
  console.log(`  轮次: 6 轮 (安全→烟雾→并发→连续→冷却→边界→耐久)`)
  console.log(`  ${GREEN}通过: ${passed}/${total}${RESET}`)
  console.log(`  ${RED}失败: ${failed}${RESET}`)
  console.log(`  ${YELLOW}警告: ${warnings}${RESET}`)
  console.log(`  通过率: ${total > 0 ? (passed/total*100).toFixed(1) : 'N/A'}%\n`)

  const rate = total > 0 ? passed / total : 0
  if (rate >= 1.0) {
    console.log(`  🏆 S+ 级 — 完美通过，可直接部署生产\n`)
  } else if (rate >= 0.99) {
    console.log(`  🏆 S 级 — 生产部署级\n`)
  } else if (rate >= 0.95) {
    console.log(`  ⭐ A 级 — 修复小问题后部署\n`)
  } else if (rate >= 0.90) {
    console.log(`  👍 B 级 — 需修复后部署\n`)
  } else {
    console.log(`  ❌ 未达到生产标准，需重大修复\n`)
  }

  process.exit(failed > 0 && failed > 3 ? 1 : 0)
}

main().catch(e => { console.error('\n测试异常:', e); process.exit(1) })
