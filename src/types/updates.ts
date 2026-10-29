/**
 * 从飞书云盘解析出的更新安装包。
 */
export interface UpdatePackage {
  /** 安装包文件名。 */
  name: string

  /** 飞书云盘文件 token。 */
  fileToken: string

  /** 飞书文件访问地址。 */
  url: string

  /** 平台标识。 */
  platform: 'mac' | 'win'

  /** 安装包扩展名。 */
  extension: 'dmg' | 'zip' | 'exe'
}

/**
 * 更新检测结果。
 */
export interface UpdateCheckResult {
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  package: UpdatePackage | null
  folderUrl: string
}

/**
 * 下载后的更新包信息。
 */
export interface UpdateDownloadResult {
  path: string
  name: string
}
