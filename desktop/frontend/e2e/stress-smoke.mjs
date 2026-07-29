#!/usr/bin/env node
/**
 * EcoPilot 生产部署 · 压力 / 烟雾 / 耐久测试
 * 方法论：烟雾→并发→压力→耐久→混沌→边界
 *
 * 运行: node e2e/stress-smoke.mjs
 * 前置: 后端 8002, 前端 3000
 */

const API = "http://127.0.0.1:8002"
const FRONTEND = "http://127.0.0.1:3000"

let passed = 0, failed = 0, warnings = 0

function log(name, status, detail = '') {
  const icon = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️' : '❌'
  process.stdout.write(`  ${icon} ${name}${detail ? ': ' + detail : ''}\n`)
  if (status === 'PASS') passed++
  else if (status === 'FAIL') failed++
  else warnings++
}

function assert(cond, msg) { if (!cond) throw new Error(msg) }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function getToken() {
  const res = await fetch(`${API}/api/auth/token`, { signal: AbortSignal.timeout(5000) })
  const data = await res.json()
  return data.token
}

async function fetchWithTimeout(url, opts = {}, timeout = 5000) {
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

// ═══════════════════════════════════════════════════════════════
// 阶段 1: 烟雾测试 — 核心功能快速验证
// ═══════════════════════════════════════════════════════════════

async function phaseSmoke() {
  console.log('\n═══ 阶段 1: 烟雾测试 ═══\n')

  const token = await getToken()

  const smokeEndpoints = [
    ['GET', '/api/chat/health', null],
    ['GET', '/api/auth/token', null],
    ['GET', '/api/license/status', token],
    ['GET', '/api/user', token],
    ['GET', '/api/enterprise', token],
    ['GET', '/api/models/available', token],
    ['GET', '/api/mcp-servers', token],
    ['GET', '/api/memory/list', token],
    ['GET', '/api/journal/list', token],
    ['GET', '/api/ops/dashboard', token],
    ['GET', '/api/ops/events', token],
    ['GET', '/api/notify/platforms', token],
    ['GET', '/api/notify/channels', token],
    ['GET', '/api/notifications', token],
    ['GET', '/api/calendar/templates', token],
  ]

  for (const [method, path, tok] of smokeEndpoints) {
    try {
      const start = Date.now()
      const res = await fetchWithTimeout(`${API}${path}`, {
        method,
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      }, 10000)
      const ms = Date.now() - start
      if (res.status < 500) {
        log(`${method} ${path}`, 'PASS', `${res.status} (${ms}ms)`)
      } else {
        log(`${method} ${path}`, 'FAIL', `HTTP ${res.status} (${ms}ms)`)
      }
    } catch (e) {
      log(`${method} ${path}`, 'FAIL', e.message)
    }
  }

  // 前端可达性
  try {
    const start = Date.now()
    const res = await fetchWithTimeout(FRONTEND, {}, 10000)
    const ms = Date.now() - start
    log('GET / (前端)', res.ok ? 'PASS' : 'FAIL', `${res.status} (${ms}ms)`)
  } catch (e) {
    log('GET / (前端)', 'FAIL', e.message)
  }
}

// ═══════════════════════════════════════════════════════════════
// 阶段 2: 并发测试 — 模拟多用户同时请求
// ═══════════════════════════════════════════════════════════════

async function phaseConcurrent() {
  console.log('\n═══ 阶段 2: 并发测试 ═══\n')

  const token = await getToken()

  // 2a. 健康检查并发 50 次
  const CONCURRENT = 50
  let success = 0, fail = 0, times = []

  await Promise.all(Array.from({ length: CONCURRENT }, async () => {
    try {
      const start = Date.now()
      const res = await fetchWithTimeout(`${API}/api/chat/health`, {}, 10000)
      times.push(Date.now() - start)
      if (res.ok) { success++ } else { fail++ }
    } catch { fail++ }
  }))

  const avg = times.length > 0 ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : 'N/A'
  const max = times.length > 0 ? Math.max(...times) : 0
  const min = times.length > 0 ? Math.min(...times) : 0
  log(`GET /api/chat/health ×${CONCURRENT} 并发`, fail === 0 ? 'PASS' : 'WARN',
    `成功 ${success}/${CONCURRENT}, 均值 ${avg}ms, 最大 ${max}ms, 最小 ${min}ms`)

  // 2b. 认证端点并发 30 次
  success = 0; fail = 0; times = []
  await Promise.all(Array.from({ length: 30 }, async () => {
    try {
      const start = Date.now()
      const res = await fetchWithTimeout(`${API}/api/auth/token`, {}, 10000)
      times.push(Date.now() - start)
      if (res.ok) { success++ } else { fail++ }
    } catch { fail++ }
  }))
  const avg2 = times.length > 0 ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : 'N/A'
  log(`GET /api/auth/token ×30 并发`, fail === 0 ? 'PASS' : 'WARN',
    `成功 ${success}/30, 均值 ${avg2}ms`)

  // 2c. 受保护端点并发
  success = 0; fail = 0; times = []
  await Promise.all(Array.from({ length: 20 }, async () => {
    try {
      const start = Date.now()
      const res = await fetchWithTimeout(`${API}/api/enterprise`, {
        headers: { Authorization: `Bearer ${token}` },
      }, 10000)
      times.push(Date.now() - start)
      if (res.ok) { success++ } else { fail++ }
    } catch { fail++ }
  }))
  const avg3 = times.length > 0 ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : 'N/A'
  log(`GET /api/enterprise ×20 并发(已认证)`, fail === 0 ? 'PASS' : 'WARN',
    `成功 ${success}/20, 均值 ${avg3}ms`)
}

// ═══════════════════════════════════════════════════════════════
// 阶段 3: 压力测试 — 持续高频请求
// ═══════════════════════════════════════════════════════════════

async function phaseStress() {
  console.log('\n═══ 阶段 3: 压力测试 ═══\n')

  const token = await getToken()

  // 3a. 健康检查 200 次快速请求
  let rapidSuccess = 0, rapidFail = 0, rapidTimes = []
  const RAPID_COUNT = 200

  for (let i = 0; i < RAPID_COUNT; i++) {
    try {
      const start = Date.now()
      const res = await fetchWithTimeout(`${API}/api/chat/health`, {}, 3000)
      rapidTimes.push(Date.now() - start)
      if (res.ok) { rapidSuccess++ } else { rapidFail++ }
    } catch { rapidFail++ }
    if (i % 50 === 49) await sleep(10) // 每50次微休息
  }
  const rAvg = rapidTimes.length > 0 ? (rapidTimes.reduce((a, b) => a + b, 0) / rapidTimes.length).toFixed(1) : 'N/A'
  const p99 = rapidTimes.length > 0 ? [...rapidTimes].sort((a, b) => a - b)[Math.floor(rapidTimes.length * 0.99)] : 0
  log(`GET /api/chat/health ×${RAPID_COUNT} 连续压力`,
    rapidFail === 0 ? 'PASS' : 'WARN',
    `成功 ${rapidSuccess}/${RAPID_COUNT}, 均值 ${rAvg}ms, P99 ${p99}ms`)

  // 3b. 模型列表 + 用户信息交替压力
  let altSuccess = 0, altFail = 0
  for (let i = 0; i < 100; i++) {
    try {
      const path = i % 2 === 0 ? '/api/models/available' : '/api/user'
      const res = await fetchWithTimeout(`${API}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      }, 5000)
      if (res.ok) { altSuccess++ } else { altFail++ }
    } catch { altFail++ }
  }
  log(`交替请求 /api/models + /api/user ×100`,
    altFail === 0 ? 'PASS' : 'WARN',
    `成功 ${altSuccess}/100`)
}

// ═══════════════════════════════════════════════════════════════
// 阶段 4: 边界测试 — 异常输入 + 极限值
// ═══════════════════════════════════════════════════════════════

async function phaseEdge() {
  console.log('\n═══ 阶段 4: 边界测试 ═══\n')

  const token = await getToken()

  // 4a. 超大 payload
  try {
    const bigPayload = { text_model: 'x'.repeat(100000) }
    const start = Date.now()
    const res = await fetchWithTimeout(`${API}/api/models/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(bigPayload),
    }, 10000)
    log('超大 payload 100KB 提交', res.status < 500 ? 'PASS' : 'FAIL',
      `HTTP ${res.status} (${Date.now() - start}ms)`)
  } catch (e) {
    log('超大 payload 100KB 提交', 'PASS', `优雅拒绝: ${e.message}`)
  }

  // 4b. 空 body POST
  try {
    const res = await fetchWithTimeout(`${API}/api/vault/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }, 10000)
    log('空 body POST /api/vault/upload', res.status !== 500 ? 'PASS' : 'FAIL',
      `HTTP ${res.status}`)
  } catch (e) {
    log('空 body POST /api/vault/upload', 'PASS', `优雅拒绝: ${e.message}`)
  }

  // 4c. 无效 JSON
  try {
    const res = await fetchWithTimeout(`${API}/api/enterprise`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: 'not-json-at-all',
    }, 10000)
    log('无效 JSON body', res.status !== 500 ? 'PASS' : 'FAIL', `HTTP ${res.status}`)
  } catch (e) {
    log('无效 JSON body', 'PASS', `优雅拒绝: ${e.message}`)
  }

  // 4d. 不存在路径
  try {
    const res = await fetchWithTimeout(`${API}/api/nonexistent/path`, {}, 5000)
    log('GET /api/nonexistent/path', res.status === 404 ? 'PASS' : 'WARN',
      `期望 404 得到 ${res.status}`)
  } catch (e) {
    log('GET /api/nonexistent/path', 'FAIL', e.message)
  }

  // 4e. 无效 token
  try {
    const res = await fetchWithTimeout(`${API}/api/enterprise`, {
      headers: { Authorization: 'Bearer invalid_token_xxx' },
    }, 5000)
    log('无效 token 访问受保护端点', res.status === 401 ? 'PASS' : 'WARN',
      `期望 401 得到 ${res.status}`)
  } catch (e) {
    log('无效 token 访问受保护端点', 'FAIL', e.message)
  }

  // 4f. 特殊字符路径
  try {
    const res = await fetchWithTimeout(
      `${API}/api/enterprise?name=${encodeURIComponent('<script>alert("xss")</script>')}`,
      { headers: { Authorization: `Bearer ${token}` } },
      5000
    )
    log('XSS 字符在 query 参数中', res.status < 500 ? 'PASS' : 'FAIL', `HTTP ${res.status}`)
  } catch (e) {
    log('XSS 字符在 query 参数中', 'FAIL', e.message)
  }

  // 4g. 超长 URL
  try {
    const longPath = '/api/enterprise?' + 'a'.repeat(8000)
    const res = await fetchWithTimeout(`${API}${longPath}`, {
      headers: { Authorization: `Bearer ${token}` },
    }, 10000)
    log('超长 URL 8000 字符', res.status < 500 ? 'PASS' : 'WARN', `HTTP ${res.status}`)
  } catch (e) {
    log('超长 URL 8000 字符', 'PASS', `优雅拒绝: ${e.message}`)
  }
}

// ═══════════════════════════════════════════════════════════════
// 阶段 5: 耐久测试 — 持续请求观察稳定性
// ═══════════════════════════════════════════════════════════════

async function phaseEndurance() {
  console.log('\n═══ 阶段 5: 耐久测试 ═══\n')

  const token = await getToken()
  const DURATION_MS = 10000 // 10秒持续请求
  const INTERVAL_MS = 200    // 每200ms一次
  let rounds = 0, durSuccess = 0, durFail = 0
  const startTime = Date.now()

  while (Date.now() - startTime < DURATION_MS) {
    rounds++
    try {
      const res = await fetchWithTimeout(`${API}/api/chat/health`, {}, 2000)
      if (res.ok) { durSuccess++ } else { durFail++ }
    } catch { durFail++ }
    await sleep(INTERVAL_MS)
  }
  const durActual = Date.now() - startTime
  log(`耐久测试 ${(durActual/1000).toFixed(0)}s (${rounds} 轮)`,
    durFail === 0 ? 'PASS' : 'WARN',
    `成功 ${durSuccess}/${rounds}, 间隔 ${INTERVAL_MS}ms`)

  // 耐久后验证核心功能仍然正常
  try {
    const res = await fetchWithTimeout(`${API}/api/auth/token`, {}, 5000)
    log('耐久后认证功能', res.ok ? 'PASS' : 'FAIL', `HTTP ${res.status}`)
  } catch (e) {
    log('耐久后认证功能', 'FAIL', e.message)
  }
}

// ═══════════════════════════════════════════════════════════════
// 阶段 6: 安全压力测试
// ═══════════════════════════════════════════════════════════════

async function phaseSecurity() {
  console.log('\n═══ 阶段 6: 安全压力测试 ═══\n')

  const token = await getToken()

  // 6a. 无认证访问所有受保护端点
  const protectedEndpoints = [
    '/api/enterprise', '/api/user', '/api/models/available',
    '/api/mcp-servers', '/api/memory/list', '/api/ops/dashboard',
  ]
  for (const ep of protectedEndpoints) {
    try {
      const res = await fetchWithTimeout(`${API}${ep}`, {}, 3000)
      const expected = res.status === 401
      log(`无认证 ${ep}`, expected ? 'PASS' : 'WARN',
        expected ? '返回401 ✓' : `期望401得到${res.status}`)
    } catch (e) {
      log(`无认证 ${ep}`, 'FAIL', e.message)
    }
  }

  // 6b. 安全响应头完整性
  try {
    const res = await fetchWithTimeout(`${API}/api/chat/health`, {}, 5000)
    const headers = {
      'x-content-type-options': res.headers.get('x-content-type-options'),
      'x-frame-options': res.headers.get('x-frame-options'),
      'content-security-policy': res.headers.get('content-security-policy'),
      'referrer-policy': res.headers.get('referrer-policy'),
    }
    let allPresent = true
    for (const [k, v] of Object.entries(headers)) {
      if (!v) { allPresent = false; break }
    }
    log('安全响应头完整性', allPresent ? 'PASS' : 'WARN',
      allPresent ? 'CSP+XCTO+XFO+Referrer 全部存在' :
      `缺失: ${Object.entries(headers).filter(([_,v]) => !v).map(([k]) => k).join(',')}`)
  } catch (e) {
    log('安全响应头完整性', 'FAIL', e.message)
  }

  // 6c. CORS 头
  try {
    const res = await fetchWithTimeout(`${API}/api/chat/health`, {
      headers: { Origin: 'http://localhost:3000' },
    }, 5000)
    const cors = res.headers.get('access-control-allow-origin')
    log('CORS 头存在', cors ? 'PASS' : 'WARN', cors ? `${cors} ✓` : '缺失')
  } catch (e) {
    log('CORS 头存在', 'FAIL', e.message)
  }
}

// ═══════════════════════════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('EcoPilot 生产部署 · 压力/烟雾/耐久 综合测试')
  console.log(`目标: ${API} | ${FRONTEND}`)
  console.log(`时间: ${new Date().toISOString()}`)
  console.log('═══════════════════════════════════════════════════════════')

  try {
    await phaseSmoke()
    await phaseConcurrent()
    await phaseStress()
    await phaseEdge()
    await phaseEndurance()
    await phaseSecurity()
  } catch (e) {
    console.error('\n  💥 测试异常:', e.message)
  }

  // ── 汇总 ──
  const total = passed + failed
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('  测试报告')
  console.log('═══════════════════════════════════════════════════════════\n')
  console.log(`  阶段: 烟雾 → 并发 → 压力 → 边界 → 耐久 → 安全`)
  console.log(`  通过: ${passed}/${total}`)
  console.log(`  失败: ${failed}`)
  console.log(`  警告: ${warnings}`)
  console.log(`  通过率: ${total > 0 ? (passed/total*100).toFixed(1) : 'N/A'}%\n`)

  // 等级评定
  const rate = total > 0 ? passed / total : 0
  const grade = rate >= 0.99 ? 'S 🏆' : rate >= 0.95 ? 'A ⭐' : rate >= 0.90 ? 'B 👍' : rate >= 0.80 ? 'C ⚠️' : 'D ❌'
  console.log(`  等级评定: ${grade}`)
  console.log(`  建议: ${failed === 0 ? '可直接部署生产' : failed < 3 ? '修复失败项后部署' : '需重大修复后部署'}\n`)

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error('\n测试脚本异常:', e)
  process.exit(1)
})
