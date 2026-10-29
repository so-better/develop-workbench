/**
 * 底部 AI 助手会话。
 * 完整保存消息和附件数据，不保存模型 API Key 或临时产物文件本身。
 */
import { app, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { backupCorruptStore } from '../store-backup'
import type {
  AiAssistantSessionState,
  AiStoredMessage
} from '../../types/ai'

const SESSION_FILE = 'ai-assistant-session.json'
const MAX_MESSAGES = 80

const getSessionPath = (): string =>
  join(app.getPath('userData'), SESSION_FILE)

const normalizeStoredMessage = (value: unknown): AiStoredMessage | null => {
  if (!value || typeof value !== 'object') return null

  const message = value as Record<string, unknown>

  if (
    typeof message.id !== 'string' ||
    (message.role !== 'user' && message.role !== 'assistant') ||
    typeof message.content !== 'string' ||
    typeof message.createdAt !== 'string'
  ) {
    return null
  }

  return {
    id: message.id,
    role: message.role,
    content: message.content,
    ...(typeof message.reasoning === 'string'
      ? { reasoning: message.reasoning }
      : {}),
    ...(Array.isArray(message.attachments)
      ? { attachments: message.attachments as AiStoredMessage['attachments'] }
      : {}),
    ...(Array.isArray(message.tools)
      ? { tools: message.tools as AiStoredMessage['tools'] }
      : {}),
    ...(Array.isArray(message.sources)
      ? { sources: message.sources as AiStoredMessage['sources'] }
      : {}),
    ...(Array.isArray(message.artifacts)
      ? { artifacts: message.artifacts as AiStoredMessage['artifacts'] }
      : {}),
    ...(message.interrupted === true ? { interrupted: true } : {}),
    ...(message.hidden === true ? { hidden: true } : {}),
    createdAt: message.createdAt
  }
}

const getAiAssistantSession = async (): Promise<AiAssistantSessionState> => {
  let raw: string

  try {
    raw = await readFile(getSessionPath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { messages: [], updatedAt: null }
    }

    throw error
  }

  try {
    const parsed = JSON.parse(raw) as {
      messages?: unknown
      updatedAt?: unknown
    }

    if (!Array.isArray(parsed.messages)) {
      await backupCorruptStore(getSessionPath())
      return { messages: [], updatedAt: null }
    }

    return {
      messages: parsed.messages
        .map(normalizeStoredMessage)
        .filter((message): message is AiStoredMessage => Boolean(message))
        .slice(-MAX_MESSAGES),
      updatedAt:
        typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null
    }
  } catch {
    await backupCorruptStore(getSessionPath())
    return { messages: [], updatedAt: null }
  }
}

let saveQueue: Promise<void> = Promise.resolve()

const saveAiAssistantSession = (value: unknown): Promise<AiAssistantSessionState> => {
  if (!Array.isArray(value)) {
    throw new Error('AI 助手会话参数不合法')
  }

  const messages = value
    .map(normalizeStoredMessage)
    .filter((message): message is AiStoredMessage => Boolean(message))
    .slice(-MAX_MESSAGES)
  const targetPath = getSessionPath()
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`
  const updatedAt = new Date().toISOString()
  const result = saveQueue.then(async () => {
    await writeFile(
      temporaryPath,
      JSON.stringify({ messages, updatedAt }, null, 2),
      'utf8'
    )
    await rename(temporaryPath, targetPath)
  })

  saveQueue = result.then(
    () => undefined,
    () => undefined
  )

  return result.then(() => ({ messages, updatedAt }))
}

/**
 * 注册 AI 助手会话 IPC。
 */
export const initializeAiAssistantSession = (): void => {
  ipcMain.handle('ai:assistant-session:get', () => getAiAssistantSession())
  ipcMain.handle('ai:assistant-session:save', (_event, messages: unknown) =>
    saveAiAssistantSession(messages)
  )
}
