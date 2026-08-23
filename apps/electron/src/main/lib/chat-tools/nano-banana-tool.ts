/**
 * Nano Banana 生图工具模块（Chat 模式）
 *
 * 基于 Gemini Image Generation API 提供 AI 生图能力。
 * 支持文生图、参考图编辑、多轮连续修改。
 * 凭据存储在 ~/.myyoda/chat-tools.json 的 toolCredentials 中。
 */

import type { ToolCall, ToolResult, ToolDefinition } from '@myyoda/core'
import type { ChatToolMeta, FileAttachment } from '@myyoda/shared'
import { randomUUID } from 'node:crypto'
import { getToolCredentials } from '../chat-tool-config'
import { saveAttachment, readAttachmentAsBase64, isImageAttachment } from '../attachment-service'
import { callOpenAIImages, extractGeminiImageParts, stripGeminiTrailingV1, OPENAI_IMAGES_DEFAULT_BASE_URL, OPENAI_IMAGES_DEFAULT_MODEL } from './openai-images-provider'

// ===== Gemini API 类型（REST API 使用 camelCase） =====

interface GeminiInlineData {
  mimeType: string
  data: string
}

interface GeminiPart {
  text?: string
  inlineData?: GeminiInlineData
  /** nbility 等中转返回的图片文件引用：fileUri 为 CDN 图片 URL */
  fileData?: GeminiFileData
  /** Gemini 多轮对话必需：模型生成图片时附带的签名，回传时原样保留 */
  thoughtSignature?: string
  /** snake_case 兼容（部分 API 版本） */
  thought_signature?: string
  /** Flash 思考模式下的 reasoning part，不应作为输出图展示 */
  thought?: boolean
}

interface GeminiFileData {
  mimeType: string
  fileUri: string
}

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

interface GeminiCandidate {
  content: {
    parts: GeminiPart[]
    role: string
  }
}

interface GeminiResponse {
  candidates?: GeminiCandidate[]
  error?: { message: string; code: number }
}

// ===== 多轮对话历史 =====

/** 每个 conversationId 对应的 Gemini 对话历史 */
const conversationHistory = new Map<string, GeminiContent[]>()

// ===== 工具执行上下文 =====

/** Nano Banana 工具执行所需的额外上下文 */
export interface NanoBananaContext {
  /** 对话 ID（用于保存附件和管理对话历史） */
  conversationId: string
  /** 当前用户消息的附件列表 */
  currentAttachments?: FileAttachment[]
  /** 前一轮用户消息的附件 */
  previousUserAttachments?: FileAttachment[]
  /** 前一轮助手消息的附件 */
  previousAssistantAttachments?: FileAttachment[]
}

// ===== 默认配置 =====

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com'
const DEFAULT_MODEL = 'gemini-3.1-flash-image-preview'

// ===== 工具元数据 =====

export const NANO_BANANA_TOOL_META: ChatToolMeta = {
  id: 'nano-banana',
  name: 'AI 生图',
  description: 'AI 图片生成与编辑（支持 Gemini Nano Banana 与 GPT-Image 双协议，设置中可切换）',
  params: [
    { name: 'prompt', type: 'string', description: '图片生成/编辑描述', required: true },
  ],
  icon: 'ImagePlus',
  category: 'builtin',
  executorType: 'builtin',
  systemPromptAppend: `
<image_generation_instructions>
你拥有 AI 图片生成和编辑能力（后端协议由用户配置：Gemini Nano Banana 或 GPT-Image 系列）。

**generate_image — 生成/编辑图片：**
当用户需要创建或修改图片时调用：
- 用户要求画画、生成图片、创作插图
- 用户上传了图片并要求修改、编辑、调整
- 用户想要基于描述生成视觉内容

**参数说明：**
- prompt: 详细描述想要生成的图片内容，用英文描述效果最佳
- aspectRatio: 可选宽高比 "1:1"(默认) / "16:9" / "4:3" / "9:16" / "3:4"
- imageSize: 可选分辨率 "auto"(默认) / "1K" / "2K" / "4K"
- numberOfImages: 可选生成数量 1-4（默认 1），用户要求多张时设置
- useReferenceImages: 当用户上传了参考图或要求修改之前生成的图片时设为 true

**使用技巧：**
- 生成新图片时用详细的英文描述
- 编辑图片时设置 useReferenceImages: true，并在 prompt 中描述要做的修改
- 支持连续修改：多次调用时会自动保持上下文
</image_generation_instructions>`,
}

