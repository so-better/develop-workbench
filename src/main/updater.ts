/**
 * 基于飞书云盘的版本检测与安装包下载。
 * 安装包命名约定：develop-workbench-<版本>-<mac|win>.<dmg|zip|exe>
 */
import { app, ipcMain, shell } from 'electron'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative } from 'node:path'
import {
  createGeneratedDownload,
  getCompletedUpdateDownloadPath
} from './embedded-browser'
import { runLarkCli } from './lark'
import { getPreferences, updatePreferences } from './preferences'
import type {
  UpdateCheckResult,
  UpdateDownloadResult,
  UpdatePackage
} from '../types/updates'

const UPDATE_FOLDER_TOKEN = 'DITBfJjUXlmHofd1x2HczjVSnzb'
const UPDATE_FOLDER_URL =
  'https://gaor4awyz1u.feishu.cn/drive/folder/DITBfJjUXlmHofd1x2HczjVSnzb'
const UPDATE_FILE_PATTERN =
  /^develop-workbench-(\d+\.\d+\.\d+)-(mac|win)\.(dmg|zip|exe)$/i
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000
let updateCheckPromise: Promise<UpdateCheckResult> | null = null

/** 下载和目录解析共用命名校验；不剥离路径，避免非法输入被悄悄转换成合法包名。 */
const parsePackageName = (name: unknown): {
  version: string
  platform: UpdatePackage['platform']
  extension: UpdatePackage['extension']
} | null => {
  if (typeof name !== 'string') return null
  const match = name.match(UPDATE_FILE_PATTERN)

  // JS 的 $ 可以匹配末尾换行前的位置，必须额外确认整个文件名都被匹配。
  if (!match || match[0] !== name) return null

  const platform = match[2].toLowerCase() as UpdatePackage['platform']
  const extension = match[3].toLowerCase() as UpdatePackage['extension']
  if ((platform === 'mac' && extension === 'exe') ||
      (platform === 'win' && extension === 'dmg')) return null

  return { version: match[1], platform, extension }
}

interface DriveFile {
  name?: string
  token?: string
  url?: string
  type?: string
}

interface DriveFileListResponse {
  data?: {
    files?: DriveFile[] | null
  }
}

const compareVersions = (left: string, right: string): number => {
  const leftParts = left.split('.').map((part) => Number(part) || 0)
  const rightParts = right.split('.').map((part) => Number(part) || 0)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0
    const rightValue = rightParts[index] ?? 0

    if (leftValue !== rightValue) return leftValue > rightValue ? 1 : -1
  }

  return 0
}

const parsePackages = (files: DriveFile[]): Array<{
  version: string
  package: UpdatePackage
}> =>
  files.flatMap((file) => {
    if (file.type !== 'file' || !file.name || !file.token) return []

    const parsedName = parsePackageName(file.name)

    if (!parsedName) return []

    return [
      {
        version: parsedName.version,
        package: {
          name: file.name,
          fileToken: file.token,
          url: file.url ?? '',
          platform: parsedName.platform,
          extension: parsedName.extension
        }
      }
    ]
  })

const selectPackage = (
  packages: UpdatePackage[],
  platform: NodeJS.Platform
): UpdatePackage | null => {
  if (platform === 'darwin') {
    return (
      packages.find((item) => item.extension === 'dmg') ??
      packages.find((item) => item.extension === 'zip') ??
      null
    )
  }

  if (platform === 'win32') {
    return (
      packages.find((item) => item.extension === 'exe') ??
      packages.find((item) => item.extension === 'zip') ??
      null
    )
  }

  return null
}

const performUpdateCheck = async (): Promise<UpdateCheckResult> => {
  const output = await runLarkCli(
    [
      'drive',
      'files',
      'list',
      '--folder-token',
      UPDATE_FOLDER_TOKEN,
      '--page-size',
      '200',
      '--format',
      'json'
    ],
    { timeoutMs: 30_000 }
  )
  const parsed = JSON.parse(output) as DriveFileListResponse
  const files = parsed.data?.files

  if (!Array.isArray(files)) {
    throw new Error('无法读取飞书更新目录')
  }

  const parsedPackages = parsePackages(files)

  if (parsedPackages.length === 0) {
    throw new Error('飞书更新目录中没有可识别的安装包')
  }

  const latestVersion = parsedPackages.reduce(
    (latest, item) =>
      compareVersions(item.version, latest) > 0 ? item.version : latest,
    parsedPackages[0].version
  )
  const currentVersion = app.getVersion()
  const platformPackages = parsedPackages
    .filter((item) => item.version === latestVersion)
    .map((item) => item.package)

  return {
    currentVersion,
    latestVersion,
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
    package: selectPackage(platformPackages, process.platform),
    folderUrl: UPDATE_FOLDER_URL,
    skippedVersion: getPreferences().skippedUpdateVersion ?? null
  }
}

/** 合并并发检查，避免窗口连续显示时同时启动多个 lark-cli 进程。 */
export const checkForUpdates = async (): Promise<UpdateCheckResult> => {
  if (updateCheckPromise) return updateCheckPromise

  const pending = performUpdateCheck()
  updateCheckPromise = pending

  try {
    return await pending
  } finally {
    if (updateCheckPromise === pending) updateCheckPromise = null
  }
}

