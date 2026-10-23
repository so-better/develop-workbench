import type { AiConfigDocument } from '../types/ai-config'
import type { AppInfo } from '../types/app'
import type { LarkCliInfo, LarkLoginEvent, LarkLoginSession, LarkUser } from '../types/lark'
import type { ThemeMode, ThemeState } from '../types/theme'

export interface ElectronAPI {
  platform: string
  /** 获取应用与运行时版本信息。 */
  getAppInfo: () => Promise<AppInfo>
  /** 将文本写入系统剪贴板。 */
  copyText: (text: string) => Promise<void>
  /** 读取 lark-cli 当前登录用户，未登录时返回 null。 */
  getLarkUser: () => Promise<LarkUser | null>
  /** 查询 lark-cli 路径、来源和版本。 */
  getLarkCliInfo: () => Promise<LarkCliInfo>
  /** 只执行自动检测，不修改已保存的路径。 */
  detectLarkCliInfo: () => Promise<LarkCliInfo>
  /** 保存 lark-cli 路径，传 null 恢复自动检测。 */
  setLarkCliPath: (cliPath: string | null) => Promise<LarkCliInfo>
  /** 打开系统文件选择器选择 lark-cli，优先定位到当前路径所在目录。 */
  selectLarkCliPath: (currentPath?: string | null) => Promise<string | null>
  /** 发起飞书扫码登录，返回二维码。 */
  startLarkLogin: () => Promise<LarkLoginSession>
  /** 取消当前扫码登录。 */
  cancelLarkLogin: () => Promise<void>
  /** 退出 lark-cli 当前飞书登录态。 */
  logoutLark: () => Promise<void>
  /** 订阅扫码登录结果，返回取消订阅函数。 */
  onLarkLoginEvent: (listener: (event: LarkLoginEvent) => void) => () => void
  /** 读取 AI 配置文件。 */
  readAiConfig: () => Promise<AiConfigDocument>
  /** 校验并写入 AI 配置文件。 */
  writeAiConfig: (content: string) => Promise<AiConfigDocument>
  /** 读取当前主题模式和实际明暗状态。 */
  getTheme: () => Promise<ThemeState>
  /** 切换主题模式并返回最新状态。 */
  setTheme: (mode: ThemeMode) => Promise<ThemeState>
  /** 订阅主题变化，返回取消订阅函数。 */
  onThemeChange: (listener: (state: ThemeState) => void) => () => void
  /** 订阅主窗口重新显示事件，返回取消订阅函数。 */
  onWindowShown: (listener: () => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}

export {}
