import { app, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { backupCorruptStoreSync } from './store-backup'

/** 每个站点最多保留的账号历史数量。 */
const MAX_ACCOUNTS_PER_ORIGIN = 20
/** 单个账号值最大长度，避免误存长文本。 */
const MAX_VALUE_LENGTH = 200
const AUTOFILL_FILE = 'embedded-autofill.json'

type AutofillHistory = Record<string, string[]>

let cachedHistory: AutofillHistory | null = null

const getHistoryPath = (): string => join(app.getPath('userData'), AUTOFILL_FILE)

/** 规范化并校验账号值。 */
const normalizeValue = (value: unknown): string | null => {
  if (typeof value !== 'string') return null

  const normalized = value.trim()

  if (!normalized || normalized.length > MAX_VALUE_LENGTH) return null
  if (/[\r\n]/.test(normalized)) return null

  return normalized
}

/** 从请求来源提取站点 origin，忽略非 HTTP(S) 页面。 */
const getOrigin = (event: IpcMainInvokeEvent): string | null => {
  const url = event.senderFrame?.url

  if (!url) return null

  try {
    const parsed = new URL(url)

    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.origin
      : null
  } catch {
    return null
  }
}

const readHistory = (): AutofillHistory => {
  if (cachedHistory) return cachedHistory

  let raw: string

  try {
    raw = readFileSync(getHistoryPath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      cachedHistory = {}
      return cachedHistory
    }

    throw error
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    backupCorruptStoreSync(getHistoryPath())
    cachedHistory = {}
    return cachedHistory
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    backupCorruptStoreSync(getHistoryPath())
    cachedHistory = {}
    return cachedHistory
  }

  const next: AutofillHistory = {}

  for (const [origin, values] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(values)) continue

    const accounts = values
      .map(normalizeValue)
      .filter((value): value is string => value !== null)
      .slice(0, MAX_ACCOUNTS_PER_ORIGIN)

    if (accounts.length > 0) next[origin] = accounts
  }

  cachedHistory = next
  return cachedHistory
}

/** 原子写入账号历史。 */
const persistHistory = (history: AutofillHistory): void => {
  const targetPath = getHistoryPath()
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`
  let temporaryCreated = false

  try {
    const descriptor = openSync(temporaryPath, 'wx', 0o600)
    temporaryCreated = true

    try {
      writeFileSync(descriptor, JSON.stringify(history, null, 2), 'utf8')
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }

    renameSync(temporaryPath, targetPath)
  } catch (error) {
    if (temporaryCreated) {
      try {
        rmSync(temporaryPath, { force: true })
      } catch {
        // 清理失败不掩盖原始写入错误。
      }
    }

    throw error
  }
}

/** 注册内置浏览器账号历史 IPC。 */
export const initializeEmbeddedAutofill = (): void => {
  ipcMain.handle('embedded-autofill:get', (event) => {
    const origin = getOrigin(event)

    return origin ? readHistory()[origin] ?? [] : []
  })

  ipcMain.handle('embedded-autofill:save', (event, value: unknown) => {
    const origin = getOrigin(event)
    const account = normalizeValue(value)

    if (!origin || !account) {
      return origin ? readHistory()[origin] ?? [] : []
    }

    const history = readHistory()
    const current = history[origin] ?? []
    const next = [
      account,
      ...current.filter((item) => item.toLocaleLowerCase() !== account.toLocaleLowerCase())
    ].slice(0, MAX_ACCOUNTS_PER_ORIGIN)

    history[origin] = next
    cachedHistory = history
    persistHistory(history)

    return next
  })

  ipcMain.handle('embedded-autofill:clear', (event) => {
    const origin = getOrigin(event)

    if (!origin) return []

    const history = readHistory()

    if (history[origin]) {
      delete history[origin]
      cachedHistory = history
      persistHistory(history)
    }

    return []
  })
}
