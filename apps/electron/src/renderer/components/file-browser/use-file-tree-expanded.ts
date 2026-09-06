import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { fileBrowserExpandedPathsAtom, updateFileBrowserExpandedPath, relocateFileBrowserExpandedPath } from '@/atoms/agent-atoms'

/**
 * 文件树行共享展开状态：按 stateKey（会话/项目/附加根隔离）+ path 订阅。
 * 主文件树与附加目录树共用运行期记忆，每行只订阅自己的展开布尔值；
 * 目录重命名/移动后可调用 relocateExpandedPath 迁移展开记录。
 */
export function useFileTreeExpanded(stateKey: string, path: string) {
  const expandedAtom = React.useMemo(
    () => selectAtom(fileBrowserExpandedPathsAtom, (state) => state.get(stateKey)?.get(path) ?? false),
    [path, stateKey],
  )
  const expanded = useAtomValue(expandedAtom)
  const setPaths = useSetAtom(fileBrowserExpandedPathsAtom)
  const setExpanded = React.useCallback((update: boolean | ((previous: boolean) => boolean)) => {
    setPaths((previous) => {
      const next = typeof update === 'function' ? update(previous.get(stateKey)?.get(path) ?? false) : update
      return updateFileBrowserExpandedPath(previous, stateKey, path, next)
    })
  }, [path, stateKey, setPaths])
  const relocateExpandedPath = React.useCallback((newPath: string) => {
    setPaths((previous) => relocateFileBrowserExpandedPath(previous, stateKey, path, newPath))
  }, [path, stateKey, setPaths])
  return [expanded, setExpanded, relocateExpandedPath] as const
}
