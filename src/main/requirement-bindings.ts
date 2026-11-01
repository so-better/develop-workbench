/**
 * 需求与代码仓库绑定模块。
 * 负责普通分支绑定、轻舟工作项绑定和轻舟分支快照，不修改 Git 工作区。
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isLocalRequirementId } from './local-requirements'
import { getProject } from './requirements'
import { getRepositoryState, listRepositoryBranches } from './repositories'
import { backupCorruptStore } from './store-backup'
import { getQingzhouCodeTasks } from './qingzhou'
import type { QingzhouCodeTaskDetail } from './qingzhou'
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

/** 普通绑定支持 Meegle 数字 ID 和本地临时需求 ID。 */
const isValidRequirementId = (value: string): boolean =>
  /^\d+$/.test(value) || isLocalRequirementId(value)

/**
 * 绑定数据文件路径。
 */
const getStorePath = (): string => join(app.getPath('userData'), STORE_FILE)

/**
 * 校验持久化的绑定记录。
 * 普通绑定必须有开发分支，轻舟绑定必须有工作项 ID。
 */
const normalizeStoredBinding = (value: unknown): RequirementRepoBinding | null => {
  if (!value || typeof value !== 'object') return null

  const binding = value as Record<string, unknown>

  if (
    typeof binding.id !== 'string' ||
    typeof binding.repositoryId !== 'string' ||
    (binding.mode !== 'normal' && binding.mode !== 'qingzhou') ||
    (binding.branchName !== null && typeof binding.branchName !== 'string') ||
    (binding.qingzhouWorkItemId !== undefined &&
      binding.qingzhouWorkItemId !== null &&
      typeof binding.qingzhouWorkItemId !== 'string') ||
    (binding.qingzhouTaskId !== undefined &&
      binding.qingzhouTaskId !== null &&
      typeof binding.qingzhouTaskId !== 'string') ||
    typeof binding.createdAt !== 'string' ||
    typeof binding.updatedAt !== 'string'
  ) {
    return null
  }

  const mode = binding.mode
  const branchName =
    typeof binding.branchName === 'string' ? binding.branchName.trim() || null : null
  const qingzhouWorkItemId =
    typeof binding.qingzhouWorkItemId === 'string'
      ? binding.qingzhouWorkItemId.trim() || null
      : null
  const qingzhouTaskId =
    typeof binding.qingzhouTaskId === 'string'
      ? binding.qingzhouTaskId.trim() || null
      : null

  if (mode === 'normal' && !branchName) return null
  if (mode === 'qingzhou' && !qingzhouWorkItemId) return null

  return {
    id: binding.id,
    repositoryId: binding.repositoryId,
    mode,
    branchName,
    qingzhouWorkItemId,
    qingzhouTaskId,
    qingzhouWorkItemTitle:
      typeof binding.qingzhouWorkItemTitle === 'string'
        ? binding.qingzhouWorkItemTitle
        : null,
    qingzhouCodeRepositoryId:
      typeof binding.qingzhouCodeRepositoryId === 'string'
        ? binding.qingzhouCodeRepositoryId
        : null,
    requirementBranch:
      typeof binding.requirementBranch === 'string' ? binding.requirementBranch : null,
    iterationBranch:
      typeof binding.iterationBranch === 'string' ? binding.iterationBranch : null,
    qingzhouIterationBranchId:
      typeof binding.qingzhouIterationBranchId === 'string'
        ? binding.qingzhouIterationBranchId
        : null,
    lastSyncedAt:
      typeof binding.lastSyncedAt === 'string' ? binding.lastSyncedAt : null,
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt
  }
}

/**
 * 校验持久化的工作区记录。
 */
