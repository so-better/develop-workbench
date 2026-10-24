/**
 * Git 可执行文件来源。
 * settings 为用户手动设置，environment 为环境变量，auto 为自动探测。
 */
export type GitPathSource = 'settings' | 'environment' | 'auto'

/**
 * Git 可执行文件检测结果。
 */
export interface GitInfo {
  path: string | null
  source: GitPathSource | null
  version: string | null
  available: boolean
}
