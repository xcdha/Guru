import { describe, expect, test } from 'bun:test'
import { computeRevealAncestors, isPathUnderRoot } from './FileBrowser'

function sorted(set: Set<string>): string[] {
  return [...set].sort()
}

describe('computeRevealAncestors', () => {
  test('正斜杠 root + 正斜杠 target：逐级返回父目录', () => {
    const ancestors = computeRevealAncestors(
      'D:/Project/Guru',
      'D:/Project/Guru/apps/electron/src/renderer/a.ts',
    )
    expect(sorted(ancestors)).toEqual([
      'd:/project/guru/apps',
      'd:/project/guru/apps/electron',
      'd:/project/guru/apps/electron/src',
      'd:/project/guru/apps/electron/src/renderer',
    ])
  })

  test('反斜杠 root + 反斜杠 target', () => {
    const ancestors = computeRevealAncestors(
      'D:\\Project\\Guru',
      'D:\\Project\\Guru\\apps\\electron\\src\\a.ts',
    )
    expect(sorted(ancestors)).toEqual([
      'd:/project/guru/apps',
      'd:/project/guru/apps/electron',
      'd:/project/guru/apps/electron/src',
    ])
  })

  test('正斜杠 root + 反斜杠 target（混合分隔符不丢祖先）', () => {
    const ancestors = computeRevealAncestors(
      'D:/Project/Guru',
      'D:\\Project\\Guru\\apps\\electron\\src\\a.ts',
    )
    expect(sorted(ancestors)).toEqual([
      'd:/project/guru/apps',
      'd:/project/guru/apps/electron',
      'd:/project/guru/apps/electron/src',
    ])
  })

  test('反斜杠 root + 正斜杠 target', () => {
    const ancestors = computeRevealAncestors(
      'D:\\Project\\Guru',
      'D:/Project/Guru/apps/electron/src/a.ts',
    )
    expect(sorted(ancestors)).toEqual([
      'd:/project/guru/apps',
      'd:/project/guru/apps/electron',
      'd:/project/guru/apps/electron/src',
    ])
  })

  test('大小写差异不丢祖先', () => {
    const ancestors = computeRevealAncestors(
      'D:/PROJECT/Guru',
      'd:\\project\\guru\\apps\\electron\\src\\a.ts',
    )
    expect(sorted(ancestors)).toEqual([
      'd:/project/guru/apps',
      'd:/project/guru/apps/electron',
      'd:/project/guru/apps/electron/src',
    ])
  })

  test('target 等于 root 本身：无祖先', () => {
    expect(computeRevealAncestors('D:/Project/Guru', 'D:/Project/Guru').size).toBe(0)
    expect(computeRevealAncestors('D:/Project/Guru', 'd:/project/guru').size).toBe(0)
  })

  test('target 不在 root 下：无祖先', () => {
    expect(computeRevealAncestors('D:/Project/Guru', 'C:/Other/apps/a.ts').size).toBe(0)
    expect(computeRevealAncestors('D:/Project/Guru', 'D:/Project/GuruDev/apps/a.ts').size).toBe(0)
  })
})

describe('isPathUnderRoot', () => {
  test('同风格包含', () => {
    expect(isPathUnderRoot('D:/Project/Guru', 'D:/Project/Guru/apps/a.ts')).toBe(true)
    expect(isPathUnderRoot('D:\\Project\\Guru', 'D:\\Project\\Guru\\apps\\a.ts')).toBe(true)
  })
  test('混合分隔符与大小写包含', () => {
    expect(isPathUnderRoot('D:/Project/Guru', 'd:\\project\\guru\\apps\\a.ts')).toBe(true)
    expect(isPathUnderRoot('D:\\Project\\Guru', 'd:/project/guru/apps/a.ts')).toBe(true)
  })
  test('自身包含自身', () => {
    expect(isPathUnderRoot('D:/Project/Guru', 'D:/Project/Guru')).toBe(true)
    expect(isPathUnderRoot('D:/Project/Guru', 'd:/project/guru')).toBe(true)
  })
  test('前缀误判防护（GuruDev 不属于 Guru）', () => {
    expect(isPathUnderRoot('D:/Project/Guru', 'D:/Project/GuruDev/x.ts')).toBe(false)
  })
})
