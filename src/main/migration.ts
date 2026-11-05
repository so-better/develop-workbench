/**
 * 一键迁移。
 * 导出本机应用数据为压缩包；导入时跳过本机路径字段，避免覆盖新电脑环境。
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import JSZip from 'jszip'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { getErrorMessage } from '../utils'
import { updatePreferences } from './preferences'
import type { AppPreferences } from './preferences'
import type {
  MigrationExportResult,
  MigrationImportResult,
  MigrationManifest
} from '../types/migration'

const APP_ID = 'develop-workbench'
const MANIFEST_FILE = 'manifest.json'
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/

/**
 * 迁移包包含的应用数据。
 * 浏览器登录态、缓存、下载记录和 AI 生成文件属于本机环境或可再生数据，不迁移。
 */
const MIGRATION_FILES = [
  'preferences.json',
  'sites.json',
  'quick-notes.json',
  'requirement-links.json',
  'requirement-bindings.json',
  'local-requirements.json',
  'requirement-personal-statuses.json',
  'repositories.json',
  'ai-config.json',
  'ai-assistant-session.json'
] as const

type MigrationFile = (typeof MIGRATION_FILES)[number]

const userDataPath = (name: string): string => join(app.getPath('userData'), name)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const exists = (target: string): Promise<boolean> =>
  stat(target).then(() => true, () => false)

const pad = (value: number): string => String(value).padStart(2, '0')

/** 生成压缩包和备份目录共用的时间标记。 */
const formatTimestamp = (date = new Date()): string =>
  `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`

/** 比较主版本号，用于阻止导入更高版本导出的数据。 */
const compareVersions = (left: string, right: string): number => {
  const leftParts = left.split('.').map((part) => Number(part))
  const rightParts = right.split('.').map((part) => Number(part))

  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }

  return 0
}

/** 写入临时文件再替换，避免导入中断时截断现有数据。 */
const writeAtomic = async (name: string, content: string): Promise<void> => {
  const target = userDataPath(name)
  const temporary = `${target}.${randomUUID()}.tmp`

  try {
    await writeFile(temporary, content, 'utf8')
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

/** 导入前备份将被覆盖的文件，便于失败或误操作后恢复。 */
const backupExistingFiles = async (
  files: MigrationFile[],
  timestamp: string
): Promise<string | null> => {
  const backupDirectory = userDataPath(`migration-backup-${timestamp}`)
  let copied = 0

  for (const name of files) {
    const source = userDataPath(name)
    if (!(await exists(source))) continue

    if (copied === 0) await mkdir(backupDirectory, { recursive: true })
    await copyFile(source, join(backupDirectory, name))
    copied += 1
  }

  return copied > 0 ? backupDirectory : null
}

const parseZipJson = async (zip: JSZip, name: string): Promise<string | null> => {
  const entry = zip.file(name)
  if (!entry) return null

  const content = await entry.async('string')

  try {
    JSON.parse(content)
  } catch {
    throw new Error(`迁移包中的 ${name} 不是合法 JSON`)
  }

  return content
}

/** 只恢复非本机路径字段，保留新电脑已有的 IDE、Git 和 CLI 路径。 */
const importPreferences = (content: string): void => {
  const parsed = JSON.parse(content) as Record<string, unknown>
  const patch: Partial<AppPreferences> = {}

  if (
    parsed.theme === 'system' ||
    parsed.theme === 'light' ||
    parsed.theme === 'dark'
  ) {
    patch.theme = parsed.theme
  }

  if (typeof parsed.meegleProjectKey === 'string' && parsed.meegleProjectKey.trim()) {
    patch.meegleProjectKey = parsed.meegleProjectKey
  }

  if (
    typeof parsed.productGuideSeenVersion === 'number' &&
    Number.isInteger(parsed.productGuideSeenVersion) &&
    parsed.productGuideSeenVersion >= 0
  ) {
    patch.productGuideSeenVersion = parsed.productGuideSeenVersion
  }

  updatePreferences(patch)
}

interface ImportedRepository {
  id: string
  name: string
  remoteUrl: string | null
  defaultBranch: string | null
  currentBranch: string | null
  qingzhouEnabled: boolean
  updatedAt: string
}

const normalizeRepository = (value: unknown): ImportedRepository | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null
  }

  return {
    id: value.id,
    name: value.name,
    remoteUrl: typeof value.remoteUrl === 'string' ? value.remoteUrl : null,
    defaultBranch: typeof value.defaultBranch === 'string' ? value.defaultBranch : null,
    currentBranch: typeof value.currentBranch === 'string' ? value.currentBranch : null,
    qingzhouEnabled: value.qingzhouEnabled === true,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString()
  }
}

