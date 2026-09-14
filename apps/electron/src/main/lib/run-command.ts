/**
 * run-command — 带超时的外部命令执行（不经 shell，避免注入）
 *
 * 从 src/main/ipc.ts 提升为独立模块（2026-09-14）：ipc.ts 内有 6 处模块级
 * 辅助函数与「运行时相关」IPC 分组都在用，放在 ipc.ts 内会阻碍分组抽取。
 */

/** 异步执行外部命令，超时即 kill；不经 shell，避免 shell 元字符注入。 */
export async function runCmd(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number; stdin?: string } = {},
): Promise<{ status: number | null; stdout: string }> {
  const { spawn } = await import('node:child_process')
  const { timeoutMs = 4000, stdin } = opts
  return new Promise((resolvePromise) => {
    const child = spawn(bin, args, {
      stdio: [stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'ignore'],
    })
    let stdout = ''
    let settled = false
    const finish = (status: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({ status, stdout })
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      finish(null)
    }, timeoutMs)
    child.on('error', () => finish(null))
    child.on('close', (code) => finish(code))
    if (child.stdout) {
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => { stdout += chunk })
    }
    if (stdin !== undefined && child.stdin) {
      child.stdin.end(stdin)
    }
  })
}
