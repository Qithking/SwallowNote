/**
 * findNextMatch 测试:从指定位置查找下一个匹配
 * Source: plan/editor-find-replace step 6
 */
import { describe, it, expect } from 'vitest'
import { findNextMatch, MatchRange } from '@/components/editors/blocknoteSearch'

describe('findNextMatch', () => {
  const matches: MatchRange[] = [
    { from: 0, to: 3 },
    { from: 8, to: 11 },
    { from: 16, to: 19 },
  ]

  it('should return first match when fromPos is before first match', () => {
    expect(findNextMatch(matches, 0)).toEqual({ from: 0, to: 3 })
  })

  it('should return next match after current position', () => {
    expect(findNextMatch(matches, 3)).toEqual({ from: 8, to: 11 })
  })

  it('should return first match (wrap around) when fromPos is after last match', () => {
    expect(findNextMatch(matches, 20)).toEqual({ from: 0, to: 3 })
  })

  it('should return null when matches array is empty', () => {
    expect(findNextMatch([], 0)).toBeNull()
  })

  it('should return match when fromPos is exactly at match start', () => {
    expect(findNextMatch(matches, 8)).toEqual({ from: 8, to: 11 })
  })

  it('should return next match when fromPos is in the middle of a match', () => {
    // fromPos=9 在第二个匹配 [8,11] 内部,应返回下一个 [16,19]
    expect(findNextMatch(matches, 9)).toEqual({ from: 16, to: 19 })
  })
})