// ===== 工具定义（ToolDefinition 格式，传给 Provider） =====

export const NANO_BANANA_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'generate_image',
    description: 'Generate or edit images using AI. Supports text-to-image generation, reference image editing, and iterative modifications with context.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the image to generate or the edits to make. English descriptions work best.',
        },
        aspectRatio: {
          type: 'string',
          description: 'Aspect ratio of the generated image',
          enum: ['1:1', '16:9', '4:3', '9:16', '3:4'],
        },
        imageSize: {
          type: 'string',
          description: 'Resolution of the generated image',
          enum: ['auto', '1K', '2K', '4K'],
        },
        useReferenceImages: {
          type: 'string',
          description: 'Set to "true" to use uploaded reference images or previously generated images for editing',
          enum: ['true', 'false'],
        },
        numberOfImages: {
          type: 'number',
          description: 'Number of images to generate (1-4, default 1)',
        },
      },
      required: ['prompt'],
    },
  },
]

// ===== 可用性检查 =====

/**
 * 检查 Nano Banana 工具是否可用（API Key 已配置）
 */
export function isNanoBananaAvailable(): boolean {
  const credentials = getToolCredentials('nano-banana')
  return !!credentials.apiKey
}

// ===== 工具执行 =====

/** 工具名称集合 */
const NANO_BANANA_TOOL_NAMES = new Set(['generate_image'])

/**
 * 判断是否为 Nano Banana 工具调用
 */
export function isNanoBananaToolCall(toolName: string): boolean {
  return NANO_BANANA_TOOL_NAMES.has(toolName)
}

/**
 * 收集参考图的 base64 数据
 *
 * 按时间从早到晚排列：前一轮用户附件 → 前一轮助手附件 → 当前用户附件
 */
function collectReferenceImages(context: NanoBananaContext): GeminiPart[] {
  const parts: GeminiPart[] = []

  const allAttachments: FileAttachment[] = [
    ...(context.previousUserAttachments ?? []),
    ...(context.previousAssistantAttachments ?? []),
    ...(context.currentAttachments ?? []),
  ]

  for (const attachment of allAttachments) {
    if (!isImageAttachment(attachment.mediaType)) continue

    try {
      const base64 = readAttachmentAsBase64(attachment.localPath)
      parts.push({
        inlineData: {
          mimeType: attachment.mediaType,
          data: base64,
        },
      })
    } catch (error) {
      console.warn(`[AI 生图] 读取参考图失败: ${attachment.localPath}`, error)
    }
  }

  return parts
}

/**
 * Gemini 多轮对话中，模型响应包含 thoughtSignature 后，
 * 后续所有 user 消息的 text part 也必须携带 thoughtSignature。
 * 使用 Gemini 官方提供的跳过验证占位符。
 * @see https://ai.google.dev/gemini-api/docs/thought-signatures
 */
const DUMMY_THOUGHT_SIGNATURE = 'skip_thought_signature_validator'

/** 检查对话历史中是否存在 thoughtSignature */
function historyHasThoughtSignature(history: GeminiContent[]): boolean {
  return history.some((c) =>
    c.parts.some((p) => p.thoughtSignature || p.thought_signature),
  )
}

/**
 * 构建 Gemini API 请求体
 */