/**
 * 导入仓库元数据，但不覆盖本机路径。
 * 已存在的仓库保留当前路径；新仓库只在旧路径真实存在且目录名匹配时采用。
 * 仓库列表按迁移包恢复，当前多余仓库会被移除（导入前已备份）。
 */
const importRepositories = async (content: string): Promise<void> => {
  const parsed = JSON.parse(content) as { repositories?: unknown }
  const imported = Array.isArray(parsed.repositories) ? parsed.repositories : []
  const currentRaw = await readFile(userDataPath('repositories.json'), 'utf8').catch(
    () => null
  )
  let current: unknown = null

  try {
    current = currentRaw ? JSON.parse(currentRaw) : null
  } catch {
    current = null
  }

  const currentList = isRecord(current) && Array.isArray(current.repositories)
    ? current.repositories
    : []
  const currentById = new Map<string, Record<string, unknown>>()

  for (const item of currentList) {
    if (isRecord(item) && typeof item.id === 'string') currentById.set(item.id, item)
  }

  const restored: Record<string, unknown>[] = []

  for (const value of imported) {
    const repository = normalizeRepository(value)
    if (!repository) continue

    const existing = currentById.get(repository.id)
    const existingPath =
      existing && typeof existing.localPath === 'string' ? existing.localPath : ''
    const importedPath =
      isRecord(value) && typeof value.localPath === 'string' ? value.localPath : ''
    // 只接受当前电脑存在、且目录名匹配的路径；不直接信任旧电脑的绝对路径。
    const importedPathMatches =
      Boolean(importedPath) &&
      basename(importedPath) === repository.name &&
      (await exists(importedPath))
    const localPath = existingPath || (importedPathMatches ? importedPath : '')

    restored.push({ ...repository, localPath })
  }

  await writeAtomic(
    'repositories.json',
    JSON.stringify({ repositories: restored }, null, 2)
  )
}

/** 移除指向未迁移 AI 产物的引用，避免导入后出现无法打开的附件。 */
const importAiSession = async (content: string): Promise<void> => {
  const parsed = JSON.parse(content) as { messages?: unknown; updatedAt?: unknown }

  if (!Array.isArray(parsed.messages)) {
    await writeAtomic('ai-assistant-session.json', content)
    return
  }

  const messages = parsed.messages.map((message) => {
    if (!isRecord(message) || !('artifacts' in message)) return message

    const rest: Record<string, unknown> = { ...message }
    delete rest.artifacts
    return rest
  })

  await writeAtomic(
    'ai-assistant-session.json',
    JSON.stringify({ ...parsed, messages }, null, 2)
  )
}

const getWindow = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
  BrowserWindow.fromWebContents(event.sender)

const showSaveDialog = async (
  window: BrowserWindow | null,
  options: Electron.SaveDialogOptions
): Promise<Electron.SaveDialogReturnValue> =>
  window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options)

const showOpenDialog = async (
  window: BrowserWindow | null,
  options: Electron.OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> =>
  window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options)

export const exportMigrationData = async (
  window: BrowserWindow | null
): Promise<MigrationExportResult> => {
  const result = await showSaveDialog(window, {
    title: '导出迁移数据',
    defaultPath: `develop-workbench-backup-${formatTimestamp()}.zip`,
    filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
  })

  if (result.canceled || !result.filePath) return { canceled: true }

  const zip = new JSZip()
  const files: string[] = []

  for (const name of MIGRATION_FILES) {
    const content = await readFile(userDataPath(name)).catch(() => null)
    if (content === null) continue

    zip.file(name, content)
    files.push(name)
  }

  const manifest: MigrationManifest = {
    app: APP_ID,
    version: app.getVersion(),
    exportedAt: new Date().toISOString(),
    files
  }

  zip.file(MANIFEST_FILE, JSON.stringify(manifest, null, 2))

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })

  await writeFile(result.filePath, buffer)

  return {
    canceled: false,
    path: result.filePath,
    bytes: buffer.length,
    files
  }
}

