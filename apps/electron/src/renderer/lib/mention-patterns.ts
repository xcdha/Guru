/**
 * mention 解析模式（移植自 Proma a6ced306）
 *
 * 区分「编码值」和「明文值」两种边界：
 * - 编码值（@file: 路径、&session/&todo/&calendar_event 的 label）用
 *   encodeURIComponent 序列化，可以安全地紧贴 CJK 文本结束。
 * - 明文值（/skill: 技能名、#mcp: MCP 名称）用原始 ID 序列化，可能含 CJK
 *   字符，其边界是 mention 建议/序列化器插入的显式空白。
 *
 * 旧实现统一用 \S+ 会把相邻中文吞进 mention 值，导致引用边界错误。
 */

/**
 * Encoded mention values are safe to end at adjacent CJK text because all
 * generated paths and named-reference labels use encodeURIComponent.
 */
export const ENCODED_MENTION_VALUE_PATTERN = String.raw`[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}，。！？；：、（）【】《》“”‘’]+`

/**
 * MCP server names and Skill slugs are serialized as their raw IDs. These
 * values may legitimately contain CJK characters, so their boundary is the
 * explicit whitespace inserted by the mention suggestion and serializer.
 */
export const PLAIN_MENTION_VALUE_PATTERN = String.raw`\S+`

/** Create a fresh instance because mention parsing uses a global regexp. */
export function createMentionPattern(): RegExp {
  return new RegExp(
    String.raw`@file:(?<file>${ENCODED_MENTION_VALUE_PATTERN})|/skill:(?<skill>${PLAIN_MENTION_VALUE_PATTERN})|#mcp:(?<mcp>${PLAIN_MENTION_VALUE_PATTERN})|&session:(?<session>[A-Za-z0-9-]+)(?:(?:~|::)(?<sessionLabel>${ENCODED_MENTION_VALUE_PATTERN}))?|&todo:(?<todo>[A-Za-z0-9-]+)(?:(?:~|::)(?<todoLabel>${ENCODED_MENTION_VALUE_PATTERN}))?|&calendar_event:(?<calendarEvent>[A-Za-z0-9-]+)(?:(?:~|::)(?<calendarEventLabel>${ENCODED_MENTION_VALUE_PATTERN}))?|&quote:(?<quote>[A-Za-z0-9%_.!~*'()-]+)`,
    'gu',
  )
}