function buildGeminiRequest(
  prompt: string,
  referenceImageParts: GeminiPart[],
  history: GeminiContent[],
  options: {
    aspectRatio?: string
    imageSize?: string
    numberOfImages?: number
  },
): Record<string, unknown> {
  // 多轮对话中 model 响应含 thoughtSignature 时，新 user 的 text part 也必须带签名
  const needsSignature = history.length > 0 && historyHasThoughtSignature(history)

  const userParts: GeminiPart[] = [
    ...referenceImageParts,
    {
      text: prompt,
      ...(needsSignature && { thoughtSignature: DUMMY_THOUGHT_SIGNATURE }),
    },
  ]

  // 合并历史 + 当前用户消息
  const contents: GeminiContent[] = [
    ...history,
    { role: 'user', parts: userParts },
  ]

  const generationConfig: Record<string, unknown> = {
    responseModalities: ['TEXT', 'IMAGE'],
  }

  // 图片配置
  const imageConfig: Record<string, unknown> = {}
  if (options.aspectRatio && options.aspectRatio !== '1:1') {
    imageConfig.aspectRatio = options.aspectRatio
  }
  if (options.imageSize && options.imageSize !== 'auto') {
    imageConfig.imageSize = options.imageSize
  }
  // NOTE: numberOfImages is kept in schema for future API support but not forwarded.
  if (Object.keys(imageConfig).length > 0) {
    generationConfig.imageConfig = imageConfig
  }

  return { contents, generationConfig }
}

/**
 * 执行 Nano Banana 工具调用
 */