export const importMigrationData = async (
  window: BrowserWindow | null
): Promise<MigrationImportResult> => {
  const result = await showOpenDialog(window, {
    title: '导入迁移数据',
    properties: ['openFile'],
    filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true }
  }

  const archivePath = result.filePaths[0]
  const archiveStat = await stat(archivePath)

  if (archiveStat.size > MAX_ARCHIVE_BYTES) {
    throw new Error('迁移包超过 100 MB，暂不支持导入')
  }

  const archive = await readFile(archivePath)
  const zip = await JSZip.loadAsync(archive)
  const manifestContent = await parseZipJson(zip, MANIFEST_FILE)

  if (!manifestContent) throw new Error('迁移包缺少 manifest.json')

  let manifest: MigrationManifest

  try {
    manifest = JSON.parse(manifestContent) as MigrationManifest
  } catch {
    throw new Error('迁移包的 manifest.json 格式不正确')
  }

  if (manifest.app !== APP_ID || !Array.isArray(manifest.files)) {
    throw new Error('不是有效的开发工作台迁移包')
  }

  if (
    typeof manifest.version !== 'string' ||
    !VERSION_PATTERN.test(manifest.version)
  ) {
    throw new Error('迁移包版本格式不正确')
  }

  if (compareVersions(manifest.version, app.getVersion()) > 0) {
    throw new Error('迁移包版本高于当前应用，请先升级应用后再导入')
  }

  const contents = new Map<MigrationFile, string>()

  for (const name of MIGRATION_FILES) {
    const content = await parseZipJson(zip, name)
    if (content !== null) contents.set(name, content)
  }

  if (contents.size === 0) throw new Error('迁移包中没有可导入的数据')

  const files = Array.from(contents.keys())
  const timestamp = formatTimestamp()
  const backupDirectory = `migration-backup-${timestamp}`
  const confirmationOptions = {
    type: 'warning' as const,
    buttons: ['继续导入', '取消'],
    defaultId: 1,
    cancelId: 1,
    message: '导入迁移数据？',
    detail: `将覆盖当前应用数据。导入前会备份到 ${backupDirectory}，完成后需要重启应用。`
  }
  const confirmation = window
    ? await dialog.showMessageBox(window, confirmationOptions)
    : await dialog.showMessageBox(confirmationOptions)

  if (confirmation.response !== 0) return { canceled: true }

  const backupPath = await backupExistingFiles(files, timestamp)
  const skippedPaths: string[] = []

  try {
    for (const name of files) {
      const content = contents.get(name)
      if (content === undefined) continue

      if (name === 'preferences.json') {
        importPreferences(content)
        skippedPaths.push(
          '应用设置中的本机路径（IDE、Git、仓库根目录、CLI 路径、技能目录）'
        )
        continue
      }

      if (name === 'repositories.json') {
        await importRepositories(content)
        skippedPaths.push('仓库本地路径')
        continue
      }

      if (name === 'ai-assistant-session.json') {
        await importAiSession(content)
        skippedPaths.push('AI 生成文件引用')
        continue
      }

      await writeAtomic(name, content)
    }
  } catch (error) {
    const detail = getErrorMessage(error, '未知错误')
    throw new Error(
      `导入失败：${detail}${backupPath ? `。当前数据已备份到：${backupPath}` : ''}`
    )
  }

  return {
    canceled: false,
    files,
    backupPath,
    skippedPaths
  }
}

export const initializeMigration = (): void => {
  ipcMain.handle('migration:export', (event) =>
    exportMigrationData(getWindow(event))
  )
  ipcMain.handle('migration:import', (event) =>
    importMigrationData(getWindow(event))
  )
  ipcMain.handle('migration:restart', () => {
    app.relaunch()
    app.exit(0)
  })
}
