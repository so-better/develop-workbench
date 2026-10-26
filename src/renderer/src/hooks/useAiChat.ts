import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AiChatAttachment,
  AiChatArtifact,
  AiChatEvent,
  AiChatMessage,
  AiChatSource,
  AiToolCall
} from '../../../types/ai'
import { getErrorMessage } from '../../../utils'

/** 弹窗内部使用的消息结构，不持久化、不绑定会话。 */
export interface AiUiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  attachments?: AiChatAttachment[]
  tools?: AiToolCall[]
  sources?: AiChatSource[]
  artifacts?: AiChatArtifact[]
  /** 用户停止或请求中断：保留已生成正文，但不尝试渲染不完整的图表。 */
  interrupted?: boolean
  /** 自动发送的业务首条消息：参与上下文，但不显示在对话中。 */
  hidden?: boolean
  createdAt: string
}

interface StreamState {
  requestId: string
  assistantId: string
  content: string
  reasoning: string
  /** 普通发送停止且无输出时，是否连同用户提问一起回退删除。 */
  rollbackUserOnEmptyStop: boolean
}

export interface UseAiChatResult {
  messages: AiUiMessage[]
  streaming: boolean
  stopping: boolean
  error: string | null
  send: (
    content: string,
    attachments?: AiChatAttachment[],
    options?: { hidden?: boolean }
  ) => Promise<void>
  stop: () => Promise<void>
  reset: () => void
  regenerate: () => Promise<void>
  retry: () => Promise<void>
  editAndResend: (messageId: string, content: string) => Promise<void>
}

const createId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const nowIso = (): string => new Date().toISOString()

/** 历史轮只传附件元信息，最后一条用户消息才携带图片和文档正文。 */
const toChatMessages = (messages: AiUiMessage[]): AiChatMessage[] => {
  let lastUserIndex = -1

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      lastUserIndex = index
      break
    }
  }

  return messages
    .map((message, messageIndex) => ({
      role: message.role,
      content: message.content,
      ...(message.attachments?.length
        ? {
            attachments: message.attachments.map((attachment) =>
              messageIndex === lastUserIndex
                ? attachment
                : {
                    id: attachment.id,
                    name: attachment.name,
                    mimeType: attachment.mimeType,
                    kind: attachment.kind,
                    size: attachment.size
                  }
            )
          }
        : {})
    }))
    .filter((message) => message.role === 'user' || message.content.trim())
}

/**
 * 通用 AI 对话状态。
 * 业务只负责传入用户消息，不需要处理流式协议、中止、重试和 reasoning 拼接。
 */
