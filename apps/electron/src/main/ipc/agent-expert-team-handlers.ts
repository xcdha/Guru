/**
 * agent-expert-team-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「Agent 专家团」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { getDefaultExpertTemplatesDir, getExpertsDir } from '../lib/config-paths'
import { createTeam, getTeam, listTeams, updateTeam } from '../lib/expert-service'
import type { CreateTeamInput, UpdateTeamInput } from '../lib/expert-service'
import { isNonEmptyString } from './validators'
import { EXPERT_IPC_CHANNELS } from '@guru/shared'
import type { ExpertTemplate, TeamSquad } from '@guru/shared/experts'
import { ipcMain } from 'electron'
import { existsSync, readFileSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

export function registerAgentExpertTeamHandlers(): void {
  // ===== Agent 专家团（team.json 新结构） =====

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.TEAMS_LIST,
    async (): Promise<TeamSquad[]> => listTeams(getExpertsDir()),
  )

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.TEAMS_GET,
    async (_, id: string): Promise<TeamSquad | null> => {
      if (!isNonEmptyString(id)) throw new Error('id 必填')
      return getTeam(getExpertsDir(), id)
    },
  )

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.TEAMS_CREATE,
    async (_, input: CreateTeamInput): Promise<TeamSquad> => {
      if (!input || typeof input !== 'object') throw new Error('input 必须是对象')
      if (!isNonEmptyString(input.id)) throw new Error('id 必填')
      if (!isNonEmptyString(input.label)) throw new Error('label 必填')
      if (!isNonEmptyString(input.leaderExpertId)) throw new Error('leaderExpertId 必填')
      return createTeam(getExpertsDir(), input)
    },
  )

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.TEAMS_UPDATE,
    async (_, id: string, patch: UpdateTeamInput): Promise<TeamSquad> => {
      if (!isNonEmptyString(id)) throw new Error('id 必填')
      if (!patch || typeof patch !== 'object') throw new Error('patch 必须是对象')
      return updateTeam(getExpertsDir(), id, patch)
    },
  )

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.TEMPLATES_LIST,
    async (): Promise<ExpertTemplate[]> => {
      const templatesDir = getDefaultExpertTemplatesDir()
      if (!existsSync(templatesDir)) return []
      const templates: ExpertTemplate[] = []
      for (const entry of readdirSync(templatesDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        try {
          const parsed = JSON.parse(readFileSync(join(templatesDir, entry.name), 'utf-8'))
          if (typeof parsed?.slug !== 'string') continue
          templates.push({
            slug: parsed.slug,
            name: typeof parsed.name === 'string' ? parsed.name : parsed.slug,
            description: typeof parsed.description === 'string' ? parsed.description : '',
            category: typeof parsed.category === 'string' ? parsed.category : '',
            icon: typeof parsed.icon === 'string' ? parsed.icon : '',
            accent: typeof parsed.accent === 'string' ? parsed.accent : '',
            instructions: typeof parsed.instructions === 'string' ? parsed.instructions : '',
            skills: Array.isArray(parsed.skills) ? parsed.skills.filter((s: unknown): s is string => typeof s === 'string') : [],
          })
        } catch (error) {
          console.warn(`[专家] 跳过损坏的专家模板 ${entry.name}:`, error)
          // 损坏文件改名备份，避免每次启动重复解析失败，也保留用户数据恢复的可能
          try {
            renameSync(join(templatesDir, entry.name), join(templatesDir, `${entry.name}.corrupt-${Date.now()}.bak`))
          } catch { /* 备份失败不阻断列表 */ }
          continue
        }
      }
      return templates.sort((a, b) => a.slug.localeCompare(b.slug))
    },
  )
}
