/**
 * 终端输出缓冲（Agent 可回读）
 *
 * 移植自 Proma c4dc874d（feat(agent): add terminal output readback）。
 * 在保留末尾输出的基础上，记录字符偏移，支持 Agent 按 offset 分页读取
 * PTY 输出（去除控制序列），实现「终端可见 + 输出可读」的 Agent 终端能力。
 */

export interface TerminalOutputBuffer {
  /** 当前仍保留在内存中的原始 PTY 输出。 */
  output: string
  /** 单终端最后接收的输出事件序号。 */
  sequence: number
  /** output 在该终端完整输出流中的起始字符偏移。 */
  startOffset: number
  /** 完整输出流截至目前的字符偏移（exclusive）。 */
  endOffset: number
}

export interface TerminalOutputReadOptions {
  /** 从完整输出流的指定字符偏移开始读取；省略时读取末尾。 */
  offset?: number
  /** 最多返回的原始 PTY 字符数。 */
  limit?: number
}

export interface TerminalOutputReadResult {
  /** 供 Agent 阅读的、去除终端控制序列后的文本。 */
  output: string
  /** 当前内存缓冲仍可读取的完整输出流起始偏移。 */
  availableStartOffset: number
  /** 当前完整输出流的末尾偏移（exclusive）。 */
  availableEndOffset: number
  /** 本次读取的原始输出范围起点。 */
  offset: number
  /** 下一页应传入的 offset。 */
  nextOffset: number
  /** 缓冲区之前已有输出因容量限制不可用，或本次默认从末尾读取而省略了前文。 */
  truncatedBefore: boolean
  /** 当前缓冲区中还有未读取的后续输出。 */
  truncatedAfter: boolean
}

const DEFAULT_READ_CHARS = 12_000
const MAX_READ_CHARS = 48_000

/** 保留可重放的末尾输出；序列号始终对应最后一批已接收数据。 */
export function appendTerminalOutput(
  buffer: TerminalOutputBuffer,
  event: { sequence: number; data: string },
  maxChars: number,
): TerminalOutputBuffer {
  const output = `${buffer.output}${event.data}`
  const retainedOutput = output.length > maxChars ? output.slice(output.length - maxChars) : output
  const endOffset = buffer.endOffset + event.data.length
  return {
    output: retainedOutput,
    sequence: event.sequence,
    startOffset: endOffset - retainedOutput.length,
    endOffset,
  }
}

/**
 * 从有限的 PTY 回放缓冲中分页读取终端文本。
 * offset 使用原始 PTY 流的字符偏移，因而即使缓冲滚动也能明确告知调用方可用范围。
 */
export function readTerminalOutput(
  buffer: TerminalOutputBuffer,
  options: TerminalOutputReadOptions = {},
): TerminalOutputReadResult {
  const limit = normalizeLimit(options.limit)
  const requestedOffset = normalizeOffset(options.offset)
  const defaultOffset = Math.max(buffer.startOffset, buffer.endOffset - limit)
  const offset = clamp(requestedOffset ?? defaultOffset, buffer.startOffset, buffer.endOffset)
  const nextOffset = Math.min(buffer.endOffset, offset + limit)
  const rawOutput = buffer.output.slice(offset - buffer.startOffset, nextOffset - buffer.startOffset)

  return {
    output: normalizeTerminalText(rawOutput),
    availableStartOffset: buffer.startOffset,
    availableEndOffset: buffer.endOffset,
    offset,
    nextOffset,
    truncatedBefore: buffer.startOffset > 0 || offset > buffer.startOffset,
    truncatedAfter: nextOffset < buffer.endOffset,
  }
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_READ_CHARS
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_READ_CHARS) {
    throw new Error(`终端输出读取长度必须是 1 到 ${MAX_READ_CHARS} 之间的整数`)
  }
  return value
}

function normalizeOffset(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('终端输出偏移必须是非负整数')
  return value
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** 去除终端控制序列（ANSI 转义），保留可读文本。 */
function normalizeTerminalText(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
}
