/**
 * OpenAI Images 协议适配器（生图工具通用后端）
 *
 * 实现 OpenAI Images API 兼容协议（gpt-image 系列）：
 * - 文生图：POST {base}/v1/images/generations（JSON）
 * - 图片编辑：POST {base}/v1/images/edits（multipart/form-data，参考图以文件上传）
 *
 * 协议要点（依据 nbility.ai /docs/api/images 及 OpenAI 官方规范）：
 * - response_format 必须显式传 'b64_json'，缺省按 'url' 处理
 * - prompt 上限 1000 字符，超长截断并在 notes 中说明
 * - size 支持 1K/2K/4K 档（1024x1024 ... 3840x2160），由 aspectRatio+imageSize 映射
 * - 响应兼容四种变体：data[].b64_json、data[].url、image_urls[]、result_url；
 *   url 变体自动下载图片转 base64
 */

// ===== 默认配置 =====

/** OpenAI Images 协议默认 baseUrl（可在设置中覆盖为中转地址，如 nbility） */
export const OPENAI_IMAGES_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
/** OpenAI Images 协议默认模型 */
export const OPENAI_IMAGES_DEFAULT_MODEL = 'gpt-image-2'

// ===== 类型 =====

export interface OpenAIImageRefImage {
  mimeType: string
  /** base64 编码的图片数据（不含 data: 前缀） */
  data: string
}

export interface OpenAIImageOptions {
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  refImages?: OpenAIImageRefImage[]
  aspectRatio?: string
  imageSize?: string
  numberOfImages?: number
}

export interface OpenAIImageResult {
  images: OpenAIImageRefImage[]
  /** 截断/降级等非致命说明 */
  notes: string[]
}

// ===== 参数映射 =====

/** prompt 最大长度（gpt-image 系列限制） */
const MAX_PROMPT_LENGTH = 1000

interface SizeSpec {
  square: string
  landscape: string
  portrait: string
}

