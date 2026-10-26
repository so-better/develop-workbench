import { useEffect, useRef, useState } from 'react'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloseOutlined,
  CopyOutlined,
  EditOutlined,
  FileTextOutlined,
  DownloadOutlined,
  DownOutlined,
  ImportOutlined,
  LoadingOutlined,
  PaperClipOutlined,
  ReloadOutlined,
  SendOutlined,
  SettingOutlined,
  StopOutlined
} from '@ant-design/icons'
import { Alert, App, Button, Image, Input, Modal, Spin, Tooltip } from 'antd'
import type {
  AiChatArtifact,
  AiChatAttachment,
  AiChatSource,
  AiConfigStatus,
  AiToolCall
} from '../../../../types/ai'
import { useAiChat } from '../../hooks/useAiChat'
import { getErrorMessage } from '../../../../utils'
import MarkdownContent from '../MarkdownContent/MarkdownContent'
import RobotMark from '../RobotMark/RobotMark'
import { useSettingsDialog } from '../SettingsModal/SettingsDialogProvider'

interface AiChatDialogProps {
  open: boolean
  title: string
  /** 打开后自动发送的首条用户消息；发送但不显示在对话中。 */
  initialPrompt: string
  /** 是否自动发送 initialPrompt，默认开启。 */
  autoStart?: boolean
  /** 只影响展示；onApplyResult 仍接收原始内容。 */
  formatContent?: (content: string) => string
  onClose: () => void
  /** 业务页面接收 AI 结果，用于回写编辑器、表单或草稿。 */
  onApplyResult?: (
    content: string,
    tools: AiToolCall[]
  ) => void | Promise<void>
  /** 应用按钮文案，默认“应用到页面”。 */
  applyLabel?: string
}

const MAX_ATTACHMENTS = 6

