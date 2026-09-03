import { Menu, shell, BrowserWindow } from 'electron'

export function createApplicationMenu(): Menu {
  const isMac = process.platform === 'darwin'

  /**
   * 菜单快捷键说明：
   *
   * 大部分快捷键由渲染进程的 shortcut-registry 统一管理。
   * 但 Cmd+W 需要在菜单中拦截（否则 macOS 默认关闭窗口），
   * 改为通知渲染进程关闭当前标签页。
   */

  /**
   * 重新加载当前窗口。
   *
   * 不使用 Electron 的 `reload` / `forceReload` role：这些 role 会自动注册
   * CmdOrCtrl+R、F5 等系统快捷键。刷新只能从原生“视图”菜单显式触发。
   */
  const reloadFocusedWindow = (ignoreCache = false): void => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win || win.isDestroyed()) return

    if (ignoreCache) {
      win.webContents.reloadIgnoringCache()
    } else {
      win.webContents.reload()
    }
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    // 应用菜单 (仅 macOS)
    ...(isMac
      ? [
          {
            label: 'Guru',
            submenu: [
              { role: 'about' as const, label: '关于 Guru' },
              { type: 'separator' as const },
              { role: 'services' as const, label: '服务' },
              { type: 'separator' as const },
              { role: 'hide' as const, label: '隐藏 Guru' },
              { role: 'hideOthers' as const, label: '隐藏其他' },
              { role: 'unhide' as const, label: '显示全部' },
              { type: 'separator' as const },
              { role: 'quit' as const, label: '退出 Guru' },
            ],
          },
        ]
      : []),

    // 文件菜单
    {
      label: '文件',
      submenu: [
        // Cmd+W / Ctrl+W：主窗口关闭当前标签页；独立规划窗口关闭自身。
        {
          label: '关闭标签页',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const win = BrowserWindow.getFocusedWindow()
            if (!win) return

            let windowType: string | null = null
            try {
              windowType = new URL(win.webContents.getURL()).searchParams.get('window')
            } catch {
              // 窗口尚未加载页面时沿用主窗口的安全默认行为。
            }
            if (windowType === 'planning' || windowType === 'workspace-memory') {
              win.close()
              return
            }

            win.webContents.send('menu:close-tab')
          },
        },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const, label: '退出' }]),
      ],
    },

    // 编辑菜单
    {
      label: '编辑',
      submenu: [
        { role: 'undo' as const, label: '撤销' },
        { role: 'redo' as const, label: '重做' },
        { type: 'separator' as const },
        // Windows/Linux：禁用这些 role 的菜单 accelerator（registerAccelerator: false），
        // 让 Ctrl+C/V/X/A 落到页面——否则 Electron 菜单会抢先消费快捷键：
        // 1) 终端(xterm)有选区时 Ctrl+C 被菜单 copy 吃掉 → 无法复制；
        // 2) Ctrl+V 粘贴被菜单 paste 吃掉 → 无法粘贴命令；
        // 3) Ctrl+A 被 selectAll 吃掉 → 终端里无法跳到行首。
        // 普通输入框/文本域的复制粘贴由 Chromium 原生编辑命令处理，不受影响。
        // macOS 保持默认（Cmd+C/V 语义与终端 Ctrl+C 中断不冲突）。
        ...(isMac
          ? [
              { role: 'cut' as const, label: '剪切' },
              { role: 'copy' as const, label: '复制' },
              { role: 'paste' as const, label: '粘贴' },
              { role: 'pasteAndMatchStyle' as const, label: '粘贴并匹配样式' },
              { role: 'delete' as const, label: '删除' },
              { role: 'selectAll' as const, label: '全选' },
            ]
          : [
              { role: 'cut' as const, label: '剪切', registerAccelerator: false },
              { role: 'copy' as const, label: '复制', registerAccelerator: false },
              { role: 'paste' as const, label: '粘贴', registerAccelerator: false },
              { role: 'delete' as const, label: '删除' },
              { type: 'separator' as const },
              { role: 'selectAll' as const, label: '全选', registerAccelerator: false },
            ]),
      ],
    },

    // 视图菜单
    {
      label: '视图',
      submenu: [
        {
          label: '重新加载',
          click: () => reloadFocusedWindow(),
        },
        {
          label: '强制重新加载',
          click: () => reloadFocusedWindow(true),
        },
        { role: 'toggleDevTools' as const, label: '切换开发者工具' },
        { type: 'separator' as const },
        { role: 'resetZoom' as const, label: '重置缩放' },
        { role: 'zoomIn' as const, label: '放大' },
        { role: 'zoomOut' as const, label: '缩小' },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const, label: '切换全屏' },
      ],
    },

    // 窗口菜单
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' as const, label: '最小化' },
        { role: 'zoom' as const, label: '缩放' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const, label: '前置全部窗口' },
              { type: 'separator' as const },
              { role: 'window' as const, label: '窗口' },
            ]
          : [{ role: 'close' as const, label: '关闭' }]),
      ],
    },

    // 帮助菜单
    {
      label: '帮助',
      role: 'help' as const,
      submenu: [
        {
          label: '了解更多',
          click: async () => {
            await shell.openExternal('https://github.com/xcdha/Guru')
          },
        },
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}
