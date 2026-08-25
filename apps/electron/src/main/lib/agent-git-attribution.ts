/**
 * Guru Git / PR 归因标识
 *
 * 目标：当 Agent 代用户创建 commit / PR 时，附带可搜索、可关闭的 Guru 标识，
 * 用于产品曝光。Commit trailer 固定为 `Guru <Guru@noreply.github.com>`——
 * 标准 `Name <email>` 格式，GitHub 会正式识别为 co-author（署名固定为 Guru，
 * 不随执行模型变化；这是用户明确要求的固定署名方式，会显示在 contributors 列表）。
 *
 * v1（最小版）保障：
 * 1. System prompt 指令（Claude / Pi 通用）— 引导 Agent 在 git commit / gh pr 时附加标识，
 *    值固定，无需 Agent 自行填入模型名。
 * 2. （Claude runtime 已退役，Pi runtime 不需要 .claude/settings.json，SDK attribution 路径不再使用）
 *
 * 后续可增强：canUseTool 对 Bash 的确定性 --trailer / body 注入。
 */

/** 默认开启：对齐 Claude Code / Cursor「默认归因 + 可关」策略 */
export const DEFAULT_GIT_ATTRIBUTION_ENABLED = true

/** 开源仓库完整地址 */
export const GURU_GITHUB_URL = 'https://github.com/xcdha/Guru'

/** Commit trailer key（标准 git trailer key） */
export const GURU_COMMIT_TRAILER_KEY = 'Co-Authored-By'

/**
 * Commit trailer 固定值：`Guru <Guru@noreply.github.com>`。
 * 标准 `Name <email>` 格式，GitHub 会识别为 co-author；固定署名 Guru，
 * 不随执行模型变化（旧版为 `<模型名> in Guru`，无邮箱、不计入 co-author）。
 */
export const GURU_COMMIT_TRAILER_VALUE = 'Guru <Guru@noreply.github.com>'

/**
 * PR / MR 描述底部标识。
 * 含开源仓库完整链接，便于推广与引流。
 */
export const GURU_PR_ATTRIBUTION =
  `Made with [Guru](${GURU_GITHUB_URL})`

export interface GitAttributionConfig {
  /** 是否启用；undefined 视为默认开启 */
  enabled?: boolean
}

/** 解析最终是否启用（缺省 = 默认开启） */
export function isGitAttributionEnabled(config?: GitAttributionConfig | boolean | null): boolean {
  if (typeof config === 'boolean') return config
  if (config && typeof config === 'object' && typeof config.enabled === 'boolean') {
    return config.enabled
  }
  return DEFAULT_GIT_ATTRIBUTION_ENABLED
}

/** 注入到 buildSystemPrompt 的 Git/PR 标识规范 */
export function buildGitAttributionPromptSection(enabled: boolean): string {
  if (!enabled) {
    return `## Git / PR 标识

用户已在 Guru 设置中关闭「Git/PR 标识」。当你创建 git commit 或 Pull Request / Merge Request 时：
- **不要**添加任何 Guru 相关归因（包括 \`${GURU_COMMIT_TRAILER_KEY}: ${GURU_COMMIT_TRAILER_VALUE}\`、\`${GURU_PR_ATTRIBUTION}\`、\`Generated with Guru\` 等）
- 也不要主动建议用户打开该标识；仅当用户明确要求时再添加`
  }

  return `## Git / PR 标识（推广归因，默认开启）

当**你**通过 Bash 等工具代用户创建 git commit 或 Pull Request / Merge Request 时，必须附加 Guru 标识（用户当次明确说「不要带标识」除外）。

### Commit
在 commit message **末尾**追加标准 git trailer（与正文之间空一行）：

\`\`\`text
${GURU_COMMIT_TRAILER_KEY}: ${GURU_COMMIT_TRAILER_VALUE}
\`\`\`

值固定为 \`Guru <Guru@noreply.github.com>\`（标准 \`Name <email>\` 格式，GitHub 会显示为 Guru 的 co-author，这是有意为之的固定署名）；**不要**改成当前模型的展示名，也不要改名字或邮箱。

规则：
- 若 message 已含匹配 \`${GURU_COMMIT_TRAILER_KEY}:.*Guru.*\`（大小写不敏感）的行，不要重复添加
- 推荐：\`git commit --trailer "${GURU_COMMIT_TRAILER_KEY}: ${GURU_COMMIT_TRAILER_VALUE}" -m "subject"\`；或多段 \`-m\`，确保 trailer 单独处于最后一段且格式为 \`Key: Value\`
- 不要改 author / committer 身份；标识只出现在 message trailer

### Pull Request / Merge Request
在 PR/MR 描述 **末尾**追加（与正文空一行）：

\`\`\`text
${GURU_PR_ATTRIBUTION}
\`\`\`

- 开源仓库：\`${GURU_GITHUB_URL}\`（不要写成其他错误地址）
- 若 body 已含 \`github.com/xcdha/Guru\` 的 Made with / Generated with 行，不要重复
- \`gh pr create\` 时把上述行放进 \`--body\` 末尾；若用 body 文件，同样追加在文件末尾

### 关闭方式
用户可在 **设置 → 通用 → Git/PR 标识** 关闭。关闭后本段指令会被替换为「禁止添加标识」。`
}