const SIZE_TABLE: Record<string, SizeSpec> = {
  auto: { square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' },
  '1K': { square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' },
  '2K': { square: '2048x2048', landscape: '2048x1152', portrait: '1024x1536' },
  '4K': { square: '2048x2048', landscape: '3840x2160', portrait: '2160x3840' },
}

function orientationOf(aspectRatio: string | undefined): keyof SizeSpec {
  switch (aspectRatio) {
    case '16:9':
    case '4:3':
      return 'landscape'
    case '9:16':
    case '3:4':
      return 'portrait'
    default:
      return 'square'
  }
}

/**
 * 将工具统一的 aspectRatio + imageSize 参数映射为 OpenAI size 字符串。
 * 渠道未提供的组合（如 2K 竖版）回落到最近可用档。
 */
export function mapToOpenAISize(aspectRatio?: string, imageSize?: string): { size: string; note?: string } {
  const tier = SIZE_TABLE[imageSize ?? 'auto'] ? (imageSize ?? 'auto') : 'auto'
  const orientation = orientationOf(aspectRatio)
  const spec = SIZE_TABLE[tier]!
  let size = spec[orientation]
  const notes: string[] = []

  // 档位降级说明
  if (tier === 'auto' && imageSize && imageSize !== 'auto') {
    notes.push(`imageSize "${imageSize}" 不受支持，已回退到 auto`)
  }
  // 方向缺失时的回落说明（2K 无竖版 / 4K 无方版）
  if (orientation === 'portrait' && tier === '2K') {
    notes.push('该渠道 2K 档不提供竖版尺寸，已使用 1K 竖版 1024x1536')
  }
  if (orientation === 'square' && tier === '4K') {
    notes.push('该渠道 4K 档不提供方版尺寸，已使用 2K 方版 2048x2048')
  }
  // aspectRatio 近似说明
  if (aspectRatio === '4:3' || aspectRatio === '3:4') {
    notes.push(`比例 ${aspectRatio} 以最接近的 ${size} 输出`)
  }

  return { size, note: notes.length > 0 ? notes.join('；') : undefined }
}

// ===== 响应解析 =====

async function downloadAsBase64(url: string, apiKey: string): Promise<OpenAIImageRefImage> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    throw new Error(`下载生成图片失败 (${res.status}): ${url.slice(0, 120)}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  return {
    mimeType: res.headers.get('content-type')?.split(';')[0] || 'image/png',
    data: buffer.toString('base64'),
  }
}

/** 解析 generations/edits 的响应体，兼容四种响应变体 */
async function parseImageResponse(payload: unknown, apiKey: string): Promise<{ images: OpenAIImageRefImage[]; notes: string[] }> {
  const notes: string[] = []
  const body = payload as {
    data?: Array<{ b64_json?: string; url?: string }>
    image_urls?: string[]
    result_url?: string
    error?: { message?: string }
    message?: string
  }

  if (body?.error?.message) {
    throw new Error(`API 错误: ${body.error.message}`)
  }

  const images: OpenAIImageRefImage[] = []

  // 变体 1/2：标准 OpenAI 格式 data[].b64_json 或 data[].url
  for (const item of body?.data ?? []) {
    if (item.b64_json) {
      images.push({ mimeType: 'image/png', data: item.b64_json })
    } else if (item.url) {
      notes.push('响应为 url 格式，已自动下载')
      images.push(await downloadAsBase64(item.url, apiKey))
    }
  }

  // 变体 3/4：任务式包装 image_urls[] / result_url（部分中转渠道）
  if (images.length === 0 && Array.isArray(body?.image_urls) && body.image_urls.length > 0) {
    notes.push('响应为任务式 image_urls 格式，已自动下载')
    for (const url of body.image_urls) {
      images.push(await downloadAsBase64(url, apiKey))
    }
  }
  if (images.length === 0 && typeof body?.result_url === 'string' && body.result_url) {
    notes.push('响应为任务式 result_url 格式，已自动下载')
    images.push(await downloadAsBase64(body.result_url, apiKey))
  }

  if (images.length === 0) {
    throw new Error(`未能从响应中解析出图片: ${JSON.stringify(payload).slice(0, 200)}`)
  }

  return { images, notes }
}

// ===== 主入口 =====

/**
 * 归一化 OpenAI 兼容 baseUrl 并生成资源端点。
 *
 * 兼容三种写法：
 * - https://api.openai.com/v1  → https://api.openai.com/v1/images/generations
 * - https://api.nbility.ai/v1  → https://api.nbility.ai/v1/images/generations
 * - https://api.nbility.ai    → https://api.nbility.ai/v1/images/generations
 * 避免 baseUrl 已带 /v1 时重复拼成 /v1/v1。
 */
export function openAIImageEndpoint(baseUrl: string, resource: 'generations' | 'edits'): string {
  const base = baseUrl.replace(/\/$/, '')
  const normalized = base.endsWith('/v1') ? base : `${base}/v1`
  return `${normalized}/images/${resource}`
}

/**
 * 调用 OpenAI Images 兼容接口生成/编辑图片。
 * 有参考图走 /v1/images/edits（multipart），否则走 /v1/images/generations（JSON）。
 */
export async function callOpenAIImages(options: OpenAIImageOptions): Promise<OpenAIImageResult> {
  const notes: string[] = []

  // prompt 截断保护（gpt-image 系列上限 1000 字符）
  let prompt = options.prompt
  if (prompt.length > MAX_PROMPT_LENGTH) {
    prompt = prompt.slice(0, MAX_PROMPT_LENGTH)
    notes.push(`prompt 超过 ${MAX_PROMPT_LENGTH} 字符上限，已截断（原文 ${options.prompt.length} 字符）`)
  }

  const n = Math.min(Math.max(Math.round(options.numberOfImages ?? 1), 1), 10)
  if ((options.numberOfImages ?? 1) > 10) {
    notes.push('生成数量上限为 10，已按 10 处理')
  }

  const { size, note: sizeNote } = mapToOpenAISize(options.aspectRatio, options.imageSize)
  if (sizeNote) notes.push(sizeNote)

  const refImages = options.refImages ?? []
  const isEdit = refImages.length > 0
  const url = openAIImageEndpoint(options.baseUrl, isEdit ? 'edits' : 'generations')

  console.log(`[OpenAI Images] ${isEdit ? 'edits(multipart)' : 'generations'}: model=${options.model}, size=${size}, refs=${refImages.length}`)

  // 单次构建请求体 + 发送；返回 response 或抛错。
  const buildAndSend = (): Promise<Response> => {
    if (isEdit) {
      const form = new FormData()
      form.append('model', options.model)
      form.append('prompt', prompt)
      form.append('n', String(n))
      if (size && size !== 'auto') form.append('size', size)
      form.append('response_format', 'b64_json')
      // 单图用 image 字段，多图用 image[] 数组字段（与主流网关兼容）
      const fieldName = refImages.length > 1 ? 'image[]' : 'image'
      for (const img of refImages) {
        const bytes = Buffer.from(img.data, 'base64')
        const ext = img.mimeType === 'image/jpeg' ? 'jpg' : 'png'
        form.append(fieldName, new Blob([new Uint8Array(bytes)], { type: img.mimeType }), `reference.${ext}`)
      }
      return fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(600_000),
      })
    }
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        prompt,
        n,
        ...(size && size !== 'auto' ? { size } : {}),
        response_format: 'b64_json',
      }),
      signal: AbortSignal.timeout(600_000),
    })
  }

  /** 网络/服务端类错误（可重试）：fetch 失败、超时、429、5xx。业务 4xx 不重试。 */
  const isRetryable = (err: unknown): boolean => {
    if (err instanceof Error) {
      const msg = err.message
      // fetch 失败/超时/连接中断
      if (/fetch failed|abort|timed out|ECONN|ECONNRESET|socket|network/i.test(msg)) return true
      return false
    }
    return false
  }

  const MAX_ATTEMPTS = 2
  let lastRetryable = false
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response
    try {
      response = await buildAndSend()
    } catch (err) {
      lastRetryable = isRetryable(err)
      if (attempt < MAX_ATTEMPTS && lastRetryable) {
        notes.push('网络抖动，已自动重试')
        await sleep(RETRY_DELAY_MS)
        continue
      }
      throw err
    }

    if (response.ok) {
      const payload = await response.json()
      const parsed = await parseImageResponse(payload, options.apiKey)
      return { images: parsed.images, notes: [...notes, ...parsed.notes] }
    }

    const errorText = await response.text()
    // 429 / 5xx 视为可重试
    const retryableStatus = response.status === 429 || response.status >= 500
    if (attempt < MAX_ATTEMPTS && retryableStatus) {
      notes.push(`服务端 ${response.status}，已自动重试`)
      await sleep(RETRY_DELAY_MS)
      continue
    }
    throw new Error(`请求失败 (${response.status}): ${errorText.slice(0, 300)}`)
  }

  throw new Error('请求失败（重试次数已耗尽）')
}

/** 自动重试间隔（毫秒） */
const RETRY_DELAY_MS = 5000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
