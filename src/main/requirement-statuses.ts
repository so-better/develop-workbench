/**
 * 需求个人状态标记模块。
 * 只保存在本机，不写回 Meegle。
 */
import { randomUUID } from 'node:crypto'
import { app, ipcMain } from 'electron'
import { open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { backupCorruptStore } from './store-backup'
import type {
  RequirementPersonalStatus,
  RequirementPersonalStatusState
} from '../types/requirement-status'

interface StatusStore {
  statuses: RequirementPersonalStatus[]
}

const STORE_FILE = 'requirement-personal-statuses.json'
const MAX_STATUS_LENGTH = 120

const getStorePath = (): string => join(app.getPath('userData'), STORE_FILE)

/** 校验持久化记录，丢弃空值或结构异常的数据。 */
const normalizeStoredStatus = (value: unknown): RequirementPersonalStatus | null => {
  if (!value || typeof value !== 'object') return null

  const status = value as Record<string, unknown>

  if (
    typeof status.projectKey !== 'string' ||
    typeof status.requirementId !== 'string' ||
    typeof status.value !== 'string' ||
    typeof status.updatedAt !== 'string'
  ) {
    return null
  }

  const text = status.value.trim()

  if (!text || text.length > MAX_STATUS_LENGTH) return null

  return {
    projectKey: status.projectKey,
    requirementId: status.requirementId,
    value: text,
    updatedAt: status.updatedAt
  }
}

const readStore = async (): Promise<StatusStore> => {
  let raw: string

  try {
    raw = await readFile(getStorePath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { statuses: [] }
    }

    throw error
  }

  let parsed: Partial<StatusStore> | null

  try {
    parsed = JSON.parse(raw) as Partial<StatusStore> | null
  } catch {
    await backupCorruptStore(getStorePath())
    return { statuses: [] }
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.statuses)) {
    await backupCorruptStore(getStorePath())
    return { statuses: [] }
  }

  return {
    statuses: parsed.statuses
      .map(normalizeStoredStatus)
      .filter((status): status is RequirementPersonalStatus => status !== null)
  }
}

/** 原子写入，避免进程中断留下半截 JSON。 */
const writeStore = async (store: StatusStore): Promise<void> => {
  const targetPath = getStorePath()
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`
  const content = JSON.stringify(store, null, 2)

  try {
    const handle = await open(temporaryPath, 'w')

    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }

    await rename(temporaryPath, targetPath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

const findStatus = (
  store: StatusStore,
  projectKey: string,
  requirementId: string
): RequirementPersonalStatus | null =>
  store.statuses.find(
    (status) =>
      status.projectKey === projectKey && status.requirementId === requirementId
  ) ?? null

const getStatusState = async (
  projectKey: string,
  requirementId: string
): Promise<RequirementPersonalStatusState> => {
  const store = await readStore()

  return {
    projectKey,
    requirementId,
    status: findStatus(store, projectKey, requirementId)
  }
}

let writeQueue: Promise<void> = Promise.resolve()

const enqueueWrite = <T>(task: () => Promise<T>): Promise<T> => {
  const result = writeQueue.then(task)

  writeQueue = result.then(
    () => undefined,
    () => undefined
  )

  return result
}

const setStatus = (
  projectKey: string,
  requirementId: string,
  value: string
): Promise<RequirementPersonalStatusState> =>
  enqueueWrite(async () => {
    const text = value.trim().slice(0, MAX_STATUS_LENGTH)
    const store = await readStore()
    const index = store.statuses.findIndex(
      (status) =>
        status.projectKey === projectKey && status.requirementId === requirementId
    )

    if (!text) {
      if (index >= 0) {
        store.statuses.splice(index, 1)
        await writeStore(store)
      }
    } else {
      const status: RequirementPersonalStatus = {
        projectKey,
        requirementId,
        value: text,
        updatedAt: new Date().toISOString()
      }

      if (index >= 0) store.statuses[index] = status
      else store.statuses.push(status)

      await writeStore(store)
    }

    return {
      projectKey,
      requirementId,
      status: text ? findStatus(store, projectKey, requirementId) : null
    }
  })

/** 注册需求个人状态 IPC。 */
export const initializeRequirementStatuses = (): void => {
  ipcMain.handle(
    'requirement-status:get',
    (_event, projectKey: unknown, requirementId: unknown) => {
      if (typeof projectKey !== 'string' || typeof requirementId !== 'string') {
        throw new Error('需求个人状态参数不合法')
      }

      return getStatusState(projectKey, requirementId)
    }
  )

  ipcMain.handle(
    'requirement-status:set',
    (_event, projectKey: unknown, requirementId: unknown, value: unknown) => {
      if (
        typeof projectKey !== 'string' ||
        typeof requirementId !== 'string' ||
        typeof value !== 'string'
      ) {
        throw new Error('需求个人状态参数不合法')
      }

      return setStatus(projectKey, requirementId, value)
    }
  )
}