const normalizeStoredWorkspace = (value: unknown): StoredWorkspace | null => {
  if (!value || typeof value !== 'object') return null

  const workspace = value as Record<string, unknown>

  if (
    typeof workspace.projectKey !== 'string' ||
    typeof workspace.requirementId !== 'string' ||
    typeof workspace.updatedAt !== 'string' ||
    !Array.isArray(workspace.bindings)
  ) {
    return null
  }

  const bindings = workspace.bindings.map(normalizeStoredBinding)

  if (bindings.some((binding) => binding === null)) return null

  return {
    projectKey: workspace.projectKey,
    requirementId: workspace.requirementId,
    bindings: bindings as RequirementRepoBinding[],
    updatedAt: workspace.updatedAt
  }
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
    workspaces: parsed.workspaces
      .map(normalizeStoredWorkspace)
      .filter((workspace): workspace is StoredWorkspace => workspace !== null)
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
    if (!isValidRequirementId(requirementId)) {
      throw new Error('需求 ID 不合法')
    }

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

const normalizeRepositoryUrl = (value: string | null): string =>
  (value ?? '')
    .trim()
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase()

/**
 * 从 HTTPS 或 SSH 地址中提取仓库名，用于兼容不同协议的远程地址。
 */
const getRepositorySlug = (value: string | null): string => {
  const raw = (value ?? '').trim()

  if (!raw) return ''

  try {
    const path = new URL(raw).pathname

    return (path.split('/').filter(Boolean).pop() ?? '')
      .replace(/\.git$/i, '')
      .toLowerCase()
  } catch {
    const last = raw.split(/[/:]/).filter(Boolean).pop() ?? ''

    return last.replace(/\.git$/i, '').toLowerCase()
  }
}

/**
 * 防止把其他需求的工作项绑到当前需求。
 */
const assertDetailMatchesRequirement = (
  requirementId: string,
  detail: QingzhouCodeTaskDetail
): void => {
  if (detail.workItemId && detail.workItemId !== requirementId) {
    throw new Error('该轻舟工作项不属于当前需求')
  }
}

const detailMatchesRepository = (
  repository: { name: string; remoteUrl: string | null },
  detail: QingzhouCodeTaskDetail
): boolean => {
  const localNames = new Set(
    [repository.name.trim().toLowerCase(), getRepositorySlug(repository.remoteUrl)].filter(
      Boolean
    )
  )
  const detailNames = new Set(
    [
      detail.repositoryName?.trim().toLowerCase() ?? '',
      getRepositorySlug(detail.repositoryUrl)
    ].filter(Boolean)
  )
  const urlMatches =
    Boolean(detail.repositoryUrl) &&
    normalizeRepositoryUrl(repository.remoteUrl) ===
      normalizeRepositoryUrl(detail.repositoryUrl)
  const nameMatches = Array.from(detailNames).some((name) => localNames.has(name))

  return !detail.repositoryUrl && !detail.repositoryName
    ? true
    : urlMatches || nameMatches
}

/**
 * 一个轻舟工作项可能存在多个代码任务，需要按当前仓库挑选。
 * 没有任何代码任务时返回 null，表示工作项已创建但分支尚未创建。
 */
const selectCodeTaskForRepository = (
  repository: { name: string; remoteUrl: string | null },
  tasks: QingzhouCodeTaskDetail[]
): QingzhouCodeTaskDetail | null => {
  const activeTasks = tasks.filter((task) => !task.archived)
  const matchingTasks = activeTasks.filter((task) =>
    detailMatchesRepository(repository, task)
  )

  if (matchingTasks.length > 0) return matchingTasks[0]

  if (activeTasks.length > 0) {
    throw new Error(
      `工作项下的代码任务仓库与当前仓库不一致：${activeTasks
        .map((task) => task.repositoryName ?? '未知仓库')
        .join('、')}`
    )
  }

  return null
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
        mode: 'normal',
        branchName: normalizedBranch,
        qingzhouWorkItemId: null,
        qingzhouTaskId: null,
        qingzhouWorkItemTitle: null,
        qingzhouCodeRepositoryId: null,
        requirementBranch: null,
        iterationBranch: null,
        qingzhouIterationBranchId: null,
        lastSyncedAt: null,
        createdAt: now,
        updatedAt: now
      }
    ]
  })
}

/**
 * 绑定轻舟工作项。
 */