export async function executeNanoBananaTool(
  toolCall: ToolCall,
  context: NanoBananaContext,
): Promise<ToolResult> {
  const credentials = getToolCredentials('nano-banana')

  if (!credentials.apiKey) {
    return {
      toolCallId: toolCall.id,
      content: 'AI 生图未配置 API Key',
      isError: true,
    }
  }

  try {
    const prompt = toolCall.arguments.prompt as string
    const aspectRatio = toolCall.arguments.aspectRatio as string | undefined
    const imageSize = toolCall.arguments.imageSize as string | undefined
    const useReferenceImages = toolCall.arguments.useReferenceImages === 'true'
    const numberOfImages = typeof toolCall.arguments.numberOfImages === 'number'
      ? Math.min(Math.max(Math.round(toolCall.arguments.numberOfImages), 1), 4)
      : 1

    if (!prompt) {
      return {
        toolCallId: toolCall.id,
        content: '参数缺失: prompt',
        isError: true,
      }
    }

    const baseUrl = credentials.baseUrl?.trim() || DEFAULT_BASE_URL
    const model = credentials.model?.trim() || DEFAULT_MODEL
    const provider = credentials.provider?.trim() || 'gemini'

    // ===== OpenAI Images 协议分支（gpt-image 系列）=====
    if (provider === 'openai-images') {
      const openaiBaseUrl = baseUrl === DEFAULT_BASE_URL ? OPENAI_IMAGES_DEFAULT_BASE_URL : baseUrl
      const openaiModel = model === DEFAULT_MODEL ? OPENAI_IMAGES_DEFAULT_MODEL : model
      // 参考图：从 GeminiPart 格式提取 inlineData（复用现有收集逻辑）
      const refImages = useReferenceImages
        ? collectReferenceImages(context)
            .map((p) => p.inlineData)
            .filter((d): d is NonNullable<typeof d> => !!d)
        : []

      console.log(`[AI 生图] 调用 OpenAI Images API: model=${openaiModel}, prompt="${prompt.slice(0, 50)}..."`)

      try {
        const result = await callOpenAIImages({
          baseUrl: openaiBaseUrl,
          apiKey: credentials.apiKey,
          model: openaiModel,
          prompt,
          refImages,
          aspectRatio,
          imageSize,
          numberOfImages,
        })

        const generatedAttachments: FileAttachment[] = []
        for (const img of result.images) {
          const ext = img.mimeType === 'image/jpeg' ? '.jpg' : '.png'
          const saved = saveAttachment({
            conversationId: context.conversationId,
            filename: `ai-image-${randomUUID().slice(0, 8)}${ext}`,
            mediaType: img.mimeType,
            data: img.data,
          })
          generatedAttachments.push(saved.attachment)
        }

        const imageCount = generatedAttachments.length
        const noteText = result.notes.length > 0 ? `\n\n说明: ${result.notes.join('; ')}` : ''
        return {
          toolCallId: toolCall.id,
          content: imageCount > 0 ? `图片已成功生成（${imageCount} 张）${noteText}` : `未生成图片内容${noteText}`,
          isError: imageCount === 0,
          generatedAttachments: imageCount > 0 ? generatedAttachments : undefined,
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[AI 生图] OpenAI Images 执行失败:', error)
        return { toolCallId: toolCall.id, content: `图片生成失败: ${msg}`, isError: true }
      }
    }

    // ===== Gemini 协议分支 =====
    // 收集参考图
    const referenceImageParts = useReferenceImages ? collectReferenceImages(context) : []

    // 获取对话历史
    const history = conversationHistory.get(context.conversationId) ?? []

    // 构建请求
    const requestBody = buildGeminiRequest(prompt, referenceImageParts, history, {
      aspectRatio,
      imageSize,
      numberOfImages,
    })

    const url = `${stripGeminiTrailingV1(baseUrl)}/v1beta/models/${model}:generateContent`

    console.log(`[AI 生图] 调用 Gemini API: model=${model}, prompt="${prompt.slice(0, 50)}..."`)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 用 header 认证而非 ?key= 查询参数：Google 官方与 nbility 等中转均支持 x-goog-api-key，
        // 部分中转（如 nbility）不接受查询参数形式的 key
        'x-goog-api-key': credentials.apiKey,
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[AI 生图] Gemini API 请求失败 (${response.status}):`, errorText)
      return {
        toolCallId: toolCall.id,
        content: `Gemini API 请求失败 (${response.status}): ${errorText.slice(0, 200)}`,
        isError: true,
      }
    }

    const data = (await response.json()) as GeminiResponse

    if (data.error) {
      return {
        toolCallId: toolCall.id,
        content: `Gemini API 错误: ${data.error.message}`,
        isError: true,
      }
    }

    const candidate = data.candidates?.[0]
    if (!candidate) {
      return {
        toolCallId: toolCall.id,
        content: '未生成任何内容',
        isError: true,
      }
    }

    const parts = candidate.content.parts
    console.log(`[AI 生图] 响应包含 ${parts.length} 个 parts，类型:`, parts.map((p) => p.inlineData ? `image(${p.inlineData.mimeType})` : (p.fileData ? `image-file(${p.fileData.mimeType})` : `text(${(p.text ?? '').slice(0, 30)})`)))
    const generatedAttachments: FileAttachment[] = []
    const textParts: string[] = []

    // 解析响应：提取图片和文本（跳过 thought parts，它们是推理过程图，不作为输出）
    // 图片 part 兼容 inlineData（官方）和 fileData（nbility 中转，需下载 URL 转 base64）
    const imageParts = await extractGeminiImageParts(parts)
    for (const img of imageParts) {
      if (!img) continue
      const ext = img.mimeType === 'image/jpeg' ? '.jpg' : '.png'
      const result = saveAttachment({
        conversationId: context.conversationId,
        filename: `ai-image-${randomUUID().slice(0, 8)}${ext}`,
        mediaType: img.mimeType,
        data: img.data,
      })
      generatedAttachments.push(result.attachment)
    }
    for (const part of parts) {
      if (part.thought) continue
      if (part.inlineData || part.fileData) continue
      if (part.text) {
        textParts.push(part.text)
      }
    }

    // 更新对话历史（用于多轮连续修改）
    // 注意：必须原样保留 model 响应中的 parts（含 thoughtSignature），否则多轮编辑会报错
    const userContent: GeminiContent = {
      role: 'user',
      parts: [...referenceImageParts, { text: prompt }],
    }
    const modelContent: GeminiContent = {
      role: 'model',
      parts, // 直接使用原始响应 parts，保留 thoughtSignature 等元数据
    }
    const updatedHistory = [...history, userContent, modelContent]
    conversationHistory.set(context.conversationId, updatedHistory)

    // 构建返回结果
    const imageCount = generatedAttachments.length
    const resultText = imageCount > 0
      ? `图片已成功生成（${imageCount} 张）${textParts.length > 0 ? `\n\n${textParts.join('\n')}` : ''}`
      : textParts.join('\n') || '未生成图片内容'

    return {
      toolCallId: toolCall.id,
      content: resultText,
      generatedAttachments: generatedAttachments.length > 0 ? generatedAttachments : undefined,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[AI 生图] 执行失败:`, error)
    return {
      toolCallId: toolCall.id,
      content: `图片生成失败: ${msg}`,
      isError: true,
    }
  }
}

/**
 * 清除对话的生图历史（对话删除时调用）
 */
export function clearNanoBananaHistory(conversationId: string): void {
  conversationHistory.delete(conversationId)
}