export const useAiChat = (): UseAiChatResult => {
  const [messages, setMessages] = useState<AiUiMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const messagesRef = useRef<AiUiMessage[]>([])
  const streamingRef = useRef(false)
  const streamRef = useRef<StreamState | null>(null)
  const pendingRef = useRef({ content: '', reasoning: '' })
  const rafRef = useRef<number | null>(null)
  const requestVersionRef = useRef(0)
  /** 请求启动 IPC 返回前到达的事件，先暂存，拿到 requestId 后回放。 */
  const pendingEventsRef = useRef<AiChatEvent[]>([])

  const updateMessages = useCallback((next: AiUiMessage[]): void => {
    messagesRef.current = next
    setMessages(next)
  }, [])

  const setStreamingState = useCallback((next: boolean): void => {
    streamingRef.current = next
    setStreaming(next)
  }, [])

  const flushStreamBuffer = useCallback((): void => {
    const stream = streamRef.current
    const pending = pendingRef.current

    if (!stream || (!pending.content && !pending.reasoning)) return

    pendingRef.current = { content: '', reasoning: '' }
    stream.content += pending.content
    stream.reasoning += pending.reasoning

    updateMessages(
      messagesRef.current.map((message) =>
        message.id === stream.assistantId
          ? {
              ...message,
              content: message.content + pending.content,
              ...(message.reasoning || pending.reasoning
                ? {
                    reasoning: (message.reasoning ?? '') + pending.reasoning
                  }
                : {})
            }
          : message
      )
    )
  }, [updateMessages])

  const scheduleFlush = useCallback((): void => {
    if (rafRef.current !== null) return

    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null
      flushStreamBuffer()
    })
  }, [flushStreamBuffer])

  const updateAssistant = useCallback(
    (updater: (message: AiUiMessage) => AiUiMessage): void => {
      const stream = streamRef.current

      if (!stream) return

      updateMessages(
        messagesRef.current.map((message) =>
          message.id === stream.assistantId ? updater(message) : message
        )
      )
    },
    [updateMessages]
  )

  /** 停止且无任何输出时，移除空的 AI 消息；普通发送同时移除本轮用户提问。 */
  const removeEmptyStoppedTurn = useCallback(
    (stream: StreamState, rollbackUser: boolean): void => {
      const current = messagesRef.current
      const assistantIndex = current.findIndex(
        (message) => message.id === stream.assistantId
      )

      if (assistantIndex < 0) return

      const removeIndexes = new Set<number>([assistantIndex])

      if (rollbackUser) {
        for (let index = assistantIndex - 1; index >= 0; index -= 1) {
          if (current[index].role === 'user') {
            removeIndexes.add(index)
            break
          }
        }
      }

      updateMessages(
        current.filter((_message, index) => !removeIndexes.has(index))
      )
    },
    [updateMessages]
  )

  const finishStream = useCallback(
    (errorText?: string, aborted = false): void => {
      const stream = streamRef.current

      if (!stream) {
        setStreamingState(false)
        setStopping(false)
        return
      }

      // 只有正文才算有效回复；思考过程和工具调用不能阻止停止时回退整轮。
      const hasBodyContent = Boolean(
        stream.content.trim() || pendingRef.current.content.trim()
      )

      if (aborted && !hasBodyContent) {
        if (rafRef.current !== null) {
          window.cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }

        pendingRef.current = { content: '', reasoning: '' }
        streamRef.current = null
        setStreamingState(false)
        setStopping(false)
        removeEmptyStoppedTurn(stream, stream.rollbackUserOnEmptyStop)
        return
      }

      if (errorText) {
        pendingRef.current.content = hasBodyContent
          ? `${pendingRef.current.content}\n\n> 请求中断：${errorText}`
          : `请求失败：${errorText}`
      }

      if (errorText || aborted) {
        updateAssistant((message) => ({
          ...message,
          interrupted: true,
          tools: message.tools?.map((tool) =>
            tool.state === 'call'
              ? { ...tool, state: 'error', output: errorText || '请求已中止' }
              : tool
          )
        }))
      }

      flushStreamBuffer()

      const finalMessage = messagesRef.current.find(
        (message) => message.id === stream.assistantId
      )
      const hasFinalContent = Boolean(finalMessage?.content.trim())
      const hasArtifacts = Boolean(finalMessage?.artifacts?.length)

      // 正常结束但只有思考/工具、没有正文和产物时，不保留空的 AI 气泡。
      if (!aborted && !errorText && !hasFinalContent && !hasArtifacts) {
        removeEmptyStoppedTurn(stream, false)
      }

      setStreamingState(false)
      setStopping(false)
      streamRef.current = null
    },
    [
      flushStreamBuffer,
      removeEmptyStoppedTurn,
      setStreamingState,
      updateAssistant
    ]
  )

  /** 处理已确认属于当前 stream 的事件。 */
  const handleStreamEvent = useCallback(
    (event: AiChatEvent): void => {
      if (event.type === 'delta') {
        pendingRef.current.content += event.delta
        scheduleFlush()
      } else if (event.type === 'reasoning') {
        pendingRef.current.reasoning += event.delta
        scheduleFlush()
      } else if (event.type === 'tool') {
        updateAssistant((message) => {
          const tools = [...(message.tools ?? [])]
          const index = tools.findIndex((tool) => tool.id === event.tool.id)

          if (index === -1) tools.push(event.tool)
          else tools[index] = event.tool

          return { ...message, tools }
        })
      } else if (event.type === 'source') {
        updateAssistant((message) => {
          const sources = [...(message.sources ?? [])]

          if (!sources.some((source) => source.id === event.source.id)) {
            sources.push(event.source)
          }

          return { ...message, sources }
        })
      } else if (event.type === 'artifact') {
        updateAssistant((message) => {
          const artifacts = [...(message.artifacts ?? [])]

          if (!artifacts.some((artifact) => artifact.id === event.artifact.id)) {
            artifacts.push(event.artifact)
          }

          return { ...message, artifacts }
        })
      } else if (event.type === 'done') {
        finishStream()
      } else if (event.type === 'aborted') {
        finishStream(undefined, true)
      } else if (event.type === 'error') {
        finishStream(event.message)
      }
    },
    [finishStream, scheduleFlush, updateAssistant]
  )

  useEffect(() => {
    const unsubscribe = window.electron.onAiChatEvent((event: AiChatEvent) => {
      const stream = streamRef.current

      if (!stream) {
        pendingEventsRef.current.push(event)
        return
      }

      if (event.requestId !== stream.requestId) return

      handleStreamEvent(event)
    })

    return unsubscribe
  }, [handleStreamEvent])

  useEffect(() => {
    return () => {
      requestVersionRef.current += 1
      pendingEventsRef.current = []
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
      }
      if (streamRef.current?.requestId) {
        window.electron.abortAiChat(streamRef.current.requestId)
      }
    }
  }, [])

  const runConversation = useCallback(
    async (
      conversation: AiUiMessage[],
      rollbackUserOnEmptyStop = false
    ): Promise<void> => {
      if (streamingRef.current) return

      const assistant = conversation[conversation.length - 1]

      if (!assistant || assistant.role !== 'assistant') return

      const history = conversation.slice(0, -1)
      const requestVersion = ++requestVersionRef.current

      setError(null)
      setStreamingState(true)
      setStopping(false)
      updateMessages(conversation)
      pendingEventsRef.current = []

      try {
        const result = await window.electron.startAiChat({
          messages: toChatMessages(history)
        })

        // 请求启动期间弹窗可能已关闭或开始新一轮请求。
        if (requestVersion !== requestVersionRef.current) {
          pendingEventsRef.current = []
          window.electron.abortAiChat(result.requestId)
          return
        }

        const bufferedEvents = pendingEventsRef.current.filter(
          (event) => event.requestId === result.requestId
        )
        pendingEventsRef.current = []

        streamRef.current = {
          requestId: result.requestId,
          assistantId: assistant.id,
          content: '',
          reasoning: '',
          rollbackUserOnEmptyStop
        }

        // 回放 IPC 返回前已经到达的事件，避免首个 delta/done 丢失。
        for (const event of bufferedEvents) {
          handleStreamEvent(event)
        }
      } catch (sendError) {
        if (requestVersion !== requestVersionRef.current) return

        pendingEventsRef.current = []
        updateMessages(
          messagesRef.current.filter((message) => message.id !== assistant.id)
        )
        setStreamingState(false)
        setError(getErrorMessage(sendError, '发送消息失败'))
      }
    },
    [handleStreamEvent, setStreamingState, updateMessages]
  )

  const send = useCallback(
    async (
      rawContent: string,
      attachments: AiChatAttachment[] = [],
      options?: { hidden?: boolean }
    ): Promise<void> => {
      const content = rawContent.trim()

      if ((!content && attachments.length === 0) || streamingRef.current) return

      const userMessage: AiUiMessage = {
        id: createId(),
        role: 'user',
        content,
        ...(attachments.length ? { attachments } : {}),
        ...(options?.hidden ? { hidden: true } : {}),
        createdAt: nowIso()
      }
      const assistantMessage: AiUiMessage = {
        id: createId(),
        role: 'assistant',
        content: '',
        createdAt: nowIso()
      }

      await runConversation(
        [
          ...messagesRef.current,
          userMessage,
          assistantMessage
        ],
        true
      )
    },
    [runConversation]
  )

  const regenerate = useCallback(async (): Promise<void> => {
    if (streamingRef.current) return

    const current = messagesRef.current
    let assistantIndex = -1

    for (let index = current.length - 1; index >= 0; index -= 1) {
      if (current[index].role === 'assistant') {
        assistantIndex = index
        break
      }
    }

    const history =
      assistantIndex >= 0 ? current.slice(0, assistantIndex) : current

    if (!history.some((message) => message.role === 'user')) return

    const assistant: AiUiMessage = {
      id: createId(),
      role: 'assistant',
      content: '',
      createdAt: nowIso()
    }

    await runConversation([...history, assistant])
  }, [runConversation])

  const retry = useCallback(async (): Promise<void> => {
    await regenerate()
  }, [regenerate])

  const editAndResend = useCallback(
    async (messageId: string, content: string): Promise<void> => {
      const trimmed = content.trim()

      if (!trimmed || streamingRef.current) return

      const current = messagesRef.current
      const index = current.findIndex(
        (message) => message.id === messageId && message.role === 'user'
      )

      if (index < 0) return

      const userMessage: AiUiMessage = {
        ...current[index],
        content: trimmed
      }
      const assistant: AiUiMessage = {
        id: createId(),
        role: 'assistant',
        content: '',
        createdAt: nowIso()
      }

      await runConversation([
        ...current.slice(0, index),
        userMessage,
        assistant
      ])
    },
    [runConversation]
  )

  const stop = useCallback(async (): Promise<void> => {
    const requestId = streamRef.current?.requestId

    if (!requestId || stopping) return

    setStopping(true)

    try {
      await window.electron.abortAiChat(requestId)
    } catch (stopError) {
      setStopping(false)
      setError(getErrorMessage(stopError, '停止生成失败'))
    }
  }, [stopping])

  const reset = useCallback((): void => {
    requestVersionRef.current += 1
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (streamRef.current?.requestId) {
      window.electron.abortAiChat(streamRef.current.requestId)
    }

    pendingRef.current = { content: '', reasoning: '' }
    pendingEventsRef.current = []
    streamRef.current = null
    setStreamingState(false)
    setStopping(false)
    setError(null)
    updateMessages([])
  }, [setStreamingState, updateMessages])

  return {
    messages,
    streaming,
    stopping,
    error,
    send,
    stop,
    reset,
    regenerate,
    retry,
    editAndResend
  }
}
