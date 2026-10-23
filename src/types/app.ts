/**
 * 应用与运行环境信息。
 * 由主进程读取并通过 preload 暴露给渲染进程。
 */
export interface AppInfo {
  platform: string
  appVersion: string
  electron: string
  chrome: string
  node: string
}
