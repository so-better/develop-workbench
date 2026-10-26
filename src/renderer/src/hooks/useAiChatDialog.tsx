import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ReactNode } from 'react'
import AiChatDialog from '../components/AiChatDialog/AiChatDialog'

/** 单次 AI 业务调用的参数。 */
export interface AiChatDialogRequest {
  /** 弹窗标题，例如“周报检查”。 */
  title: string
  /** 自动发送给 AI 的用户消息；发送但不显示在对话中。 */
  prompt: string
  /** 是否自动发送，默认 true。 */
  autoStart?: boolean
  /** 只影响展示；onApplyResult 仍接收原始内容。 */
  formatContent?: (content: string) => string
  /** 结果回写按钮文案，默认“应用到页面”。 */
  applyLabel?: string
  /** 当前业务的结果回写处理。 */
  onApplyResult?: (
    content: string,
    tools: import('../../../types/ai').AiToolCall[]
  ) => void | Promise<void>
  /** 当前业务关闭弹窗后的回调。 */
  onClose?: () => void
}

interface ActiveRequest extends AiChatDialogRequest {
  id: number
}

interface AiChatDialogContextValue {
  openAiDialog: (request: AiChatDialogRequest) => void
  closeAiDialog: () => void
  isOpen: boolean
}

const AiChatDialogContext = createContext<AiChatDialogContextValue | null>(null)

/**
 * 全局 AI 弹窗容器。
 * 业务页面只通过 useAiChatDialog 调用，不需要自己渲染弹窗。
 */
export function AiChatDialogProvider({
  children
}: {
  children: ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState<ActiveRequest | null>(null)
  const requestRef = useRef<ActiveRequest | null>(null)
  const requestIdRef = useRef(0)

  const openAiDialog = useCallback((next: AiChatDialogRequest): void => {
    requestIdRef.current += 1
    const active = { ...next, id: requestIdRef.current }

    requestRef.current = active
    setRequest(active)
    setOpen(true)
  }, [])

  const closeAiDialog = useCallback((): void => {
    setOpen(false)
    requestRef.current?.onClose?.()
  }, [])

  const contextValue = useMemo(
    () => ({
      openAiDialog,
      closeAiDialog,
      isOpen: open
    }),
    [closeAiDialog, open, openAiDialog]
  )

  return (
    <AiChatDialogContext.Provider value={contextValue}>
      {children}
      <AiChatDialog
        key={request?.id ?? 0}
        open={open}
        title={request?.title ?? 'AI 助手'}
        initialPrompt={request?.prompt ?? ''}
        autoStart={request?.autoStart ?? true}
        formatContent={request?.formatContent}
        applyLabel={request?.applyLabel ?? '应用到页面'}
        onClose={closeAiDialog}
        onApplyResult={request?.onApplyResult}
      />
    </AiChatDialogContext.Provider>
  )
}

/**
 * 通用 AI 业务弹窗 Hook。
 *
 * const { openAiDialog } = useAiChatDialog()
 * openAiDialog({ title: '需求分析', prompt })
 */
export const useAiChatDialog = (): Pick<
  AiChatDialogContextValue,
  'openAiDialog' | 'closeAiDialog' | 'isOpen'
> => {
  const context = useContext(AiChatDialogContext)

  if (!context) {
    throw new Error('useAiChatDialog 必须在 AiChatDialogProvider 内使用')
  }

  return context
}
