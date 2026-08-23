/**
 * openai-images-provider 单元测试
 * 覆盖 size 映射与参数边界（纯函数，无网络调用）
 */

import { describe, expect, test } from 'bun:test'
import { mapToOpenAISize } from './openai-images-provider'

describe('mapToOpenAISize', () => {
  test('默认/1K 档按方向映射', () => {
    expect(mapToOpenAISize('1:1', 'auto').size).toBe('1024x1024')
    expect(mapToOpenAISize('16:9', 'auto').size).toBe('1536x1024')
    expect(mapToOpenAISize('9:16', '1K').size).toBe('1024x1536')
    expect(mapToOpenAISize(undefined, undefined).size).toBe('1024x1024')
  })

  test('2K 档：方版/横版可用，竖版回落 1K 并给说明', () => {
    expect(mapToOpenAISize('1:1', '2K').size).toBe('2048x2048')
    expect(mapToOpenAISize('16:9', '2K').size).toBe('2048x1152')
    const portrait = mapToOpenAISize('9:16', '2K')
    expect(portrait.size).toBe('1024x1536')
    expect(portrait.note).toBeTruthy()
  })

  test('4K 档：横版/竖版可用，方版回落 2K 并给说明', () => {
    expect(mapToOpenAISize('16:9', '4K').size).toBe('3840x2160')
    expect(mapToOpenAISize('9:16', '4K').size).toBe('2160x3840')
    const square = mapToOpenAISize('1:1', '4K')
    expect(square.size).toBe('2048x2048')
    expect(square.note).toBeTruthy()
  })

  test('未知 imageSize 回退 auto 且有说明；近似比例给说明', () => {
    const unknown = mapToOpenAISize('1:1', '8K')
    expect(unknown.size).toBe('1024x1024')
    expect(unknown.note).toContain('回退')
    expect(mapToOpenAISize('4:3', 'auto').note).toBeTruthy()
  })
})
