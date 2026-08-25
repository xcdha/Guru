/**
 * AppearanceSettings - 外观设置页。
 *
 * "主题模式"只有浅色/深色/跟随系统三个标签；浅色、深色标签下面各自挂着「Guru 精选」
 * （旧版具名主题）+「更多预设」（迁移自 Craft 的预设）两组卡片，只显示当前标签对应的那个
 * 变体。Guru 精选旁提供 classic/modern 选择，Craft 更多预设固定使用现代工作台。
 * 均为完整预设、一键切换，不提供逐字段手动编辑。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Check, Pipette } from 'lucide-react'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsSegmentedControl,
} from './primitives'
import {
  themeModeAtom,
  themeStyleAtom,
  themePacksAtom,
  themeActiveVariantAtom,
  interfaceVariantAtom,
  systemIsDarkAtom,
  updateInterfaceVariant,
  updateThemeSelection,
  applyThemeToDOM,
  applyInterfaceVariantToDOM,
} from '@/atoms/theme'
import { markdownFontSizeAtom, updateMarkdownFontSize } from '@/atoms/markdown-font-size'
import { typographySettingsAtom, updateTypographySettings, TYPOGRAPHY_LIMITS } from '@/atoms/typography-settings'
import { areaStylesAtom, updateAreaStyle, resetAreaStyle } from '@/atoms/area-styles'
import { previewModePreferenceAtom, type PreviewModePreference } from '@/atoms/preview-atoms'
import { cn } from '@/lib/utils'
import type { InterfaceVariant, MarkdownFontSize, StyleAreaId, ThemeMode, ThemePack, ThemeStyle, ThemeVariant } from '../../../types'
import { AREA_FONT_SIZE_LIMITS, AREA_LABELS } from '../../../types'
import { CRAFT_THEME_PRESETS, getCraftThemePack, type CraftThemePreset } from '@/theme/theme.logic'

import themeCloudDancer from '@/assets/theme-previews/theme-cloud-dancer.webp'
import themeOceanLight from '@/assets/theme-previews/theme-ocean-light.webp'
import themeForestMorning from '@/assets/theme-previews/theme-forest-morning.webp'
import themeOceanDark from '@/assets/theme-previews/theme-ocean-dark.webp'
import themeForestNight from '@/assets/theme-previews/theme-forest-night.webp'
import themeMorandiNight from '@/assets/theme-previews/theme-morandi-night.webp'
import themeTerminalDark from '@/assets/theme-previews/theme-terminal-dark.png'

const THEME_MODE_OPTIONS = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

const INTERFACE_VARIANT_OPTIONS: { value: InterfaceVariant; label: string }[] = [
  { value: 'classic', label: '经典' },
  { value: 'modern', label: '现代' },
]

const MARKDOWN_FONT_SIZE_OPTIONS = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '中' },
  { value: 'large', label: '大' },
]

/** 预设文字颜色（浅色/深色主题都可用） */
const TEXT_COLOR_PRESETS = [
  { name: '跟随主题', value: '' },
  { name: '暖黑', value: '#2a2622' },
  { name: '石青', value: '#1f4e5f' },
  { name: '赭红', value: '#9a3b2e' },
  { name: '苔绿', value: '#3d5a3d' },
  { name: '暖白', value: '#f4f1ec' },
  { name: '雾灰', value: '#a89880' },
  { name: '淡紫', value: '#b7a4d4' },
]

const PREVIEW_MODE_OPTIONS: { value: PreviewModePreference; label: string }[] = [
  { value: 'tab', label: '标签页' },
  { value: 'split', label: '侧边分屏' },
]

const SPECIAL_STYLES: readonly SpecialStyle[] = [
  { id: 'slate-light', name: '云朵舞者', variant: 'light', image: themeCloudDancer, imageScale: 1.3 },
  { id: 'ocean-light', name: '晴空碧海', variant: 'light', image: themeOceanLight },
  { id: 'forest-light', name: '森息晨光', variant: 'light', image: themeForestMorning, imageScale: 1.45 },
  { id: 'ocean-dark', name: '远山暮霭', variant: 'dark', image: themeOceanDark },
  { id: 'forest-dark', name: '森息夜语', variant: 'dark', image: themeForestNight },
  { id: 'slate-dark', name: '莫兰迪夜', variant: 'dark', image: themeMorandiNight, imageScale: 1.15, objectPosition: '44% 58%' },
  { id: 'terminal-dark', name: '旧屏微光', variant: 'dark', image: themeTerminalDark, tooltip: '该主题包含轻微终端闪烁动画' },
]