/** 把附件和产物大小格式化为便于阅读的文本。 */
const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`

/** 附件预览：待发送附件可删除，历史消息中的附件只展示。 */
function AttachmentsPreview({
  attachments,
  onRemove,
  variant = 'pending'
}: {
  attachments: AiChatAttachment[]
  onRemove?: (id: string) => void
  variant?: 'pending' | 'message'
}): JSX.Element {
  const isPending = variant === 'pending'

  return (
    <div
      className={`ai-attachment-list${isPending ? '' : ' is-message'}`}
    >
      {attachments.map((attachment) =>
        attachment.kind === 'image' && attachment.dataUrl ? (
          <div className="ai-attachment-thumbnail" key={attachment.id}>
            <Image
              src={attachment.dataUrl}
              alt={attachment.name}
              width={isPending ? 56 : undefined}
              height={isPending ? 56 : undefined}
              className={isPending ? 'ai-attachment-thumb' : 'ai-attachment-message-image'}
            />
            {onRemove ? (
              <button
                type="button"
                className="ai-attachment-remove"
                aria-label={`移除附件 ${attachment.name}`}
                onClick={() => onRemove(attachment.id)}
              >
                <CloseOutlined />
              </button>
            ) : null}
          </div>
        ) : (
          <div className="ai-attachment-file-chip" key={attachment.id}>
            <FileTextOutlined />
            <span className="ai-attachment-file-name" title={attachment.name}>
              {attachment.name}
            </span>
            {onRemove ? (
              <button
                type="button"
                className="ai-attachment-remove"
                aria-label={`移除附件 ${attachment.name}`}
                onClick={() => onRemove(attachment.id)}
              >
                <CloseOutlined />
              </button>
            ) : null}
          </div>
        )
      )}
    </div>
  )
}

/** 工具输出面板：默认收起，展开后可复制。 */
function ToolOutput({ text }: { text: string }): JSX.Element {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (): Promise<void> => {
    try {
      await window.electron.copyText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 复制失败时保留手动选择能力，不额外打断对话。
    }
  }

  return (
    <div className="ai-tool-output-wrap">
      <pre className="ai-tool-output-pre">{text}</pre>
      <button
        type="button"
        className="ai-tool-output-copy"
        onClick={handleCopy}
      >
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  )
}

/**
 * 工具调用列表。
 * 普通工具和 MCP 工具使用完全相同的紧凑行，只有点击后才展开原始输出。
 */
function ToolCards({ tools }: { tools: AiToolCall[] }): JSX.Element {
  const [openOutputs, setOpenOutputs] = useState<Record<string, boolean>>({})

  const isOpen = (tool: AiToolCall): boolean =>
    openOutputs[tool.id] ?? (tool.state === 'call' && Boolean(tool.output))

  const toggle = (tool: AiToolCall): void => {
    if (!tool.output) return

    setOpenOutputs((current) => ({
      ...current,
      [tool.id]: !isOpen(tool)
    }))
  }

  return (
    <div className="ai-tool-list">
      {tools.map((tool) => {
        const open = isOpen(tool)
        const stateText =
          tool.state === 'call'
            ? '运行中'
            : tool.state === 'result'
              ? '完成'
              : '失败'

        return (
          <div className="ai-tool-wrap" key={tool.id}>
            <button
              type="button"
              className={`ai-tool-row is-${tool.state}${
                tool.output ? ' is-toggleable' : ''
              }`}
              disabled={!tool.output}
              onClick={() => toggle(tool)}
            >
              <span className="ai-tool-row-icon">
                {tool.state === 'call' ? (
                  <LoadingOutlined spin />
                ) : tool.state === 'result' ? (
                  <CheckCircleOutlined />
                ) : (
                  <CloseCircleOutlined />
                )}
              </span>
              <span className="ai-tool-name">{tool.label || tool.name}</span>
              {tool.output ? (
                <DownOutlined
                  className={`ai-tool-caret${open ? ' is-open' : ''}`}
                />
              ) : null}
              <span className="ai-tool-state">{stateText}</span>
            </button>
            {tool.output && open ? <ToolOutput text={tool.output} /> : null}
          </div>
        )
      })}
    </div>
  )
}

/** 参考来源：编号单行展示，点击交给应用内浏览器打开。 */
function SourcesList({ sources }: { sources: AiChatSource[] }): JSX.Element {
  return (
    <div className="ai-sources">
      <div className="ai-sources-head">
        <span className="ai-sources-title">参考来源</span>
        <span className="ai-sources-count">{sources.length}</span>
      </div>
      <div className="ai-source-list">
        {sources.map((source, index) => (
          <button
            type="button"
            className={`ai-source-item${source.url ? '' : ' is-plain'}`}
            key={source.id}
            disabled={!source.url}
            title={source.title}
            onClick={() => {
              if (source.url) window.electron.openEmbeddedBrowser(source.url)
            }}
          >
            <span className="ai-source-index">{index + 1}</span>
            <span className="ai-source-title">{source.title}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** 文件产物按钮：点击后走统一下载管理保存到本机。 */
function ArtifactsList({
  artifacts,
  onDownload
}: {
  artifacts: AiChatArtifact[]
  onDownload: (artifactId: string) => Promise<void>
}): JSX.Element {
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  return (
    <div className="ai-artifacts">
      {artifacts.map((artifact) => (
        <Button
          className="ai-artifact-download"
          icon={<DownloadOutlined />}
          loading={downloadingId === artifact.id}
          title={`${artifact.name}${artifact.size ? ` · ${formatBytes(artifact.size)}` : ''}`}
          key={artifact.id}
          onClick={async () => {
            setDownloadingId(artifact.id)

            try {
              await onDownload(artifact.id)
            } finally {
              setDownloadingId(null)
            }
          }}
        >
          <span className="ai-artifact-download-name">
            下载 {artifact.name}
          </span>
        </Button>
      ))}
    </div>
  )
}

/**
 * 通用 AI 对话弹窗。
 * 不保存会话、不选择模型，关闭后清除全部消息。
 */
export default function AiChatDialog({
  open,
  title,
  initialPrompt,
  autoStart = true,
  formatContent,
  onClose,
  onApplyResult,
  applyLabel = '应用到页面'
}: AiChatDialogProps): JSX.Element {
  const { message: antdMessage } = App.useApp()
  const { openSettings } = useSettingsDialog()
  const {
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
  } = useAiChat()
  const [input, setInput] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<AiChatAttachment[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [configStatus, setConfigStatus] = useState<AiConfigStatus | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)
  const stickToBottomRef = useRef(true)

  const scrollToBottom = (): void => {
    window.requestAnimationFrame(() => {
      const element = listRef.current

      if (element) element.scrollTop = element.scrollHeight
    })
  }

  const focusComposer = (): void => {
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('.ai-chat-dialog textarea')?.focus()
    }, 60)
  }

  useEffect(() => {
    if (!open) {
      setConfigStatus(null)
      return
    }

    let active = true

    setConfigStatus(null)
    window.electron
      .getAiConfigStatus()
      .then((status) => {
        if (active) setConfigStatus(status)
      })
      .catch(() => {
        if (active) {
          setConfigStatus({
            configured: false,
            message: '读取 AI 配置失败'
          })
        }
      })

    return () => {
      active = false
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      startedRef.current = false
      setInput('')
      setPendingAttachments([])
      setEditingId(null)
      reset()
      return
    }

    stickToBottomRef.current = true
    if (
      !configStatus?.configured ||
      !autoStart ||
      startedRef.current ||
      !initialPrompt.trim()
    ) {
      return
    }

    startedRef.current = true
    send(initialPrompt, [], { hidden: true })
  }, [autoStart, configStatus?.configured, initialPrompt, open, reset, send])

  useEffect(() => {
    if (!open) return

    if (stickToBottomRef.current) scrollToBottom()
    if (!streaming) focusComposer()
  }, [messages, open, streaming])

  const handleClose = (): void => {
    reset()
    onClose()
  }

  const handleOpenSettings = (): void => {
    reset()
    onClose()
    openSettings('ai')
  }

  const handlePickAttachments = async (): Promise<void> => {
    try {
      const picked = await window.electron.pickAiAttachments()

      if (!picked.length) return

      setPendingAttachments((current) =>
        [...current, ...picked].slice(0, MAX_ATTACHMENTS)
      )
    } catch (pickError) {
      antdMessage.error(getErrorMessage(pickError, '选择附件失败'))
    }
  }

  const parseFileAttachments = async (
    files: File[]
  ): Promise<AiChatAttachment[]> => {
    const payloads = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        mimeType: file.type,
        data: await file.arrayBuffer()
      }))
    )

    return window.electron.parseAiAttachmentFiles(payloads)
  }

  const handlePaste = async (
    event: React.ClipboardEvent<HTMLTextAreaElement>
  ): Promise<void> => {
    const itemFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
    const sourceFiles = itemFiles.length
      ? itemFiles
      : Array.from(event.clipboardData.files)

    if (!sourceFiles.length) return

    event.preventDefault()

    try {
      const attachments = await parseFileAttachments(sourceFiles)

      setPendingAttachments((current) =>
        [...current, ...attachments].slice(0, MAX_ATTACHMENTS)
      )
    } catch (pasteError) {
      antdMessage.error(getErrorMessage(pasteError, '粘贴附件失败'))
    }
  }

  const configReady = configStatus?.configured === true

  const handleSend = (): void => {
    const content = input.trim()

    if (!configReady) return
    if ((!content && pendingAttachments.length === 0) || streaming) return

    setInput('')
    setPendingAttachments([])
    stickToBottomRef.current = true
    send(content, pendingAttachments)
  }

  const handleStartEdit = (messageId: string, content: string): void => {
    if (streaming) return

    setEditingId(messageId)
    setEditingContent(content)
  }

  const handleSaveEdit = (): void => {
    const content = editingContent.trim()

    if (!editingId || !content) return

    const messageId = editingId

    setEditingId(null)
    setEditingContent('')
    editAndResend(messageId, content)
  }

  const handleScroll = (): void => {
    const element = listRef.current

    if (!element) return

    stickToBottomRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 80
  }

  const handleApply = async (
    content: string,
    tools: AiToolCall[]
  ): Promise<void> => {
    if (!onApplyResult || !content.trim()) return

    try {
      await onApplyResult(content, tools)
      antdMessage.success(`已${applyLabel}`)
    } catch (applyError) {
      antdMessage.error(getErrorMessage(applyError, '应用结果失败'))
    }
  }

  const handleCopy = async (content: string): Promise<void> => {
    try {
      await window.electron.copyText(content)
      antdMessage.success('已复制')
    } catch {
      antdMessage.error('复制失败')
    }
  }

  const handleDownloadArtifact = async (artifactId: string): Promise<void> => {
    try {
      const result = await window.electron.downloadAiArtifact(artifactId)

      if (result) {
        antdMessage.success('已保存并加入下载管理')
      }
    } catch (downloadError) {
      antdMessage.error(getErrorMessage(downloadError, '下载产物失败'))
    }
  }

  const visibleMessages = messages.filter((message) => !message.hidden)
  const preparing =
    open &&
    configStatus?.configured === true &&
    autoStart &&
    visibleMessages.length === 0 &&
    Boolean(initialPrompt.trim())
  return (
    <Modal
      title={
        <span className="ai-chat-dialog-title">
          <RobotMark />
          {title}
        </span>
      }
      open={open}
      width={900}
      centered
      footer={null}
      className="ai-chat-dialog-modal"
      styles={{ body: { padding: 0 } }}
      onCancel={handleClose}
    >
      <div className="ai-chat-dialog">
        <div
          ref={listRef}
          className="ai-chat-dialog-messages"
          onScroll={handleScroll}
        >
          {error ? (
            <Alert
              type="error"
              showIcon
              message={error}
              action={
                <div className="ai-chat-dialog-error-actions">
                  {error ? (
                    <Button size="small" icon={<ReloadOutlined />} onClick={retry}>
                      重试
                    </Button>
                  ) : null}
                  <Button size="small" onClick={handleOpenSettings}>
                    去配置
                  </Button>
                </div>
              }
            />
          ) : null}

          {visibleMessages.length === 0 ? (
            configStatus && !configReady ? (
              <div className="ai-chat-dialog-empty ai-chat-dialog-empty--config">
                <div className="ai-chat-dialog-empty-icon">
                  <RobotMark />
                </div>
                <span className="ai-chat-dialog-empty-kicker">
                  AI 助手尚未就绪
                </span>
                <h3>配置模型后开始对话</h3>
                <div className="ai-chat-dialog-config-actions">
                  <p>
                    {configStatus.message === '尚未配置 AI 模型'
                      ? '需要先配置一个可用的 AI 模型，之后才能开始对话。'
                      : (configStatus.message ??
                        '请先完成模型配置后再开始对话。')}
                  </p>
                  <Button
                    type="primary"
                    size="small"
                    icon={<SettingOutlined />}
                    onClick={handleOpenSettings}
                  >
                    打开模型配置
                  </Button>
                </div>
                <span className="ai-chat-dialog-config-hint">
                  支持 OpenAI Chat Completions 兼容接口
                </span>
              </div>
            ) : (
              <div className="ai-chat-dialog-empty">
                {configStatus === null || preparing ? (
                  <Spin />
                ) : (
                  <div className="ai-chat-dialog-empty-icon">
                    <RobotMark />
                  </div>
                )}
                <h3>
                  {configStatus === null
                    ? '正在检查模型配置'
                    : preparing
                      ? '正在准备分析'
                      : '有什么可以帮你？'}
                </h3>
                <p>
                  {configStatus === null
                    ? '请稍候...'
                    : preparing
                      ? '正在发送当前页面内容...'
                      : '输入问题，开始和 AI 对话。'}
                </p>
              </div>
            )
          ) : (
            visibleMessages.map((message, index) => {
              const isLastAssistant =
                message.role === 'assistant' &&
                index === visibleMessages.length - 1
              const isGenerating = streaming && isLastAssistant
              const renderStreaming = isGenerating || Boolean(message.interrupted)
              const isEditing = editingId === message.id
              const hasContent = Boolean(message.content.trim())
              const displayContent =
                message.role === 'assistant' && formatContent && !isGenerating
                  ? formatContent(message.content)
                  : message.content
              const hasVisibleContent = Boolean(displayContent.trim())

              return (
                <div
                  className={`ai-message ai-message-${message.role}`}
                  key={message.id}
                >
                  {message.role === 'assistant' ? (
                    <>
                      <div className="ai-message-bubble ai-message-bubble-assistant">
                        {message.reasoning ? (
                          <details className="ai-reasoning">
                            <summary>
                              {isGenerating && !message.content
                                ? '思考中...'
                                : '思考过程'}
                            </summary>
                            <MarkdownContent
                              content={message.reasoning}
                              streaming={renderStreaming}
                            />
                          </details>
                        ) : null}
                        {hasVisibleContent ? (
                          <MarkdownContent
                            content={displayContent}
                            streaming={renderStreaming}
                          />
                        ) : isGenerating ? (
                          <div className="ai-message-loading">
                            <Spin size="small" />
                          </div>
                        ) : null}
                        {message.tools?.length ? (
                          <ToolCards tools={message.tools} />
                        ) : null}
                        {message.artifacts?.length ? (
                          <ArtifactsList
                            artifacts={message.artifacts}
                            onDownload={handleDownloadArtifact}
                          />
                        ) : null}
                        {message.sources?.length ? (
                          <SourcesList sources={message.sources} />
                        ) : null}
                      </div>
                      {!isGenerating &&
                      (hasContent ||
                        message.reasoning ||
                        message.tools?.length ||
                        message.sources?.length ||
                        message.artifacts?.length) ? (
                        <div className="ai-message-actions">
                          {hasContent ? (
                            <Button
                              type="text"
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => handleCopy(displayContent)}
                            >
                              复制
                            </Button>
                          ) : null}
                          {hasContent &&
                          !message.interrupted &&
                          isLastAssistant &&
                          onApplyResult ? (
                            <Button
                              type="text"
                              size="small"
                              icon={<ImportOutlined />}
                              onClick={() => handleApply(message.content, message.tools ?? [])}
                            >
                              {applyLabel}
                            </Button>
                          ) : null}
                          {isLastAssistant ? (
                            <Button
                              type="text"
                              size="small"
                              icon={<ReloadOutlined />}
                              disabled={streaming}
                              onClick={regenerate}
                            >
                              重新生成
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ) : isEditing ? (
                    <div className="ai-message-edit">
                      <Input.TextArea
                        value={editingContent}
                        onChange={(event) => setEditingContent(event.target.value)}
                        autoSize={{ minRows: 2, maxRows: 6 }}
                        onKeyDown={(event) => {
                          if (
                            event.key === 'Enter' &&
                            !event.shiftKey &&
                            !event.nativeEvent.isComposing
                          ) {
                            event.preventDefault()
                            handleSaveEdit()
                          }
                        }}
                      />
                      <div className="ai-message-edit-actions">
                        <Button
                          size="small"
                          onClick={() => {
                            setEditingId(null)
                            setEditingContent('')
                          }}
                        >
                          取消
                        </Button>
                        <Button
                          size="small"
                          type="primary"
                          disabled={!editingContent.trim()}
                          onClick={handleSaveEdit}
                        >
                          保存并重发
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="ai-message-bubble ai-message-bubble-user">
                        {message.attachments?.length ? (
                          <AttachmentsPreview
                            attachments={message.attachments}
                            variant="message"
                          />
                        ) : null}
                        <div className="ai-message-user-text">
                          {message.content}
                        </div>
                      </div>
                      {!streaming ? (
                        <div className="ai-message-actions">
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() =>
                              handleStartEdit(message.id, message.content)
                            }
                          >
                            编辑
                          </Button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              )
            })
          )}
        </div>

        <div className="ai-chat-dialog-composer">
          <div className="ai-composer-shell">
            {pendingAttachments.length ? (
              <AttachmentsPreview
                attachments={pendingAttachments}
                onRemove={(id) =>
                  setPendingAttachments((current) =>
                    current.filter((attachment) => attachment.id !== id)
                  )
                }
              />
            ) : null}
            <Input.TextArea
              className="ai-composer-input"
              variant="borderless"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={
                configStatus === null
                  ? '正在检查模型配置...'
                  : !configReady
                    ? '请先配置可用模型'
                    : '继续追问...'
              }
              autoSize={{ minRows: 1, maxRows: 5 }}
              disabled={streaming || !configReady}
              onPaste={handlePaste}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault()
                  handleSend()
                }
              }}
            />
            <div className="ai-chat-dialog-footer">
              <span className="ai-composer-hint">
                Enter 发送 · Shift + Enter 换行
              </span>
              <div className="ai-chat-dialog-footer-actions">
                <Tooltip title="上传或粘贴附件：图片、PDF、Word、Excel、PPT">
                  <span>
                    <Button
                      type="text"
                      className="ai-composer-attach"
                      icon={<PaperClipOutlined />}
                      aria-label="添加附件"
                      disabled={
                        streaming ||
                        !configReady ||
                        pendingAttachments.length >= MAX_ATTACHMENTS
                      }
                      onClick={handlePickAttachments}
                    />
                  </span>
                </Tooltip>
                {streaming ? (
                  <Button
                    type="primary"
                    danger
                    className="ai-composer-send"
                    icon={<StopOutlined />}
                    loading={stopping}
                    onClick={stop}
                  >
                    停止
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    className="ai-composer-send"
                    icon={<SendOutlined />}
                    disabled={
                      !configReady ||
                      (!input.trim() && pendingAttachments.length === 0)
                    }
                    onClick={handleSend}
                  >
                    发送
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
