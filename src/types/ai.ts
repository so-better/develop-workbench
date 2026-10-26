/**
 * AI 配置、聊天事件、附件和展示产物类型。
 */

/** 单个模型配置。 */
export interface AiConfig {
  name: string
  model: string
  baseUrl: string
  apiKey: string
  headers: Record<string, string>
  options: Record<string, unknown>
}

/** 聊天附件。当前轮会携带图片数据或文档文本，历史轮只保留元信息。 */
export interface AiChatAttachment {
  id: string
  name: string
  mimeType: string
  kind: 'image' | 'file'
  size: number
  /** 文档解析出的文本，仅当前轮使用。 */
  text?: string
  /** 图片 data URL，仅当前轮使用。 */
  dataUrl?: string
}

/** AI 模型配置状态，不包含 API Key。 */
export interface AiConfigStatus {
  configured: boolean
  message: string | null
}

/** 渲染进程粘贴文件时传给主进程的原始数据。 */
export interface AiAttachmentFilePayload {
  name: string
  mimeType: string
  data: ArrayBuffer
}

/** 聊天消息。 */
export interface AiChatMessage {
  role: 'user' | 'assistant'
  content: string
  attachments?: AiChatAttachment[]
}

/** 启动一次流式聊天。 */
export interface AiChatStartInput {
  messages: AiChatMessage[]
}

/** 启动结果。 */
export interface AiChatStartResult {
  requestId: string
}

/** Token 用量。 */
export interface AiChatUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  reasoningTokens?: number
  cachedInputTokens?: number
}

/** 工具调用卡片状态。 */
export interface AiToolCall {
  id: string
  name: string
  label: string
  state: 'call' | 'result' | 'error'
  output?: string
}

/** 引用来源。 */
export interface AiChatSource {
  id: string
  title: string
  url?: string
}

/** AI 内部产物统计。 */
export interface AiArtifactStats {
  count: number
  bytes: number
}

/** AI 生成的本地文件或图片产物。 */
export interface AiChatArtifact {
  /** 应用内产物 ID，用于后续下载。 */
  id: string
  kind: 'file' | 'image'
  name: string
  size?: number
  url?: string
  mimeType?: string
}

/** 主进程发送给渲染进程的聊天事件。 */
export type AiChatEvent =
  | {
      type: 'start'
      requestId: string
    }
  | {
      type: 'delta'
      requestId: string
      delta: string
    }
  | {
      type: 'reasoning'
      requestId: string
      delta: string
    }
  | {
      type: 'tool'
      requestId: string
      tool: AiToolCall
    }
  | {
      type: 'source'
      requestId: string
      source: AiChatSource
    }
  | {
      type: 'artifact'
      requestId: string
      artifact: AiChatArtifact
    }
  | {
      type: 'usage'
      requestId: string
      usage: AiChatUsage
    }
  | {
      type: 'done'
      requestId: string
      finishReason: string | null
    }
  | {
      type: 'aborted'
      requestId: string
    }
  | {
      type: 'error'
      requestId: string
      message: string
    }
