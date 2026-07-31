/**
 * findPrevMatch 测试:从指定位置查找上一个匹配
 * Source: plan/editor-find-replace step 6
 */
import { describe, it, expect } from 'vitest'
import { findPrevMatch, MatchRange } from '@/components/editors/blocknoteSearch'

describe('findPrevMatch', () => {
  const matches: MatchRange[] = [
    { from: 0, to: 3 },
    { from: 8, to: 11 },
    { from: 16, to: 19 },
  ]

  it('should return last match when fromPos is after last match', () => {
    expect(findPrevMatch(matches, 20)).toEqual({ from: 16, to: 19 })
  })

  it('should return previous match before current position', () => {
    expect(findPrevMatch(matches, 16)).toEqual({ from: 8, to: 11 })
  })

  it('should return last match (wrap around) when fromPos is before first match', () => {
    expect(findPrevMatch(matches, 0)).toEqual({ from: 16, to: 19 })
  })

  it('should return null when matches array is empty', () => {
    expect(findPrevMatch([], 0)).toBeNull()
  })

  it('should return match whose end <= fromPos', () => {
    // fromPos=11,应返回 [8,11]
    expect(findPrevMatch(matches, 11)).toEqual({ from: 8, to: 11 })
  })

  it('should return previous match when fromPos is in the middle of a match', () => {
    // fromPos=9 在 [8,11] 内部,应返回 [0,3]
    expect(findPrevMatch(matches, 9)).toEqual({ from: 0, to: 3 })
  })
})
