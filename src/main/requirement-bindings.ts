/**
 * 需求与代码仓库绑定模块。
 * 只保存仓库和分支映射，不修改 Git 工作区。
 */
import { app, ipcMain } from 'electron'
import { open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getProject } from './requirements'
import { listRepositoryBranches } from './repositories'
import { backupCorruptStore } from './store-backup'
import type { RequirementBindingState, RequirementRepoBinding } from '../types/bindings'

interface StoredWorkspace {
  projectKey: string
  requirementId: string
  bindings: RequirementRepoBinding[]
  updatedAt: string
}

interface BindingStore {
  workspaces: StoredWorkspace[]
}

const STORE_FILE = 'requirement-bindings.json'

/**
 * 绑定数据文件路径。
 */
const getStorePath = (): string => join(app.getPath('userData'), STORE_FILE)

/**
 * 校验持久化的绑定记录。
 */
const isStoredBinding = (value: unknown): value is RequirementRepoBinding => {
  if (!value || typeof value !== 'object') return false

  const binding = value as Record<string, unknown>

  return (
    typeof binding.id === 'string' &&
    typeof binding.repositoryId === 'string' &&
    typeof binding.branchName === 'string' &&
    typeof binding.createdAt === 'string' &&
    typeof binding.updatedAt === 'string'
  )
}

/**
 * 校验持久化的工作区记录。
 */
const isStoredWorkspace = (value: unknown): value is StoredWorkspace => {
  if (!value || typeof value !== 'object') return false

  const workspace = value as Record<string, unknown>

  return (
    typeof workspace.projectKey === 'string' &&
    typeof workspace.requirementId === 'string' &&
    typeof workspace.updatedAt === 'string' &&
    Array.isArray(workspace.bindings) &&
    workspace.bindings.every(isStoredBinding)
  )
}

/**
 * 读取绑定数据。
 */
const readStore = async (): Promise<BindingStore> => {
  let raw: string

  try {
    raw = await readFile(getStorePath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { workspaces: [] }
    }

    throw error
  }

  let parsed: Partial<BindingStore> | null

  try {
    parsed = JSON.parse(raw) as Partial<BindingStore> | null
  } catch {
    await backupCorruptStore(getStorePath())
    return { workspaces: [] }
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.workspaces)) {
    await backupCorruptStore(getStorePath())
    return { workspaces: [] }
  }

  return {
    workspaces: parsed.workspaces.filter(isStoredWorkspace)
  }
}

/**
 * 原子写入绑定数据。
 */