export const addQingzhouRequirementBinding = async (
  window: BrowserWindow,
  requirementId: string,
  repositoryId: string
): Promise<RequirementBindingState> => {
  if (isLocalRequirementId(requirementId)) {
    throw new Error('临时需求不支持轻舟绑定')
  }
  if (!/^\d+$/.test(requirementId)) throw new Error('需求 ID 不合法')
  if (!repositoryId.trim()) throw new Error('仓库 ID 不合法')

  // 飞书 story id 就是轻舟 workItemId，不需要用户额外填写。
  const normalizedWorkItemId = requirementId

  const repositoryState = await getRepositoryState()
  const repository = repositoryState.repositories.find(
    (item) => item.id === repositoryId
  )

  if (!repository) throw new Error('仓库不存在')
  if (!repository.qingzhouEnabled) throw new Error('该仓库未接入轻舟')

  const existing = await getState(requirementId)

  if (existing.bindings.some((binding) => binding.repositoryId === repositoryId)) {
    throw new Error('该仓库已经绑定')
  }

  // 查询可能触发内嵌浏览器登录；按 workItemId 拉取代码任务后再匹配当前仓库。
  const tasks = await getQingzhouCodeTasks(window, normalizedWorkItemId)
  const detail = selectCodeTaskForRepository(repository, tasks)

  if (detail) assertDetailMatchesRequirement(requirementId, detail)

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
        mode: 'qingzhou',
        branchName: null,
        qingzhouWorkItemId: normalizedWorkItemId,
        qingzhouTaskId: detail?.codeTaskId ?? null,
        qingzhouWorkItemTitle: detail?.workItemTitle ?? null,
        qingzhouCodeRepositoryId: detail?.codeRepositoryId ?? null,
        requirementBranch: detail?.requirementBranch ?? null,
        iterationBranch: detail?.iterationBranch ?? null,
        qingzhouIterationBranchId: detail?.iterationBranchId ?? null,
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now
      }
    ]
  })
}

/**
 * 同步轻舟工作项的分支信息。
 */
export const syncQingzhouRequirementBinding = async (
  window: BrowserWindow,
  requirementId: string,
  bindingId: string
): Promise<RequirementBindingState> => {
  const state = await getState(requirementId)
  const binding = state.bindings.find((item) => item.id === bindingId)

  if (!binding) throw new Error('绑定记录不存在')
  if (binding.mode !== 'qingzhou' || !binding.qingzhouWorkItemId) {
    throw new Error('该绑定不是轻舟工作项')
  }

  const repositoryState = await getRepositoryState()
  const repository = repositoryState.repositories.find(
    (item) => item.id === binding.repositoryId
  )

  if (!repository) throw new Error('仓库不存在')

  // 每次同步都重新从轻舟取快照，分支在轻舟侧变更后可刷新到本地绑定。
  const tasks = await getQingzhouCodeTasks(window, binding.qingzhouWorkItemId)
  const detail = selectCodeTaskForRepository(repository, tasks)

  if (detail) assertDetailMatchesRequirement(requirementId, detail)

  return updateBindings(requirementId, (bindings) => {
    if (!bindings.some((item) => item.id === bindingId)) {
      throw new Error('绑定记录不存在')
    }

    const now = new Date().toISOString()

    return bindings.map((item) =>
      item.id === bindingId
        ? {
            ...item,
            qingzhouTaskId: detail?.codeTaskId ?? null,
            qingzhouWorkItemTitle: detail?.workItemTitle ?? item.qingzhouWorkItemTitle,
            qingzhouCodeRepositoryId:
              detail?.codeRepositoryId ?? item.qingzhouCodeRepositoryId,
            requirementBranch: detail?.requirementBranch ?? null,
            iterationBranch: detail?.iterationBranch ?? null,
            qingzhouIterationBranchId:
              detail?.iterationBranchId ?? item.qingzhouIterationBranchId,
            lastSyncedAt: now,
            updatedAt: now
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
 * 删除需求下的全部仓库绑定。
 */
export const removeRequirementBindingWorkspace = (
  requirementId: string
): Promise<RequirementBindingState> => updateBindings(requirementId, () => [])

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
    'bindings:add-qingzhou',
    (event, requirementId: unknown, repositoryId: unknown) => {
      if (typeof requirementId !== 'string' || typeof repositoryId !== 'string') {
        throw new Error('绑定参数不合法')
      }

      const window = BrowserWindow.fromWebContents(event.sender)

      if (!window) throw new Error('窗口不存在')

      return addQingzhouRequirementBinding(window, requirementId, repositoryId)
    }
  )

  ipcMain.handle(
    'bindings:sync-qingzhou',
    (event, requirementId: unknown, bindingId: unknown) => {
      if (typeof requirementId !== 'string' || typeof bindingId !== 'string') {
        throw new Error('绑定参数不合法')
      }

      const window = BrowserWindow.fromWebContents(event.sender)

      if (!window) throw new Error('窗口不存在')

      return syncQingzhouRequirementBinding(window, requirementId, bindingId)
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

  ipcMain.handle('bindings:remove-workspace', (_event, requirementId: unknown) => {
    if (typeof requirementId !== 'string') throw new Error('需求 ID 不合法')

    return removeRequirementBindingWorkspace(requirementId)
  })
}
