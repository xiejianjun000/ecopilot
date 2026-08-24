/**
 * fetchWithRetry 单元测试
 *
 * 验证场景：
 * 1. 首次成功 → 立即返回，不重试
 * 2. 首次空数组 → 等 1s 重试 → 第二次返回数据
 * 3. 两次都空数组 → 返回空数组（时序原因保留此行为）
 * 4. 首次抛异常 → 打 console.error → 等 1s 重试 → 第二次成功
 * 5. 两次都抛异常 → console.error 调用 2 次 → 返回空数组
 * 6. 自定义 retries / delayMs 参数
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchWithRetry } from './store'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchWithRetry', () => {
  it('首次成功则立即返回，不重试', async () => {
    const data = [{ id: '1', name: 'test' }]
    const spy = vi.fn().mockResolvedValue(data)

    const promise = fetchWithRetry("测试", spy)
    const result = await promise

    expect(spy).toHaveBeenCalledTimes(1)
    expect(result).toEqual(data)
  })

  it('首次返回空数组 → 重试 → 第二次返回数据', async () => {
    const data = [{ id: '2', name: 'retry success' }]
    const spy = vi.fn<() => Promise<unknown[]>>()
      .mockResolvedValueOnce([])                // 第1次：空（模拟 auth 未就绪）
      .mockResolvedValueOnce(data)              // 第2次：成功

    const promise = fetchWithRetry("自学习技能", spy)
    // 第一次返回空 → 内部会 setTimeout(1000)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(spy).toHaveBeenCalledTimes(2)
    expect(result).toEqual(data)
  })

  it('两次都返回空数组 → 最终返回空数组', async () => {
    const spy = vi.fn<() => Promise<unknown[]>>()
      .mockResolvedValue([])
      .mockResolvedValue([])

    const promise = fetchWithRetry("企业进化日志", spy)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(spy).toHaveBeenCalledTimes(2)
    expect(result).toEqual([])
  })

  it('首次抛异常 → console.error → 重试 → 第二次成功', async () => {
    const data = [{ id: '3', name: 'after error' }]
    const spy = vi.fn<() => Promise<unknown[]>>()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(data)

    const promise = fetchWithRetry("合规记忆", spy)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(spy).toHaveBeenCalledTimes(2)
    expect(result).toEqual(data)
    expect(console.error).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[store] 合规记忆 拉取失败"),
      expect.any(Error)
    )
  })

  it('两次都抛异常 → console.error 调用 2 次 → 返回空数组', async () => {
    const spy = vi.fn<() => Promise<unknown[]>>()
      .mockRejectedValue(new Error("Auth failed"))
      .mockRejectedValue(new Error("Auth failed again"))

    const promise = fetchWithRetry("自学习技能", spy)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(spy).toHaveBeenCalledTimes(2)
    expect(result).toEqual([])
    expect(console.error).toHaveBeenCalledTimes(2)
  })

  it('支持自定义 retries 次数', async () => {
    const spy = vi.fn<() => Promise<unknown[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'retry-3' }])

    const promise = fetchWithRetry("测试", spy, 3, 10)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(spy).toHaveBeenCalledTimes(3)
    expect(result).toEqual([{ id: 'retry-3' }])
  })

  it('自定义延迟时间生效', async () => {
    const spy = vi.fn<() => Promise<unknown[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ok: true }])

    const promise = fetchWithRetry("测试", spy, 2, 500)
    // 不应在 100ms 内完成（实际延迟是 500ms）
    await vi.advanceTimersByTimeAsync(100)
    expect(spy).toHaveBeenCalledTimes(1) // 还没到重试时间

    await vi.advanceTimersByTimeAsync(450)
    expect(spy).toHaveBeenCalledTimes(2) // 延迟时间到了，触发重试

    const result = await promise
    expect(result).toEqual([{ ok: true }])
  })
})