/** 记录用户选择稍后更新的版本，后续自动检查不再弹窗。 */
export const skipUpdateVersion = (value: unknown): string => {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.trim())) {
    throw new Error('版本号不合法')
  }

  const version = value.trim()

  updatePreferences({ skippedUpdateVersion: version })

  return version
}

export const downloadUpdatePackage = async (
  value: unknown
): Promise<UpdateDownloadResult> => {
  if (!value || typeof value !== 'object') {
    throw new Error('更新包参数不合法')
  }

  const item = value as Partial<UpdatePackage>
  const fileName = typeof item.name === 'string' ? item.name : ''
  const parsedName = parsePackageName(fileName)

  if (
    !parsedName ||
    item.platform !== parsedName.platform ||
    item.extension !== parsedName.extension ||
    typeof item.fileToken !== 'string' ||
    !/^[a-zA-Z0-9_-]+$/.test(item.fileToken)
  ) {
    throw new Error('更新包参数不合法')
  }

  const downloadsPath = app.getPath('downloads')
  const targetPath = join(downloadsPath, fileName)

  // 更新包只能落在下载目录的直接子路径，不能指向目录本身、父目录或其他盘符。
  const targetRelativePath = relative(downloadsPath, targetPath)
  if (isAbsolute(targetRelativePath) || targetRelativePath !== fileName) {
    throw new Error('更新包路径不合法')
  }

  await mkdir(downloadsPath, { recursive: true })

  const tempPrefix = `.${fileName}.`
  const staleEntries = await readdir(downloadsPath).catch(() => [] as string[])

  await Promise.all(
    staleEntries
      .filter(
        (entry) => entry.startsWith(tempPrefix) && entry.endsWith('.tmp')
      )
      .map((entry) =>
        rm(join(downloadsPath, entry), { force: true }).catch(() => undefined)
      )
  )

  const download = createGeneratedDownload({
    filename: fileName,
    path: targetPath,
    size: 0,
    source: typeof item.url === 'string' ? item.url : '',
    origin: 'update'
  })
  const getDownloadedBytes = async (): Promise<number> => {
    // lark-cli 会先写入隐藏临时文件，成功后再重命名。
    // 不读取目标文件，避免同名旧安装包干扰进度。
    const entries = await readdir(downloadsPath).catch(() => [] as string[])
    const sizes = await Promise.all(
      entries
        .filter(
          (entry) => entry.startsWith(tempPrefix) && entry.endsWith('.tmp')
        )
        .map((entry) =>
          stat(join(downloadsPath, entry))
            .then((entryStat) => entryStat.size)
            .catch(() => 0)
        )
    )

    return sizes.reduce((total, size) => total + size, 0)
  }
  const pollTimer = setInterval(() => {
    getDownloadedBytes()
      .then((bytes) => download.update(bytes))
      .catch(() => undefined)
  }, 500)

  try {
    await runLarkCli(
      [
        'drive',
        '+download',
        '--file-token',
        item.fileToken,
        '--output',
        `./${fileName}`,
        '--overwrite',
        '--format',
        'json'
      ],
      { cwd: downloadsPath, timeoutMs: DOWNLOAD_TIMEOUT_MS }
    )

    const fileStat = await stat(targetPath).catch(() => null)

    if (!fileStat) {
      throw new Error('安装包下载完成但文件不存在')
    }

    download.complete(targetPath, fileStat.size)
  } catch (downloadError) {
    download.fail()

    const entries = await readdir(downloadsPath).catch(() => [] as string[])

    await Promise.all(
      entries
        .filter(
          (entry) => entry.startsWith(tempPrefix) && entry.endsWith('.tmp')
        )
        .map((entry) =>
          rm(join(downloadsPath, entry), { force: true }).catch(() => undefined)
        )
    )

    throw downloadError
  } finally {
    clearInterval(pollTimer)
  }

  return {
    path: targetPath,
    name: fileName,
    downloadId: download.id
  }
}

export const installUpdateDownload = async (
  downloadId: unknown
): Promise<void> => {
  if (typeof downloadId !== 'string' || !downloadId.trim()) {
    throw new Error('下载 ID 不合法')
  }

  const filePath = getCompletedUpdateDownloadPath(downloadId)
  const downloadsPath = app.getPath('downloads')
  const relativePath = relative(downloadsPath, filePath)
  const extension = extname(filePath).toLowerCase()

  if (
    !relativePath ||
    relativePath.startsWith('..') ||
    isAbsolute(relativePath)
  ) {
    throw new Error('安装包路径不合法')
  }

  if (extension !== '.dmg' && extension !== '.exe') {
    throw new Error('当前安装包需要手动解压安装')
  }

  const fileStat = await stat(filePath).catch(() => null)

  if (!fileStat?.isFile()) {
    throw new Error('安装包文件不存在')
  }

  const error = await shell.openPath(filePath)

  if (error) {
    throw new Error(error)
  }

  app.quit()
}

/**
 * 注册版本检测、更新包下载和安装 IPC。
 */
export const initializeUpdater = (): void => {
  ipcMain.handle('updater:check', () => checkForUpdates())
  ipcMain.handle('updater:skip-version', (_event, version: unknown) =>
    skipUpdateVersion(version)
  )
  ipcMain.handle('updater:download', (_event, item: unknown) =>
    downloadUpdatePackage(item)
  )
  ipcMain.handle('updater:install', (_event, downloadId: unknown) =>
    installUpdateDownload(downloadId)
  )
}
