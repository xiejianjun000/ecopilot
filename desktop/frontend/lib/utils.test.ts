import { describe, it, expect } from 'vitest'
import { cn, stripMarkdown } from './utils'

describe('cn', () => {
  it('returns single class unchanged', () => {
    expect(cn('px-2')).toBe('px-2')
  })

  it('joins multiple classes', () => {
    expect(cn('px-2', 'py-1', 'text-sm')).toBe('px-2 py-1 text-sm')
  })

  it('handles conditional classes (clsx behavior)', () => {
    expect(cn('base', false && 'hidden', null, undefined, 'visible')).toBe('base visible')
    expect(cn('a', { b: true, c: false }, ['d', 'e'])).toBe('a b d e')
  })

  it('lets later class win on tailwind-merge conflicts', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
    expect(cn('text-sm', 'text-lg')).toBe('text-lg')
    // tailwind-merge keeps the position of the first conflicting class
    expect(cn('p-2 p-4 m-1')).toBe('p-4 m-1')
    expect(cn('p-2 m-1 p-4')).toBe('m-1 p-4')
  })

  it('merges conditional + tailwind conflicts together', () => {
    expect(cn('px-2', { 'px-8': true, hidden: false }, 'block')).toBe('px-8 block')
  })

  it('returns empty string for no inputs', () => {
    expect(cn()).toBe('')
  })
})

describe('stripMarkdown', () => {
  it('去除标题标记', () => {
    expect(stripMarkdown('### 标题')).toBe('标题')
    expect(stripMarkdown('# 一级标题\n\n内容')).toBe('一级标题\n\n内容')
  })

  it('去除加粗和斜体', () => {
    expect(stripMarkdown('这是**加粗**文字')).toBe('这是加粗文字')
    expect(stripMarkdown('这是*斜体*文字')).toBe('这是斜体文字')
  })

  it('去除链接保留文字', () => {
    expect(stripMarkdown('参考[链接](https://example.com)')).toBe('参考链接')
  })

  it('去除水平分割线', () => {
    expect(stripMarkdown('上文\n---\n下文')).toBe('上文\n\n下文')
    expect(stripMarkdown('---')).toBe('')
  })

  it('去除表格管道符', () => {
    expect(stripMarkdown('| 列1 | 列2 |')).toBe('列1   列2')
  })

  it('去除行内代码', () => {
    expect(stripMarkdown('用`npm install`安装')).toBe('用npm install安装')
  })

  it('去除引用标记', () => {
    expect(stripMarkdown('> 引用文字')).toBe('引用文字')
  })

  it('去除 HTML 标签', () => {
    expect(stripMarkdown('文本<br>换行')).toBe('文本换行')
  })

  it('处理真实 knowledge 内容', () => {
    const real = `帮您梳理清楚。\n\n---\n\n**厂界噪声监测点布设要求（参照 GB 12348-2008、HJ 706）**\n\n**一、布点基本原则**\n\n| 原则 | 说明 |\n|------|------|\n| **沿厂界均匀布点** | 覆盖整个厂界，不漏主`
    const result = stripMarkdown(real)
    expect(result).not.toContain('---')
    expect(result).not.toContain('**')
    expect(result).not.toContain('|')
    expect(result).toContain('厂界噪声监测点布设要求')
    expect(result).toContain('布点基本原则')
  })
})
