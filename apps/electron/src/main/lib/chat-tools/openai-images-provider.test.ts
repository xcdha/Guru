/**
 * openai-images-provider 单元测试
 * 覆盖 size 映射与参数边界（纯函数，无网络调用）
 */

import { describe, expect, test } from 'bun:test'
import { mapToOpenAISize, openAIImageEndpoint, extractGeminiImageParts, stripGeminiTrailingV1 } from './openai-images-provider'

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

describe('openAIImageEndpoint', () => {
  test('baseUrl 已带 /v1 不再重复拼', () => {
    expect(openAIImageEndpoint('https://api.openai.com/v1', 'generations')).toBe('https://api.openai.com/v1/images/generations')
    expect(openAIImageEndpoint('https://api.nbility.ai/v1', 'generations')).toBe('https://api.nbility.ai/v1/images/generations')
  })
  test('baseUrl 不带 /v1 则补上', () => {
    expect(openAIImageEndpoint('https://api.nbility.ai', 'generations')).toBe('https://api.nbility.ai/v1/images/generations')
    expect(openAIImageEndpoint('https://api.nbility.ai/', 'edits')).toBe('https://api.nbility.ai/v1/images/edits')
  })
})

describe('extractGeminiImageParts', () => {
  test('inlineData 直接提取', async () => {
    const img = await extractGeminiImageParts([{ inlineData: { mimeType: 'image/png', data: 'aGk=' } }])
    expect(img[0]).toEqual({ mimeType: 'image/png', data: 'aGk=' })
  })
  test('thought part 跳过，text part 不产出图片', async () => {
    const img = await extractGeminiImageParts([{ thought: true }, { text: 'hi' }])
    expect(img).toEqual([undefined, undefined])
  })
})

describe('stripGeminiTrailingV1', () => {
  test('带 /v1 时剥离', () => {
    expect(stripGeminiTrailingV1('https://api.nbility.ai/v1')).toBe('https://api.nbility.ai')
  })
  test('不带 /v1 时保留', () => {
    expect(stripGeminiTrailingV1('https://api.nbility.ai')).toBe('https://api.nbility.ai')
    expect(stripGeminiTrailingV1('https://generativelanguage.googleapis.com/')).toBe('https://generativelanguage.googleapis.com')
  })
})
