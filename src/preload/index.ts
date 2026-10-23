import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AiConfigDocument } from '../types/ai-config'
import type { AppInfo } from '../types/app'
import type { LarkCliInfo, LarkUser } from '../types/lark'
import type { ThemeMode, ThemeState } from '../types/theme'

const electronAPI = {
  // 当前运行平台，渲染进程可在首次渲染时同步读取。
  platform: process.platform,

  /**
   * 获取应用版本及 Electron、Chromium、Node.js 运行时信息。
   */
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:get-info'),

  /**
   * 将文本写入系统剪贴板。
   */
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write-text', text),

  /**
   * 读取 lark-cli 当前登录的飞书用户。
   * 未登录或 lark-cli 不可用时返回 null。
   */
  getLarkUser: (): Promise<LarkUser | null> => ipcRenderer.invoke('lark:get-user'),

  /**
   * 查询 lark-cli 的路径、来源和版本。
   */
  getLarkCliInfo: (): Promise<LarkCliInfo> => ipcRenderer.invoke('lark:get-cli-info'),

  /**
   * 只执行自动检测，不修改已保存的路径。
   */
  detectLarkCliInfo: (): Promise<LarkCliInfo> => ipcRenderer.invoke('lark:detect-cli-info'),

  /**
   * 保存 lark-cli 路径；传 null 恢复自动检测。
   */
  setLarkCliPath: (cliPath: string | null): Promise<LarkCliInfo> =>
    ipcRenderer.invoke('lark:set-cli-path', cliPath),

  /**
   * 打开系统文件选择器选择 lark-cli。
   * 传入当前路径时优先定位到其所在目录。
   */
  selectLarkCliPath: (currentPath?: string | null): Promise<string | null> =>
    ipcRenderer.invoke('lark:select-cli-path', currentPath),

  /**
   * 读取 AI 配置文件内容。
   */
  readAiConfig: (): Promise<AiConfigDocument> => ipcRenderer.invoke('ai-config:read'),

  /**
   * 校验并保存 AI 配置文件。
   */
  writeAiConfig: (content: string): Promise<AiConfigDocument> => ipcRenderer.invoke('ai-config:write', content),

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
  },

  /**
   * 订阅主窗口重新显示事件，用于刷新登录状态。
   */
  onWindowShown: (listener: () => void): (() => void) => {
    /**
     * 主进程不向渲染进程传递额外参数。
     */
    const handler = (): void => {
      listener()
    }

    ipcRenderer.on('window:shown', handler)

    return () => {
      ipcRenderer.removeListener('window:shown', handler)
    }
  }
}

// 在隔离上下文中暴露受控 API，避免渲染进程直接访问 ipcRenderer。
contextBridge.exposeInMainWorld('electron', electronAPI)
