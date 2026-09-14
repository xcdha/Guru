/**
 * discover-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「「发现」面板」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { registerGuruFilePath } from '../lib/local-file-protocol'
import { DISCOVER_IPC_CHANNELS } from '@guru/shared'
import type { DiscoverContentItem, DiscussionCategorySlug } from '@guru/shared'
import { ipcMain } from 'electron'

export function registerDiscoverHandlers(): void {
  // ===== 「发现」面板（官方内容流 + 社区 + 反馈入口）=====

  // 拉取官方精选流（清单 + 更新标记 + 未读红点；force 绕过内存缓存重新拉网络）
  ipcMain.handle(DISCOVER_IPC_CHANNELS.GET_FEED, async (_event, force?: boolean) => {
    const { fetchDiscoverFeed } = await import('../lib/content-service')
    return fetchDiscoverFeed(force)
  })

  // 拉取 article 的 markdown 正文
  ipcMain.handle(DISCOVER_IPC_CHANNELS.GET_ARTICLE, async (_event, contentUrl: string) => {
    const { fetchArticleContent } = await import('../lib/content-service')
    return fetchArticleContent(contentUrl)
  })

  // 查询视频本地缓存状态
  ipcMain.handle(
    DISCOVER_IPC_CHANNELS.GET_VIDEO_STATUS,
    async (_event, itemId: string, version: string, size?: number) => {
      const { getVideoStatus } = await import('../lib/content-service')
      return getVideoStatus(itemId, version, size)
    }
  )

  // 下载视频到本地缓存（进度经 VIDEO_DOWNLOAD_PROGRESS 推送）
  ipcMain.handle(
    DISCOVER_IPC_CHANNELS.DOWNLOAD_VIDEO,
    async (event, item: DiscoverContentItem) => {
      const { downloadVideo } = await import('../lib/content-service')
      const result = await downloadVideo(item, event.sender)
      return { filePath: result.filePath }
    }
  )

  // 记录条目已读版本
  ipcMain.handle(DISCOVER_IPC_CHANNELS.MARK_SEEN, async (_event, itemId: string, version: string) => {
    const { markContentSeen } = await import('../lib/content-service')
    markContentSeen(itemId, version)
  })

  // 拉取未读汇总（官方未读 + 社区新回复，侧边栏徽标用）
  ipcMain.handle(DISCOVER_IPC_CHANNELS.GET_UNREAD_SUMMARY, async () => {
    const [{ getFeedUnreadCount }, { getCommunityUnreadCount }] = await Promise.all([
      import('../lib/content-service'),
      import('../lib/community-service'),
    ])
    return { feedUnread: getFeedUnreadCount(), communityUnread: await getCommunityUnreadCount() }
  })

  // 记录某讨论已读（打开详情时调用）
  ipcMain.handle(
    DISCOVER_IPC_CHANNELS.MARK_DISCUSSION_VIEWED,
    async (_event, number: number, commentCount: number) => {
      const { markDiscussionViewed } = await import('../lib/community-service')
      markDiscussionViewed(number, commentCount)
    }
  )

  // 拉取讨论列表（按板块）
  ipcMain.handle(
    DISCOVER_IPC_CHANNELS.LIST_DISCUSSIONS,
    async (_event, categorySlug: DiscussionCategorySlug, force?: boolean) => {
      const { listDiscussions } = await import('../lib/community-service')
      return listDiscussions(categorySlug, force)
    }
  )

  // 拉取讨论详情正文与评论（force 绕过缓存重拉）
  ipcMain.handle(DISCOVER_IPC_CHANNELS.GET_DISCUSSION, async (_event, number: number, force?: boolean) => {
    const { getDiscussion } = await import('../lib/community-service')
    return getDiscussion(number, force)
  })

  // 拉取 Wiki 页面树（force 同步刷新克隆；否则读缓存并后台刷新，更新经 WIKI_UPDATED 推送）
  ipcMain.handle(DISCOVER_IPC_CHANNELS.GET_WIKI_PAGES, async (event, force?: boolean) => {
    const { getWikiPages } = await import('../lib/wiki-service')
    return getWikiPages(event.sender, Boolean(force))
  })

  // 手动刷新 Wiki（等价 GET_WIKI_PAGES force=true）
  ipcMain.handle(DISCOVER_IPC_CHANNELS.REFRESH_WIKI, async (event) => {
    const { getWikiPages } = await import('../lib/wiki-service')
    return getWikiPages(event.sender, true)
  })

  // 读取单个 Wiki 页面正文
  ipcMain.handle(DISCOVER_IPC_CHANNELS.GET_WIKI_PAGE, async (_event, name: string) => {
    const { getWikiPage } = await import('../lib/wiki-service')
    return getWikiPage(name)
  })

  // 为已下载视频文件注册 guru-file:// 播放 URL（token 门控，支持 Range seek）
  ipcMain.handle(DISCOVER_IPC_CHANNELS.GET_VIDEO_URL, async (_event, filePath: string) => {
    const { isPathInVideoCacheDir } = await import('../lib/content-service')
    if (!isPathInVideoCacheDir(filePath)) {
      throw new Error('非法的视频缓存路径')
    }
    const { registerGuruFilePath } = await import('../lib/local-file-protocol')
    return registerGuruFilePath(filePath)
  })

  // 为远程视频注册 discover-video:// 流式播放 URL（白名单校验在主进程）
  ipcMain.handle(DISCOVER_IPC_CHANNELS.GET_VIDEO_STREAM_URL, async (_event, remoteUrl: string) => {
    const { registerDiscoverVideoStream } = await import('../lib/discover-video-protocol')
    return registerDiscoverVideoStream(remoteUrl)
  })

  // 删除某视频的本地缓存（按 itemId+version 构造路径，不接收任意路径）
  ipcMain.handle(DISCOVER_IPC_CHANNELS.DELETE_VIDEO_CACHE, async (_event, itemId: string, version: string) => {
    const { deleteVideoCache } = await import('../lib/content-service')
    deleteVideoCache(itemId, version)
  })
}
