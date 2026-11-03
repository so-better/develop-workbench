import type { AiChatAttachment, AiChatMessage } from '../../types/ai'

/** 保守的模型上下文预算，为输出、system prompt 和工具定义留出空间。 */
const CONTEXT_BUDGET_TOKENS = 96_000
/** 预留给 system prompt、MCP 工具定义、输出和工具结果的空间。 */
const RESERVED_CONTEXT_TOKENS = 16_000
/** 实际可用于历史消息和附件的 token 预算。 */
const MESSAGE_TOKEN_BUDGET = CONTEXT_BUDGET_TOKENS - RESERVED_CONTEXT_TOKENS
/** 非 CJK 文本按约 4 字符一个 token 估算。 */
const NON_CJK_CHARS_PER_TOKEN = 4
/** 图片按视觉 token 估算，避免多图请求失控。 */
const IMAGE_TOKEN_ESTIMATE = 1_200
/** 中日韩文字和常见东亚符号按接近 1 字符一个 token 保守估算。 */
const CJK_PATTERN =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/

/**
 * 粗略估算文本 token。
 * 英文/代码按 4 字符一个 token，中日韩文本按 1 字符一个 token，
 * 避免原来统一按 4 字符估算导致中文上下文严重超限。
 */
const estimateTextTokens = (text: string): number => {
  let tokens = 0

  for (const char of text) {
    tokens += CJK_PATTERN.test(char)
      ? 1
      : 1 / NON_CJK_CHARS_PER_TOKEN
  }

  return Math.ceil(tokens)
}

/** 按估算 token 预算截断文本，尽量保留前面的完整内容。 */
const truncateTextToTokens = (text: string, maxTokens: number): string => {
  if (maxTokens <= 0) return ''

  const chars = Array.from(text)
  let tokens = 0
  let length = 0

  for (const char of chars) {
    const next = tokens + (CJK_PATTERN.test(char)
      ? 1
      : 1 / NON_CJK_CHARS_PER_TOKEN)

    if (next > maxTokens) break

    tokens = next
    length += 1
  }

  return chars.slice(0, length).join('')
}

const estimateAttachmentTokens = (attachment: AiChatAttachment): number =>
  attachment.kind === 'image'
    ? IMAGE_TOKEN_ESTIMATE
    : estimateTextTokens(attachment.text ?? '')

const estimateMessageTokens = (message: AiChatMessage): number =>
  estimateTextTokens(message.content) +
  (message.attachments ?? []).reduce(
    (total, attachment) => total + estimateAttachmentTokens(attachment),
    0
  )

/**
 * 最后一条消息本身超预算时，优先保留正文，再把剩余预算分给附件文本。
 * 图片按固定 token 估算，不在这里删除，避免静默丢图。
 */
const truncateLastMessage = (message: AiChatMessage): AiChatMessage => {
  const attachments = message.attachments ?? []
  const imageTokens = attachments.reduce(
    (total, attachment) =>
      total + (attachment.kind === 'image' ? IMAGE_TOKEN_ESTIMATE : 0),
    0
  )
  let remaining = Math.max(0, MESSAGE_TOKEN_BUDGET - imageTokens)
  const content = truncateTextToTokens(message.content, remaining)

  remaining = Math.max(0, remaining - estimateTextTokens(content))

  const nextAttachments = attachments.map((attachment) => {
    if (attachment.kind !== 'file' || !attachment.text) return attachment

    const text = truncateTextToTokens(attachment.text, remaining)
    remaining = Math.max(0, remaining - estimateTextTokens(text))

    return { ...attachment, text }
  })

  return {
    ...message,
    content,
    ...(message.attachments?.length ? { attachments: nextAttachments } : {})
  }
}

/**
 * 超长对话从最旧消息开始裁剪，始终保留最后一条用户消息。
 * 如果最后一条消息本身仍超预算，则按 token 预算截断正文和附件文本。
 */
export const trimChatMessages = (messages: AiChatMessage[]): AiChatMessage[] => {
  if (messages.length === 0) return messages

  let start = 0
  let total = messages.reduce(
    (sum, message) => sum + estimateMessageTokens(message),
    0
  )

  while (total > MESSAGE_TOKEN_BUDGET && start < messages.length - 1) {
    total -= estimateMessageTokens(messages[start])
    start += 1
  }

  // 丢弃孤立的助手回复，确保裁剪后的上下文从用户提问开始。
  while (start < messages.length && messages[start].role !== 'user') start += 1
  const trimmed = messages.slice(start)
  const last = trimmed[trimmed.length - 1]

  if (!last) return trimmed
  if (estimateMessageTokens(last) <= MESSAGE_TOKEN_BUDGET) return trimmed

  return [
    ...trimmed.slice(0, -1),
    truncateLastMessage(last)
  ]
}
