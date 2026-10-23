import { app, clipboard, ipcMain } from 'electron'

/**
 * 注册应用级系统能力 IPC。
 * 当前包括运行时信息和系统剪贴板。
 */
export const initializeSystem = (): void => {
  // 应用与运行时信息。
  ipcMain.handle('app:get-info', () => ({
    platform: process.platform,
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }))

  // 将文本写入系统剪贴板，供渲染进程复制应用信息等只读内容。
  ipcMain.handle('clipboard:write-text', (_event, text: unknown) => {
    if (typeof text !== 'string') {
      throw new Error('Invalid clipboard content')
    }

    clipboard.writeText(text)
  })
}
