/**
 * AI 生成内容中的外链打开守卫。
 *
 * AI 可能幻觉编造钓鱼/内网 URL，用户一点即用系统浏览器打开。
 * 受管浏览器内打开（agentBrowserLink）走应用内隔离环境，不在此列；
 * 只有真正要调起**外部系统浏览器**时，才对非白名单域名弹一次确认。
 */

/** 无需确认、可直接用系统浏览器打开的可信域名（精确匹配 + 子域名）。 */
const TRUSTED_EXTERNAL_HOSTS = [
  'github.com',
  'raw.githubusercontent.com',
  'gist.github.com',
  'stackoverflow.com',
  'developer.mozilla.org',
  'docs.python.org',
  'www.typescriptlang.org',
  'react.dev',
  'nextjs.org',
  'vitejs.dev',
  'tailwindcss.com',
  'www.electronjs.org',
  'www.npmjs.com',
  'www.npmjs.com.cn',
  'juejin.cn',
  'www.zhihu.com',
  'www.bilibili.com',
  'www.youtube.com',
  'www.google.com',
  'www.bing.com',
  'www.baidu.com',
] as const

function getHostname(href: string): string | null {
  try {
    return new URL(href).hostname.toLowerCase()
  } catch {
    return null
  }
}

function isTrustedHost(hostname: string): boolean {
  return (TRUSTED_EXTERNAL_HOSTS as readonly string[]).some(
    (trusted) => hostname === trusted || hostname.endsWith(`.${trusted}`),
  )
}

/**
 * 外链是否需要打开前确认。返回 false = 可信域名或非法 URL（非法 URL 由 IPC 层再拦一道）。
 */
export function needsExternalLinkConfirm(href: string): boolean {
  if (!href.startsWith('http://') && !href.startsWith('https://')) return false
  const hostname = getHostname(href)
  if (!hostname) return false
  return !isTrustedHost(hostname)
}

/**
 * 带确认的外链打开：可信域名直接打开；其他域名用原生 confirm 让用户看清完整 URL 后再决定。
 * 返回 true 表示已发起打开，false 表示用户取消或 URL 非法。
 */
export function openExternalLinkWithConfirm(href: string): boolean {
  if (!href.startsWith('http://') && !href.startsWith('https://')) return false
  if (needsExternalLinkConfirm(href)) {
    const ok = window.confirm(`即将在系统浏览器中打开以下链接：\n\n${href}\n\n该链接来自 AI 生成的内容，请确认目标可信后再继续。`)
    if (!ok) return false
  }
  void window.electronAPI.openExternal(href)
  return true
}
