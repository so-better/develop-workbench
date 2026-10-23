import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { ThemeMode, ThemeState } from '../types/theme'

export interface AppInfo {
  platform: string
  appVersion: string
  electron: string
  chrome: string
  node: string
}

const electronAPI = {
  // 当前运行平台，渲染进程可在首次渲染时同步读取。
  platform: process.platform,

  /**
   * 获取应用版本及 Electron、Chromium、Node.js 运行时信息。
   */
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:get-info'),

  /**
   * 从主进程读取当前主题模式和实际明暗状态。
   */
  getTheme: (): Promise<ThemeState> => ipcRenderer.invoke('theme:get'),

  /**
   * 请求主进程切换主题模式，并返回切换后的主题状态。
   */
  setTheme: (mode: ThemeMode): Promise<ThemeState> => ipcRenderer.invoke('theme:set', mode),

  /**
   * 订阅主进程广播的主题变化。
   * 返回取消订阅函数，供 React effect 在清理阶段调用。
   */
  onThemeChange: (listener: (state: ThemeState) => void): (() => void) => {
    /**
     * 将 Electron IPC 事件转换为只暴露主题状态的业务回调。
     */
    const handler = (_event: IpcRendererEvent, state: ThemeState): void => {
      listener(state)
    }

    ipcRenderer.on('theme:changed', handler)

    return () => {
      ipcRenderer.removeListener('theme:changed', handler)
    }
  }
}

// 在隔离上下文中暴露受控 API，避免渲染进程直接访问 ipcRenderer。
contextBridge.exposeInMainWorld('electron', electronAPI)
