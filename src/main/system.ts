import { app, clipboard, ipcMain, shell } from 'electron'

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

  // 打开受信任的外部链接或飞书客户端协议。
  ipcMain.handle('system:open-external-url', async (_event, rawUrl: unknown) => {
    if (typeof rawUrl !== 'string') throw new Error('链接格式不合法')

    let url: URL

    try {
      url = new URL(rawUrl)
    } catch {
      throw new Error('链接格式不合法')
    }

    if (!['http:', 'https:', 'feishu:', 'lark:'].includes(url.protocol)) {
      throw new Error('不支持该链接协议')
    }

    await shell.openExternal(url.toString())
  })

  // 将文本写入系统剪贴板，供渲染进程复制应用信息等只读内容。
  ipcMain.handle('clipboard:write-text', (_event, text: unknown) => {
    if (typeof text !== 'string') {
      throw new Error('Invalid clipboard content')
    }

    clipboard.writeText(text)
  })
}
