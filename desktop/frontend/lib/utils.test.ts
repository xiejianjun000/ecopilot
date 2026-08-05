import { describe, it, expect } from 'vitest'
import { cn } from './utils'

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