interface SpecialStyle {
  id: Exclude<ThemeStyle, 'default' | 'custom'>
  name: string
  variant: ThemeVariant
  image: string
  objectPosition?: string
  imageScale?: number
  tooltip?: string
}

const isMac = navigator.userAgent.includes('Mac')
const ZOOM_HINT = isMac ? '使用 ⌘+ 放大、⌘- 缩小、⌘0 恢复默认大小' : '使用 Ctrl++ 放大、Ctrl+- 缩小、Ctrl+0 恢复默认大小'

export function AppearanceSettings(): React.ReactElement {
  const [themeMode, setThemeMode] = useAtom(themeModeAtom)
  const [themeStyle, setThemeStyle] = useAtom(themeStyleAtom)
  const [themePacks, setThemePacks] = useAtom(themePacksAtom)
  const [interfaceVariant, setInterfaceVariant] = useAtom(interfaceVariantAtom)
  const systemIsDark = useAtomValue(systemIsDarkAtom)
  const [markdownFontSize, setMarkdownFontSize] = useAtom(markdownFontSizeAtom)
  const [previewModePref, setPreviewModePref] = useAtom(previewModePreferenceAtom)
  const [typography, setTypography] = useAtom(typographySettingsAtom)
  const [areaStyles, setAreaStyles] = useAtom(areaStylesAtom)
  const isCustomActive = themeMode === 'special' && themeStyle === 'custom'
  // "主题模式"标签不再单列"主题风格"选项：选中某个预设时 themeMode 内部仍是 'special'
  // （legacy 主题的 CSS class 应用逻辑依赖这个值），标签显示哪个变体则由 themeActiveVariantAtom
  // 直接控制——这个 atom 同时也是 applyThemeToDOM 实际渲染哪个 ThemePack 的依据（见
  // atoms/theme.ts），不能用 systemIsDark 代替：否则单变体专属预设（如 Haze 只支持 dark）
  // 在系统是浅色模式时会读到从未写入过的浅色 pack——UI 上选中态打勾，但视觉毫无变化。
  const [activeVariant, setActiveVariant] = useAtom(themeActiveVariantAtom)
  const displayMode: ThemeMode = themeMode === 'system' ? 'system' : activeVariant

  const handleThemeModeChange = React.useCallback((value: string) => {
    const mode = value as ThemeMode
    if (mode === 'light' || mode === 'dark') {
      setActiveVariant(mode)
    }
    // 点浅色/深色/跟随系统始终强制拉回纯默认外观（themeStyle='default'），和下面预设网格
    // 里的选择彻底解耦——标签只表示"想看哪个变体"，不表示"要不要用预设"。
    setThemeMode(mode)
    setThemeStyle('default')
    void updateThemeSelection({
      themeMode: mode,
      themeStyle: 'default',
      themeActiveVariant: mode === 'light' || mode === 'dark' ? mode : activeVariant,
      themePacks,
    })
    applyThemeToDOM(mode, 'default', themePacks, systemIsDark, activeVariant)
  }, [activeVariant, setActiveVariant, setThemeMode, setThemeStyle, themePacks, systemIsDark])

  const handleStyleSelect = React.useCallback((style: ThemeStyle, variant: ThemeVariant) => {
    setActiveVariant(variant)
    setThemeMode('special')
    setThemeStyle(style)
    void updateThemeSelection({
      themeMode: 'special',
      themeStyle: style,
      themeActiveVariant: variant,
      themePacks,
    })
    applyThemeToDOM('special', style, themePacks, systemIsDark, variant)
  }, [setActiveVariant, setThemeMode, setThemeStyle, themePacks, systemIsDark])

  const handlePresetSelect = React.useCallback((presetId: string) => {
    const preset = CRAFT_THEME_PRESETS.find((item) => item.id === presetId)
    if (!preset) return
    const nextPacks: Record<ThemeVariant, ThemePack> = { ...themePacks }
    for (const variant of preset.supportedModes) {
      const pack = getCraftThemePack(presetId, variant)
      if (pack) nextPacks[variant] = pack
    }
    // 预设网格已经按 displayMode 过滤，能点到的卡片必然属于当前正在浏览的变体；
    // 单变体预设（如 Haze）借此直接锁定 activeVariant，不用等 resolveColors 猜。
    const nextVariant = preset.supportedModes.includes(activeVariant) ? activeVariant : (preset.supportedModes[0] ?? activeVariant)
    setActiveVariant(nextVariant)
    setThemePacks(nextPacks)
    setThemeMode('special')
    setThemeStyle('custom')
    const nextInterfaceVariant: InterfaceVariant = preset.interfacePolicy === 'modern' ? 'modern' : interfaceVariant
    setInterfaceVariant(nextInterfaceVariant)
    void updateThemeSelection({
      themeMode: 'special',
      themeStyle: 'custom',
      themeActiveVariant: nextVariant,
      themePacks: nextPacks,
      interfaceVariant: nextInterfaceVariant,
    })
    applyThemeToDOM('special', 'custom', nextPacks, systemIsDark, nextVariant)
    applyInterfaceVariantToDOM(nextInterfaceVariant)
  }, [activeVariant, interfaceVariant, setActiveVariant, setInterfaceVariant, setThemeMode, setThemePacks, setThemeStyle, systemIsDark, themePacks])

  const isPresetSelected = React.useCallback((presetId: string) => {
    if (!isCustomActive || displayMode === 'system') return false
    const presetPack = getCraftThemePack(presetId, displayMode)
    if (!presetPack) return false
    const activeTheme = themePacks[displayMode].theme
    return activeTheme.accent === presetPack.theme.accent && activeTheme.canvas.background === presetPack.theme.canvas.background
  }, [displayMode, isCustomActive, themePacks])

  const legacyStylesForDisplay = displayMode === 'system' ? [] : SPECIAL_STYLES.filter((style) => style.variant === displayMode)
  const handleInterfaceVariantChange = React.useCallback((value: string) => {
    const next = value as InterfaceVariant
    setInterfaceVariant(next)
    void updateInterfaceVariant(next)
    applyInterfaceVariantToDOM(next)
  }, [setInterfaceVariant])
  const presetsForDisplay = displayMode === 'system' ? [] : CRAFT_THEME_PRESETS.filter((preset) => preset.supportedModes.includes(displayMode))
  const isCraftPresetActive = isCustomActive && presetsForDisplay.some((preset) => isPresetSelected(preset.id))

  return (
    <div className="space-y-6">
      <SettingsSection title="外观设置" description="个性化界面外观、主题风格与显示设置。">
        <SettingsCard>
          <SettingsSegmentedControl label="主题模式" description="选择浅色、深色，或跟随系统；每个变体下面都可以直接挑一套主题风格" value={displayMode} onValueChange={handleThemeModeChange} options={THEME_MODE_OPTIONS} />

          {displayMode !== 'system' ? (
            <div className="border-t border-border px-4 py-3 space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">Guru 精选</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground/70">经典布局与现代工作台均可使用</div>
                  </div>
                  <div className="shrink-0">
                    <div className="mb-1 text-right text-[10px] font-medium text-muted-foreground">界面风格</div>
                    <InlineSegmentedControl
                      value={interfaceVariant}
                      onValueChange={handleInterfaceVariantChange}
                      options={INTERFACE_VARIANT_OPTIONS}
                      disabled={isCraftPresetActive}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-3 sm:grid-cols-7">
                  {legacyStylesForDisplay.map((style) => (
                    <StyleCard key={style.id} style={style} isSelected={themeMode === 'special' && themeStyle === style.id} onSelect={() => handleStyleSelect(style.id, style.variant)} />
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">更多预设</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground/70">Craft 风格预设统一使用现代工作台</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">现代工作台</span>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {presetsForDisplay.map((preset) => (
                    <PresetCard key={preset.id} preset={preset} pack={getCraftThemePack(preset.id, displayMode)} isSelected={isPresetSelected(preset.id)} onSelect={() => handlePresetSelect(preset.id)} />
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <SettingsRow label="界面缩放" description={ZOOM_HINT} />
          <SettingsSegmentedControl label="Markdown 字号" description="调整 AI 回复与 Markdown 编辑器的正文字号档位" value={markdownFontSize} onValueChange={(value) => { const next = value as MarkdownFontSize; setMarkdownFontSize(next); void updateMarkdownFontSize(next) }} options={MARKDOWN_FONT_SIZE_OPTIONS} />

          <div className="border-t border-border px-4 py-4 space-y-4">
            <div>
              <div className="text-xs font-medium text-foreground">正文排版</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">精细调节 AI 回复与 Markdown 编辑器的字号、行距、字距、段距与文字颜色（即时生效）</div>
            </div>

            <TypographySlider
              label="字号"
              unit="px"
              min={TYPOGRAPHY_LIMITS.fontSize.min}
              max={TYPOGRAPHY_LIMITS.fontSize.max}
              step={1}
              value={typography.fontSize ?? 15}
              onChange={async (v) => {
                // 区域「对话正文」的显式字号会以内联变量遮蔽排版字号（同一消费点），
                // 调排版字号前先解除区域覆盖，否则滑杆看起来完全不生效
                if (areaStyles.body?.fontSize != null) {
                  setAreaStyles(await updateAreaStyle('body', { fontSize: undefined }))
                }
                setTypography(await updateTypographySettings({ fontSize: v }))
              }}
            />
            <TypographySlider
              label="行距"
              unit="×"
              min={TYPOGRAPHY_LIMITS.lineHeight.min}
              max={TYPOGRAPHY_LIMITS.lineHeight.max}
              step={0.05}
              value={typography.lineHeight ?? 1.65}
              onChange={async (v) => setTypography(await updateTypographySettings({ lineHeight: v }))}
            />
            <TypographySlider
              label="字距"
              unit="px"
              min={TYPOGRAPHY_LIMITS.letterSpacing.min}
              max={TYPOGRAPHY_LIMITS.letterSpacing.max}
              step={0.1}
              value={typography.letterSpacing ?? 0}
              onChange={async (v) => setTypography(await updateTypographySettings({ letterSpacing: v }))}
            />
            <TypographySlider
              label="段距"
              unit="px"
              min={TYPOGRAPHY_LIMITS.paragraphSpacing.min}
              max={TYPOGRAPHY_LIMITS.paragraphSpacing.max}
              step={1}
              value={typography.paragraphSpacing ?? 6}
              onChange={async (v) => setTypography(await updateTypographySettings({ paragraphSpacing: v }))}
            />

            <div>
              <div className="mb-2 text-[11px] font-medium text-muted-foreground">正文颜色</div>
              <div className="flex flex-wrap items-center gap-2">
                {TEXT_COLOR_PRESETS.map((preset) => {
                  const isActive = (typography.textColor ?? '') === preset.value
                  return (
                    <button
                      key={preset.name}
                      type="button"
                      title={preset.name}
                      onClick={async () => {
                        // 同字号：区域「对话正文」显式颜色会遮蔽排版颜色，先解除
                        if (areaStyles.body?.color) {
                          setAreaStyles(await updateAreaStyle('body', { color: undefined }))
                        }
                        setTypography(await updateTypographySettings({ textColor: preset.value || undefined }))
                      }}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                        isActive ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                      )}
                    >
                      <span className="size-3.5 rounded-full border border-border/60" style={{ background: preset.value || 'conic-gradient(#666, #999, #666)' }} />
                      {preset.name}
                    </button>
                  )
                })}
                {/* 自定义正文颜色（div[role=button] 包裹：HTML 禁止 button 嵌套交互控件，
                    input 铺满容器承担点击，视觉层 pointer-events-none） */}
                <div
                  role="button"
                  tabIndex={0}
                  title="自定义正文颜色"
                  className={cn(
                    'relative flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                    typography.textColor && !TEXT_COLOR_PRESETS.some((p) => p.value && p.value.toLowerCase() === typography.textColor?.toLowerCase())
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                  )}
                >
                  <span className="pointer-events-none flex items-center gap-1.5">
                    <span className="size-3.5 rounded-full border border-border/60" style={{ background: typography.textColor || 'conic-gradient(#666, #999, #666)' }} />
                    <span className="flex items-center gap-1">
                      <Pipette className="size-3" />
                      自定义
                    </span>
                  </span>
                  {/* 透明 input 铺满容器：系统取色器锚定在 input 处（sr-only 裁剪会导致
                      弹窗回退到窗口底部）；input 是容器的直接子元素而非嵌在 button 内 */}
                  <input
                    type="color"
                    value={typography.textColor || '#888888'}
                    onChange={(e) => {
                      const c = e.target.value
                      if (areaStyles.body?.color) void updateAreaStyle('body', { color: undefined }).then(setAreaStyles)
                      void updateTypographySettings({ textColor: c }).then(setTypography)
                    }}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </div>
              </div>
            </div>

            {/* Markdown 结构元素颜色（标题/引用/表头/列表/链接/分隔线/行内码/强调）：单独覆盖，不影响正文色 */}
            <div>
              <div className="mb-2 text-[11px] font-medium text-muted-foreground">Markdown 结构元素颜色</div>
              <div className="space-y-2">
                <MarkdownStructureColorRow
                  label="标题"
                  value={typography.headingColor}
                  onChange={async (v) => setTypography(await updateTypographySettings({ headingColor: v }))}
                />
                <MarkdownStructureColorRow
                  label="引用"
                  value={typography.quoteColor}
                  onChange={async (v) => setTypography(await updateTypographySettings({ quoteColor: v }))}
                />
                <MarkdownStructureColorRow
                  label="表头"
                  value={typography.tableHeaderColor}
                  onChange={async (v) => setTypography(await updateTypographySettings({ tableHeaderColor: v }))}
                />
                <MarkdownStructureColorRow
                  label="列表"
                  value={typography.listMarkerColor}
                  onChange={async (v) => setTypography(await updateTypographySettings({ listMarkerColor: v }))}
                />
                <MarkdownStructureColorRow
                  label="链接"
                  value={typography.linkColor}
                  onChange={async (v) => setTypography(await updateTypographySettings({ linkColor: v }))}
                />
                <MarkdownStructureColorRow
                  label="分隔线"
                  value={typography.hrColor}
                  onChange={async (v) => setTypography(await updateTypographySettings({ hrColor: v }))}
                />
                <MarkdownStructureColorRow
                  label="行内码"
                  value={typography.inlineCodeColor}
                  onChange={async (v) => setTypography(await updateTypographySettings({ inlineCodeColor: v }))}
                />
                <MarkdownStructureColorRow
                  label="强调"
                  value={typography.emphasisColor}
                  onChange={async (v) => setTypography(await updateTypographySettings({ emphasisColor: v }))}
                />
              </div>
            </div>
          </div>

          {/* 按区域自定义字体与颜色 */}
          <div className="border-t border-border px-4 py-4 space-y-4">
            <div>
              <div className="text-xs font-medium text-foreground">区域字体与颜色</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">按区域自定义界面文字、对话正文、输入框与代码块的字体大小和颜色（即时生效）</div>
            </div>
            {(Object.keys(AREA_LABELS) as StyleAreaId[]).map((area) => (
              <AreaStyleEditor
                key={area}
                area={area}
                label={AREA_LABELS[area]}
                value={areaStyles[area] ?? {}}
                onChange={async (partial) => {
                  // 反向互斥：区域「对话正文」显式设置字号/颜色时，清除排版侧的同名
                  // 覆盖，保证同一属性只有一个来源，滑杆始终即时可见生效
                  if (area === 'body') {
                    if (partial.fontSize != null && typography.fontSize != null) {
                      setTypography(await updateTypographySettings({ fontSize: undefined }))
                    }
                    if (partial.color && typography.textColor) {
                      setTypography(await updateTypographySettings({ textColor: undefined }))
                    }
                  }
                  setAreaStyles(await updateAreaStyle(area, partial))
                }}
                onReset={async () => setAreaStyles(await resetAreaStyle(area))}
              />
            ))}
          </div>

          {/* 实时预览 */}
          <div className="border-t border-border px-4 py-4 space-y-3">
            <div>
              <div className="text-xs font-medium text-foreground">实时预览</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">以下内容随上方字体/颜色/排版设置即时变化，与实际渲染一致</div>
            </div>
            <StylePreview />
          </div>

          <SettingsSegmentedControl label="Agent 预览展开方式" description="点击文件、工具结果「预览」按钮时的默认展开位置" value={previewModePref} onValueChange={(value) => setPreviewModePref(value as PreviewModePreference)} options={PREVIEW_MODE_OPTIONS} />
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}

function StyleCard({ style, isSelected, onSelect }: { style: SpecialStyle; isSelected: boolean; onSelect: () => void }): React.ReactElement {
  return (
    <button type="button" onClick={onSelect} title={style.tooltip} className="group flex flex-col items-center gap-2 focus-visible:outline-none">
      <div className={cn('relative h-[183px] w-[99px] overflow-hidden rounded-lg transition-[border-color,box-shadow,opacity] duration-fast', isSelected ? 'ring-2 ring-primary shadow-lg shadow-primary/20' : 'ring-1 ring-border/50 group-hover:ring-border group-focus-visible:ring-2 group-focus-visible:ring-primary')}>
        <div className="h-full w-full" style={style.imageScale ? { transform: `scale(${style.imageScale})` } : undefined}>
          <img src={style.image} alt={style.name} loading="lazy" decoding="async" className="h-full w-full object-cover" style={style.objectPosition ? { objectPosition: style.objectPosition } : undefined} draggable={false} />
        </div>
        {isSelected ? <div className="absolute right-1 top-1 z-10 flex size-4 items-center justify-center rounded-full bg-primary"><Check className="size-2.5 text-primary-foreground" /></div> : null}
      </div>
      <span className={cn('text-xs font-medium transition-colors', isSelected ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground')}>{style.name}</span>
    </button>
  )
}

function InlineSegmentedControl({
  value,
  onValueChange,
  options,
  disabled = false,
}: {
  value: string
  onValueChange: (value: string) => void
  options: readonly { value: string; label: string }[]
  disabled?: boolean
}): React.ReactElement {
  return (
    <div className="inline-flex rounded-lg bg-muted p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          onClick={() => onValueChange(option.value)}
          className={cn(
            'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            value === option.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function PresetCard({ preset, pack, isSelected, onSelect }: { preset: CraftThemePreset; pack: ThemePack | null; isSelected: boolean; onSelect: () => void }): React.ReactElement {
  return (
    <button type="button" title={preset.description} onClick={onSelect} className={cn('flex items-center gap-2 rounded-md border px-2 py-2 text-left transition-colors', isSelected ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50')}>
      <span
        className="size-6 shrink-0 rounded-full border border-border/60"
        style={pack ? { background: `linear-gradient(135deg, ${pack.theme.canvas.background} 50%, ${pack.theme.accent} 50%)` } : undefined}
      />
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-xs font-medium', isSelected ? 'text-foreground' : 'text-muted-foreground')}>{preset.name}</span>
        <span className="block truncate text-[10px] text-muted-foreground/70">{preset.mode === 'scenic' ? 'Scenic' : 'Solid'}</span>
      </span>
      {isSelected ? <Check className="size-3 shrink-0 text-primary" /> : null}
    </button>
  )
}

/**
 * 排版滑块：标签 + 当前值 + range 输入。
 * 值即时写入 CSS 变量（原子 + updateTypographySettings 持久化）。
 */
function TypographySlider({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
}): React.ReactElement {
  return (
    <div className="flex items-center gap-3">
      <span className="w-8 shrink-0 text-[11px] font-medium text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
      />
      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-foreground">
        {Number.isInteger(value) ? value : value.toFixed(2)}
        {unit}
      </span>
    </div>
  )
}

/** 自定义取色按钮：点击弹出系统原生取色器（复用 Pipette 图标风格）。 */
function CustomColorButton({
  value,
  onChange,
  title,
  className,
}: {
  value?: string
  onChange: (color: string | undefined) => void
  title: string
  className?: string
}): React.ReactElement {
  const isCustom = Boolean(value) && !TEXT_COLOR_PRESETS.some((p) => p.value && p.value.toLowerCase() === (value ?? '').toLowerCase())
  return (
    <div
      role="button"
      tabIndex={0}
      title={`${title} · 自定义颜色`}
      aria-label={`${title}自定义颜色`}
      className={cn(
        'relative flex cursor-pointer items-center justify-center rounded-full border border-dashed border-border/70 text-muted-foreground transition-transform hover:scale-110 hover:text-foreground',
        isCustom && 'ring-2 ring-primary/40 border-solid',
        className,
      )}
      style={isCustom ? { background: value } : undefined}
    >
      <span className="pointer-events-none flex">
        {isCustom ? <Check className="size-3 text-white drop-shadow" /> : <Pipette className="size-3" />}
      </span>
      {/* 透明 input 铺满容器：取色器弹窗必然锚定在此处；不嵌套进 button */}
      <input
        type="color"
        value={value && isCustom ? value : '#888888'}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  )
}

/** Markdown 结构元素（标题/引用/表头/列表/链接/分隔线/行内码/强调）的颜色选择行：色块按钮 + 重置。 */
function MarkdownStructureColorRow({
  label,
  value,
  onChange,
}: {
  label: string
  value?: string
  onChange: (color: string | undefined) => void
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="w-10 shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        {TEXT_COLOR_PRESETS.map((preset) => {
          const isActive = (value ?? '') === preset.value
          return (
            <button
              key={preset.name}
              type="button"
              title={`${label} · ${preset.name}`}
              aria-label={`${label}颜色：${preset.name}`}
              onClick={() => onChange(preset.value || undefined)}
              className={cn(
                'size-5 rounded-full border transition-transform hover:scale-110',
                isActive ? 'border-primary ring-2 ring-primary/30' : 'border-border/70',
              )}
              style={{ background: preset.value || 'conic-gradient(#999, #666, #999)' }}
            />
          )
        })}
        <CustomColorButton
          value={value}
          onChange={onChange}
          title={label}
          className="size-5"
        />
      </div>
      {value && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          重置
        </button>
      )}
    </div>
  )
}

/**
 * 单个区域的字体/颜色编辑器：字号滑块 + 颜色预设 + 重置。
 */
function AreaStyleEditor({
  area,
  label,
  value,
  onChange,
  onReset,
}: {
  area: StyleAreaId
  label: string
  value: { fontSize?: number; color?: string }
  onChange: (partial: { fontSize?: number; color?: string }) => void
  onReset: () => void
}): React.ReactElement {
  const fontSize = value.fontSize
  const color = value.color
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-foreground">{label}</span>
        {(fontSize != null || color) && (
          <button
            type="button"
            onClick={onReset}
            className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            重置
          </button>
        )}
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-7 shrink-0 text-[10px] text-muted-foreground">字号</span>
          <input
            type="range"
            min={AREA_FONT_SIZE_LIMITS.min}
            max={AREA_FONT_SIZE_LIMITS.max}
            step={1}
            value={fontSize ?? 14}
            aria-label={`${label}字号`}
            onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
          />
          <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-foreground">
            {fontSize != null ? `${fontSize}px` : '默认'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {TEXT_COLOR_PRESETS.map((preset) => {
            const isActive = (color ?? '') === preset.value
            return (
              <button
                key={preset.name}
                type="button"
                title={`${label} · ${preset.name}`}
                aria-label={`${label}颜色：${preset.name}`}
                onClick={() => onChange({ color: preset.value || undefined })}
                className={cn(
                  'size-5 rounded-full border transition-transform hover:scale-110',
                  isActive ? 'border-primary ring-2 ring-primary/30' : 'border-border/70',
                )}
                style={{ background: preset.value || 'conic-gradient(#999, #666, #999)' }}
              />
            )
          })}
          <CustomColorButton
            value={color}
            onChange={(c) => onChange({ color: c })}
            title={label}
            className="size-5"
          />
        </div>
      </div>
    </div>
  )
}

/**
 * 实时预览面板：模拟 Guru 主界面布局（侧边栏 + 对话正文 + 输入框 + 代码块），
 * 全部通过 var() 读取当前设置的 CSS 变量，随上方设置即时更新。
 */
function StylePreview(): React.ReactElement {
  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-content-area shadow-sm">
      {/* 模拟窗口标题栏 */}
      <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-2">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 text-[10px] text-muted-foreground">Guru · 预览</span>
      </div>

      <div className="flex min-h-[260px] items-stretch">
        {/* 模拟侧边栏（ui 区域） */}
        <div className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-border/60 bg-[hsl(var(--sidebar-surface))] py-3 text-[length:var(--area-ui-font-size)] text-[color:var(--area-ui-color)]">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-[11px] font-semibold">Y</span>
          <span className="flex size-8 items-center justify-center rounded-lg bg-foreground/5 text-[11px]">⌘</span>
          <span className="flex size-8 items-center justify-center rounded-lg bg-foreground/5 text-[11px]">⚙</span>
        </div>

        {/* 模拟内容区 */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 内容超高时随内容自然伸展（不再固定高度+滚动），字体变大时预览撑高而非出滚动条 */}
          <div className="space-y-2 px-3 py-3">
            {/* 模拟 AI 回复（body 区域） */}
            <div className="max-w-[85%] rounded-xl rounded-tl-sm bg-muted/60 px-3 py-2 text-[length:var(--area-body-font-size)] leading-[var(--md-body-line-height)] tracking-[var(--md-body-letter-spacing)] text-[color:var(--md-body-color)]">
              <h4
                className="text-[11px] font-semibold"
                style={{ color: 'var(--md-heading-color, hsl(var(--foreground) / 0.94))' }}
              >
                AI 回复
              </h4>
              <p className="my-[var(--md-body-paragraph-spacing)]">
                这是对话正文的实时预览，支持{' '}
                <a href="#" onClick={(e) => e.preventDefault()} style={{ color: 'var(--md-link-color, hsl(var(--accent)))' }}>
                  链接
                </a>
                、{' '}
                <code style={{ color: 'var(--md-inline-code-color, inherit)' }}>行内代码</code>
                、<strong style={{ color: 'var(--md-emphasis-color, inherit)' }}>强调文字</strong>{' '}
                的颜色随左侧设置即时变化。
              </p>
              <blockquote
                className="my-[var(--md-body-paragraph-spacing)]"
                style={{
                  color: 'var(--md-quote-color, hsl(var(--foreground) / 0.66))',
                  borderLeft: '2px solid hsl(var(--primary) / 0.42)',
                  padding: '0.15em 0 0.15em 1em',
                }}
              >
                调整「引用」色块可看到引用块颜色实时改变。
              </blockquote>
            </div>
            {/* 模拟代码块（code 区域） */}
            <div className="overflow-hidden rounded-lg border border-border/60">
              <div className="flex items-center justify-between bg-muted/60 px-2 py-1 text-[9px] text-muted-foreground">
                <span>typescript</span>
                <span>复制</span>
              </div>
              <pre
                className="m-0 min-h-[32px] overflow-hidden break-words whitespace-pre-wrap bg-[hsl(var(--code-bg))] px-3 py-2 text-[length:var(--area-code-font-size)] leading-[1.6]"
                style={{ color: 'var(--area-code-color, #e1e4e8)' }}
              >
                <code>{`const greet = (name: string) => \`你好, \${name}\``}</code>
              </pre>
            </div>
          </div>

          {/* 模拟输入框（input 区域） */}
          <div className="mt-auto border-t border-border/60 px-3 py-2.5 text-[length:var(--area-input-font-size)] text-[color:var(--area-input-color)]">
            <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
              <span className="text-[11px] text-muted-foreground">输入消息…</span>
              <span className="ml-2 text-[10px] text-muted-foreground/60">Ctrl+Enter 发送</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