const writeStore = async (store: BindingStore): Promise<void> => {
  const targetPath = getStorePath()
  const tempPath = `${targetPath}.${randomUUID()}.tmp`
  const content = JSON.stringify(store, null, 2)

  try {
    const handle = await open(tempPath, 'w')

    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }

    await rename(tempPath, targetPath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * 获取需求绑定状态。
 */
const getState = async (requirementId: string): Promise<RequirementBindingState> => {
  const project = await getProject()
  const store = await readStore()
  const workspace = store.workspaces.find(
    (item) => item.projectKey === project.projectKey && item.requirementId === requirementId
  )

  return {
    requirementId,
    projectKey: project.projectKey,
    bindings: workspace?.bindings ?? []
  }
}

let bindingWriteQueue: Promise<void> = Promise.resolve()

const enqueueBindingWrite = <T>(task: () => Promise<T>): Promise<T> => {
  const result = bindingWriteQueue.then(task)

  bindingWriteQueue = result.then(
    () => undefined,
    () => undefined
  )

  return result
}

/**
 * 更新指定需求的绑定数据。
 */
const updateBindings = (
  requirementId: string,
  updater: (bindings: RequirementRepoBinding[]) => RequirementRepoBinding[]
): Promise<RequirementBindingState> =>
  enqueueBindingWrite(async () => {
    if (!/^\d+$/.test(requirementId)) throw new Error('需求 ID 不合法')

    const project = await getProject()
    const store = await readStore()
    const index = store.workspaces.findIndex(
      (item) => item.projectKey === project.projectKey && item.requirementId === requirementId
    )
    const current = index >= 0 ? store.workspaces[index] : null
    const bindings = updater(current?.bindings ?? [])
    const updatedAt = new Date().toISOString()

    if (bindings.length === 0) {
      if (index >= 0) store.workspaces.splice(index, 1)
    } else if (index >= 0) {
      store.workspaces[index] = {
        ...store.workspaces[index],
        bindings,
        updatedAt
      }
    } else {
      store.workspaces.push({
        projectKey: project.projectKey,
        requirementId,
        bindings,
        updatedAt
      })
    }

    await writeStore(store)

    return {
      requirementId,
      projectKey: project.projectKey,
      bindings
    }
  })

/**
 * 校验仓库分支存在。
 */
const assertBranchExists = async (repositoryId: string, branchName: string): Promise<void> => {
  const { branches } = await listRepositoryBranches(repositoryId)

  if (!branches.includes(branchName)) {
    throw new Error(`分支不存在：${branchName}`)
  }
}

/**
 * 新增仓库绑定。
 */
export const addRequirementBinding = async (
  requirementId: string,
  repositoryId: string,
  branchName: string
): Promise<RequirementBindingState> => {
  const normalizedBranch = branchName.trim()

  if (!repositoryId.trim()) throw new Error('仓库 ID 不合法')
  if (!normalizedBranch) throw new Error('请选择开发分支')

  await assertBranchExists(repositoryId, normalizedBranch)

  return updateBindings(requirementId, (bindings) => {
    if (bindings.some((binding) => binding.repositoryId === repositoryId)) {
      throw new Error('该仓库已经绑定')
    }

    const now = new Date().toISOString()

    return [
      ...bindings,
      {
        id: randomUUID(),
        repositoryId,
        branchName: normalizedBranch,
        createdAt: now,
        updatedAt: now
      }
    ]
  })
}

/**
 * 修改绑定分支。
 */
export const updateRequirementBinding = async (
  requirementId: string,
  bindingId: string,
  branchName: string
): Promise<RequirementBindingState> => {
  const normalizedBranch = branchName.trim()

  if (!normalizedBranch) throw new Error('请选择开发分支')

  const state = await getState(requirementId)
  const binding = state.bindings.find((item) => item.id === bindingId)

  if (!binding) throw new Error('绑定记录不存在')

  await assertBranchExists(binding.repositoryId, normalizedBranch)

  return updateBindings(requirementId, (bindings) => {
    if (!bindings.some((item) => item.id === bindingId)) {
      throw new Error('绑定记录不存在')
    }

    return bindings.map((item) =>
      item.id === bindingId
        ? {
            ...item,
            branchName: normalizedBranch,
            updatedAt: new Date().toISOString()
          }
        : item
    )
  })
}

/**
 * 解除仓库绑定。
 */
export const removeRequirementBinding = async (
  requirementId: string,
  bindingId: string
): Promise<RequirementBindingState> =>
  updateBindings(requirementId, (bindings) =>
    bindings.filter((binding) => binding.id !== bindingId)
  )

/**
 * 注册需求仓库绑定 IPC。
 */
export const initializeRequirementBindings = (): void => {
  ipcMain.handle('bindings:get', (_event, requirementId: unknown) => {
    if (typeof requirementId !== 'string') throw new Error('需求 ID 不合法')
    return getState(requirementId)
  })

  ipcMain.handle(
    'bindings:add',
    (_event, requirementId: unknown, repositoryId: unknown, branchName: unknown) => {
      if (
        typeof requirementId !== 'string' ||
        typeof repositoryId !== 'string' ||
        typeof branchName !== 'string'
      ) {
        throw new Error('绑定参数不合法')
      }

      return addRequirementBinding(requirementId, repositoryId, branchName)
    }
  )

  ipcMain.handle(
    'bindings:update',
    (_event, requirementId: unknown, bindingId: unknown, branchName: unknown) => {
      if (
        typeof requirementId !== 'string' ||
        typeof bindingId !== 'string' ||
        typeof branchName !== 'string'
      ) {
        throw new Error('绑定参数不合法')
      }

      return updateRequirementBinding(requirementId, bindingId, branchName)
    }
  )

  ipcMain.handle(
    'bindings:remove',
    (_event, requirementId: unknown, bindingId: unknown) => {
      if (typeof requirementId !== 'string' || typeof bindingId !== 'string') {
        throw new Error('绑定参数不合法')
      }

      return removeRequirementBinding(requirementId, bindingId)
    }
  )
}
