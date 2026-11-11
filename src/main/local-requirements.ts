/**
 * 本地临时需求。
 * 数据按 Meegle 空间隔离并保存在 userData，不写入 Meegle。
 */
import { app, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { backupCorruptStore } from './store-backup'
import type {
  LocalRequirement,
  LocalRequirementInput,
  LocalRequirementPerson,
  LocalRequirementPriority,
  LocalRequirementStatus
} from '../types/local-requirements'
import type { MeegleRequirement } from '../types/requirements'

const STORE_FILE = 'local-requirements.json'
const MAX_REQUIREMENTS = 500
const MAX_NAME_LENGTH = 160
const MAX_DESCRIPTION_LENGTH = 8_000
const LOCAL_ID_PREFIX = 'local:'

const STATUS_VALUES: LocalRequirementStatus[] = [
  '待处理',
  '进行中',
  '待测试',
  '已完成',
  '已取消'
]
const PRIORITY_VALUES: LocalRequirementPriority[] = ['P0', 'P1', 'P2']

interface LocalRequirementStore {
  requirements: LocalRequirement[]
}

const getStorePath = (): string => join(app.getPath('userData'), STORE_FILE)

/** 判断需求 ID 是否为本地临时需求。 */
export const isLocalRequirementId = (value: string): boolean =>
  value.startsWith(LOCAL_ID_PREFIX)

const isClosedStatus = (status: LocalRequirementStatus): boolean =>
  status === '已完成' || status === '已取消'

const normalizeText = (
  value: unknown,
  maxLength: number
): string => (typeof value === 'string' ? value.trim().slice(0, maxLength) : '')

const normalizeOptionalText = (
  value: unknown,
  maxLength: number
): string | null => {
  const text = normalizeText(value, maxLength)

  return text || null
}

const normalizeStatus = (value: unknown): LocalRequirementStatus =>
  STATUS_VALUES.includes(value as LocalRequirementStatus)
    ? (value as LocalRequirementStatus)
    : '待处理'

const normalizePriority = (value: unknown): LocalRequirementPriority | null =>
  PRIORITY_VALUES.includes(value as LocalRequirementPriority)
    ? (value as LocalRequirementPriority)
    : null

const normalizePerson = (value: unknown): LocalRequirementPerson | null => {
  if (!value || typeof value !== 'object') return null

  const person = value as Partial<LocalRequirementPerson>
  const name = normalizeText(person.name, MAX_NAME_LENGTH)

  if (!name) return null

  return {
    name,
    email: normalizeOptionalText(person.email, MAX_NAME_LENGTH),
    avatarUrl: normalizeOptionalText(person.avatarUrl, 2_000),
    userKey: normalizeOptionalText(person.userKey, MAX_NAME_LENGTH)
  }
}

const normalizeDate = (value: unknown): string | null => {
  const text = normalizeText(value, 10)

  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

const normalizeInput = (value: unknown): LocalRequirementInput => {
  if (!value || typeof value !== 'object') {
    throw new Error('临时需求参数不合法')
  }

  const input = value as Partial<LocalRequirementInput>
  const name = normalizeText(input.name, MAX_NAME_LENGTH)

  if (!name) throw new Error('临时需求名称不能为空')

  const iterationName = normalizeOptionalText(input.iterationName, MAX_NAME_LENGTH)

  return {
    name,
    description: normalizeOptionalText(input.description, MAX_DESCRIPTION_LENGTH),
    status: normalizeStatus(input.status),
    priority: normalizePriority(input.priority),
    productManager: normalizePerson(input.productManager),
    productLine: normalizeOptionalText(input.productLine, MAX_NAME_LENGTH),
    iterationId: iterationName
      ? normalizeOptionalText(input.iterationId, 160)
      : null,
    iterationName,
    iterationDate: iterationName ? normalizeDate(input.iterationDate) : null
  }
}

const normalizeStoredRequirement = (value: unknown): LocalRequirement | null => {
  if (!value || typeof value !== 'object') return null

  const item = value as Record<string, unknown>
  const id = typeof item.id === 'string' ? item.id : ''
  const projectKey =
    typeof item.projectKey === 'string' ? item.projectKey.trim() : ''
  const name = normalizeText(item.name, MAX_NAME_LENGTH)
  const status = normalizeStatus(item.status)

  if (
    !isLocalRequirementId(id) ||
    !projectKey ||
    !name ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string' ||
    (item.completedAt !== null && typeof item.completedAt !== 'string')
  ) {
    return null
  }

  return {
    id,
    projectKey,
    name,
    description: normalizeOptionalText(item.description, MAX_DESCRIPTION_LENGTH),
    status,
    priority: normalizePriority(item.priority),
    productManager: normalizePerson(item.productManager),
    productLine: normalizeOptionalText(item.productLine, MAX_NAME_LENGTH),
    iterationId: normalizeOptionalText(item.iterationId, 160),
    iterationName: normalizeOptionalText(item.iterationName, MAX_NAME_LENGTH),
    iterationDate: normalizeDate(item.iterationDate),
    closed: isClosedStatus(status),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    completedAt: typeof item.completedAt === 'string' ? item.completedAt : null
  }
}

const readRequirements = async (): Promise<LocalRequirement[]> => {
  let raw: string

  try {
    raw = await readFile(getStorePath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LocalRequirementStore> | null

    if (!parsed || !Array.isArray(parsed.requirements)) {
      await backupCorruptStore(getStorePath())
      return []
    }

    return parsed.requirements
      .map(normalizeStoredRequirement)
      .filter((item): item is LocalRequirement => item !== null)
  } catch {
    await backupCorruptStore(getStorePath())
    return []
  }
}

const writeRequirements = async (
  requirements: LocalRequirement[]
): Promise<void> => {
  const targetPath = getStorePath()
  const tempPath = `${targetPath}.${randomUUID()}.tmp`

  try {
    const handle = await open(tempPath, 'w')

    try {
      await handle.writeFile(JSON.stringify({ requirements }, null, 2), 'utf8')
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

let mutationQueue: Promise<void> = Promise.resolve()

const mutateRequirements = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = mutationQueue.then(operation, operation)

  mutationQueue = result.then(
    () => undefined,
    () => undefined
  )

  return result
}

const requireProjectKey = (value: unknown): string => {
  const projectKey = typeof value === 'string' ? value.trim() : ''

  if (!projectKey) throw new Error('Meegle 空间 key 不合法')

  return projectKey
}

const requireLocalId = (value: unknown): string => {
  const id = typeof value === 'string' ? value.trim() : ''

  if (!isLocalRequirementId(id)) throw new Error('临时需求 ID 不合法')

  return id
}

/** 读取指定空间下的本地临时需求。 */
export const listLocalRequirements = async (
  projectKey: string,
  includeClosed = true
): Promise<LocalRequirement[]> => {
  const requirements = await readRequirements()

  return requirements.filter(
    (item) =>
      item.projectKey === projectKey && (includeClosed || !item.closed)
  )
}

/** 按关键词搜索指定空间下的本地临时需求。 */
export const searchLocalRequirements = async (
  projectKey: string,
  keyword: string
): Promise<LocalRequirement[]> => {
  const normalized = keyword.trim().toLocaleLowerCase()

  if (!normalized) return []

  return (await listLocalRequirements(projectKey, true)).filter((item) =>
    [
      item.name,
      item.description ?? '',
      item.status,
      item.priority ?? '',
      item.iterationName ?? '',
      item.productLine ?? '',
      item.productManager?.name ?? ''
    ].some((value) => value.toLocaleLowerCase().includes(normalized))
  )
}

/** 新建本地临时需求。 */
export const addLocalRequirement = (
  projectKeyValue: unknown,
  inputValue: unknown
): Promise<LocalRequirement> => {
  const projectKey = requireProjectKey(projectKeyValue)
  const input = normalizeInput(inputValue)

  return mutateRequirements(async () => {
    const requirements = await readRequirements()
    const now = new Date().toISOString()
    const localRequirement: LocalRequirement = {
      id: `${LOCAL_ID_PREFIX}${randomUUID()}`,
      projectKey,
      ...input,
      closed: isClosedStatus(input.status),
      createdAt: now,
      updatedAt: now,
      completedAt: isClosedStatus(input.status) ? now : null
    }

    await writeRequirements(
      [localRequirement, ...requirements].slice(0, MAX_REQUIREMENTS)
    )

    return localRequirement
  })
}

/** 更新本地临时需求。 */
export const updateLocalRequirement = (
  projectKeyValue: unknown,
  idValue: unknown,
  inputValue: unknown
): Promise<LocalRequirement> => {
  const projectKey = requireProjectKey(projectKeyValue)
  const id = requireLocalId(idValue)
  const input = normalizeInput(inputValue)

  return mutateRequirements(async () => {
    const requirements = await readRequirements()
    const existing = requirements.find(
      (item) => item.projectKey === projectKey && item.id === id
    )

    if (!existing) throw new Error('临时需求不存在')

    const now = new Date().toISOString()
    const closed = isClosedStatus(input.status)
    const updated: LocalRequirement = {
      ...existing,
      ...input,
      closed,
      updatedAt: now,
      completedAt: closed ? (existing.completedAt ?? now) : null
    }

    await writeRequirements(
      requirements.map((item) => (item.id === id ? updated : item))
    )

    return updated
  })
}

/** 删除本地临时需求。 */
export const removeLocalRequirement = (
  projectKeyValue: unknown,
  idValue: unknown
): Promise<void> => {
  const projectKey = requireProjectKey(projectKeyValue)
  const id = requireLocalId(idValue)

  return mutateRequirements(async () => {
    const requirements = await readRequirements()

    await writeRequirements(
      requirements.filter(
        (item) => !(item.projectKey === projectKey && item.id === id)
      )
    )
  })
}

/** 将本地临时需求转换为工作台统一展示结构。 */
export const toMeegleRequirement = (
  item: LocalRequirement
): MeegleRequirement => ({
  source: 'local',
  id: item.id,
  name: item.name,
  status: item.status,
  priority: item.priority,
  owners: [],
  productManagers: item.productManager ? [item.productManager] : [],
  productOwners: [],
  requirementType: '临时需求',
  riskLabels: [],
  description: item.description,
  documentUrl: null,
  createdBy: null,
  proposedAt: item.createdAt,
  expectedReleaseAt: null,
  productLines: item.productLine ? [item.productLine] : [],
  planningVersions: item.iterationName ? [item.iterationName] : [],
  collaborators: [],
  requirementLevel: null,
  requirementNature: null,
  complexity: null,
  developmentDifficulty: null,
  estimatedWorkload: null,
  technicalSolution: null,
  application: null,
  tags: [],
  actualReleaseVersions: [],
  completedAt: item.completedAt,
  permissionsInvolved: null,
  historicalDataInvolved: null,
  performanceTestInvolved: null,
  remark: null,
  iterationId: item.iterationId,
  iterationName: item.iterationName,
  iterationDate: item.iterationDate,
  iterations: item.iterationName
    ? [
        {
          id: item.iterationId,
          name: item.iterationName,
          date: item.iterationDate
        }
      ]
    : [],
  updatedAt: item.updatedAt
})

/** 注册本地临时需求 IPC。 */
export const initializeLocalRequirements = (): void => {
  ipcMain.handle(
    'local-requirements:add',
    (_event, projectKey: unknown, input: unknown) =>
      addLocalRequirement(projectKey, input)
  )
  ipcMain.handle(
    'local-requirements:update',
    (_event, projectKey: unknown, id: unknown, input: unknown) =>
      updateLocalRequirement(projectKey, id, input)
  )
  ipcMain.handle(
    'local-requirements:remove',
    (_event, projectKey: unknown, id: unknown) =>
      removeLocalRequirement(projectKey, id)
  )
}
