import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getDefaultStore } from 'jotai'
import {
  typographySettingsAtom,
  applyTypographyToDOM,
  updateTypographySettings,
} from './typography-settings'
import { DEFAULT_TYPOGRAPHY_SETTINGS } from '../../types'

/** 模拟一个记录 setProperty/removeProperty 的 :root 内联样式。 */
function createFakeStyle(): {
  style: Record<string, unknown>
  setProperty: (name: string, value: string) => void
  removeProperty: (name: string) => void
  toVarMap: () => Record<string, string>
} {
  const vars: Record<string, string> = {}
  return {
    style: vars,
    setProperty(name: string, value: string) {
      vars[name] = value
    },
    removeProperty(name: string) {
      delete vars[name]
    },
    toVarMap() {
      return { ...vars }
    },
  }
}

let fakeStyle: ReturnType<typeof createFakeStyle>
const originalDocument = (globalThis as Record<string, unknown>).document
const originalWindow = (globalThis as Record<string, unknown>).window

beforeEach(() => {
  fakeStyle = createFakeStyle()
  // applyTypographyToDOM 读取的是全局 document.documentElement.style
  ;(globalThis as Record<string, unknown>).document = {
    documentElement: { style: fakeStyle },
  }
})

afterEach(() => {
  // 恢复全局，避免污染同进程内的其它测试文件
  if (originalDocument === undefined) delete (globalThis as Record<string, unknown>).document
  else (globalThis as Record<string, unknown>).document = originalDocument
  if (originalWindow === undefined) delete (globalThis as Record<string, unknown>).window
  else (globalThis as Record<string, unknown>).window = originalWindow
})

describe('TypographySettings 默认值（Markdown 结构元素颜色）', () => {
  test('默认包含全部 7 个结构元素颜色字段，且均为 undefined（跟随主题）', () => {
    expect(DEFAULT_TYPOGRAPHY_SETTINGS.headingColor).toBeUndefined()
    expect(DEFAULT_TYPOGRAPHY_SETTINGS.quoteColor).toBeUndefined()
    expect(DEFAULT_TYPOGRAPHY_SETTINGS.tableHeaderColor).toBeUndefined()
    expect(DEFAULT_TYPOGRAPHY_SETTINGS.listMarkerColor).toBeUndefined()
    expect(DEFAULT_TYPOGRAPHY_SETTINGS.linkColor).toBeUndefined()
    expect(DEFAULT_TYPOGRAPHY_SETTINGS.hrColor).toBeUndefined()
    expect(DEFAULT_TYPOGRAPHY_SETTINGS.inlineCodeColor).toBeUndefined()
  })
})

describe('applyTypographyToDOM 写入 / 移除结构元素颜色变量', () => {
  test('设置全部结构色时写入对应 --md-* 变量', () => {
    applyTypographyToDOM({
      ...DEFAULT_TYPOGRAPHY_SETTINGS,
      headingColor: '#9a3b2e',
      quoteColor: '#3d5a3d',
      tableHeaderColor: '#1f4e5f',
      listMarkerColor: '#b7a4d4',
      linkColor: '#408abf',
      hrColor: '#a89880',
      inlineCodeColor: '#f4f1ec',
    })

    const vars = fakeStyle.toVarMap()
    expect(vars['--md-heading-color']).toBe('#9a3b2e')
    expect(vars['--md-quote-color']).toBe('#3d5a3d')
    expect(vars['--md-table-head-color']).toBe('#1f4e5f')
    expect(vars['--md-list-marker-color']).toBe('#b7a4d4')
    expect(vars['--md-link-color']).toBe('#408abf')
    expect(vars['--md-hr-color']).toBe('#a89880')
    expect(vars['--md-inline-code-color']).toBe('#f4f1ec')
  })

  test('字段为空时移除对应变量（恢复到主题默认）', () => {
    applyTypographyToDOM({
      ...DEFAULT_TYPOGRAPHY_SETTINGS,
      headingColor: '#9a3b2e',
      inlineCodeColor: '#f4f1ec',
    })
    expect(fakeStyle.toVarMap()['--md-heading-color']).toBe('#9a3b2e')
    expect(fakeStyle.toVarMap()['--md-inline-code-color']).toBe('#f4f1ec')

    // 重置为 undefined 应移除变量
    applyTypographyToDOM({
      ...DEFAULT_TYPOGRAPHY_SETTINGS,
      headingColor: undefined,
      inlineCodeColor: undefined,
    })
    const vars = fakeStyle.toVarMap()
    expect(vars['--md-heading-color']).toBeUndefined()
    expect(vars['--md-inline-code-color']).toBeUndefined()
  })
})

describe('globals.css 消费规则（合并丢失回归防护）', () => {
  // skill 已知坑：三路合并 globals.css 极易静默丢失独有消费规则。
  // 这里直接读源文件，断言 7 个结构色变量 + 正文/行距的消费规则存在。
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../styles/globals.css'),
    'utf8',
  )

  test('标题/引用/表头消费 --md-heading-color / --md-quote-color / --md-table-head-color', () => {
    expect(css).toContain('var(--md-heading-color')
    expect(css).toContain('var(--md-quote-color')
    expect(css).toContain('var(--md-table-head-color')
  })

  test('列表标记/链接/分隔线/行内代码消费各自变量', () => {
    expect(css).toContain('var(--md-list-marker-color')
    expect(css).toContain('var(--md-link-color')
    expect(css).toContain('var(--md-hr-color')
    expect(css).toContain('var(--md-inline-code-color')
  })

  test('正文排版消费规则标记仍在（我们独有：正文排版）且标题规则覆盖 h1-h6', () => {
    expect(css).toContain(':is(h1, h2, h3, h4, h5, h6)')
    // 行距逐元素应用规则（Tailwind typography 覆盖防护）
    expect(css).toContain(':is(p, li, h1, h2, h3, h4, blockquote, pre, ul, ol)')
  })
})

describe('updateTypographySettings', () => {
  test('部分更新保留其他字段，并持久化到 electronAPI.updateSettings', async () => {
    const store = getDefaultStore()
    store.set(typographySettingsAtom, { ...DEFAULT_TYPOGRAPHY_SETTINGS })

    const calls: Array<{ typography: Record<string, unknown> }> = []
    ;(globalThis as Record<string, unknown>).window = {
      electronAPI: {
        updateSettings: async (payload: { typography: Record<string, unknown> }) => {
          calls.push(payload)
        },
      },
    }

    const result = await updateTypographySettings({ linkColor: '#408abf' })

    // 返回对象包含设置的值
    expect(result.linkColor).toBe('#408abf')
    // 持久化 payload 也包含
    expect(calls[0]?.typography.linkColor).toBe('#408abf')
    // 未传字段保留默认（undefined，不因为是 undefined 就报错）
    expect(result.tableHeaderColor).toBeUndefined()
  })
})
