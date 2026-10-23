import type { AiConfigDocument } from '../types/ai-config'
import type { AppInfo } from '../types/app'
import type { LarkCliInfo, LarkLoginEvent, LarkLoginSession, LarkUser } from '../types/lark'
import type { MeegleCliInfo, MeegleLoginEvent, MeegleLoginSession, MeegleState } from '../types/meegle'
import type {
  CloneRepositoryInput,
  RepositoryCloneProgress,
  RepositoryScanResult,
  RepositoryState,
  UpdateRepositoryInput
} from '../types/repository'
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
  /** 读取 Meegle 状态和登录用户。 */
  getMeegleState: () => Promise<MeegleState>
  /** 保存 Meegle CLI 路径，传 null 恢复自动检测。 */
  setMeegleCliPath: (cliPath: string | null) => Promise<MeegleCliInfo>
  /** 只执行 Meegle CLI 自动检测。 */
  detectMeegleCliInfo: () => Promise<MeegleCliInfo>
  /** 选择 Meegle CLI 可执行文件。 */
  selectMeegleCliPath: (currentPath?: string | null) => Promise<string | null>
  /** 发起 Meegle 扫码登录。 */
  startMeegleLogin: () => Promise<MeegleLoginSession>
  /** 取消 Meegle 扫码登录。 */
  cancelMeegleLogin: () => Promise<void>
  /** 退出 Meegle 登录。 */
  logoutMeegle: () => Promise<MeegleState>
  /** 订阅 Meegle 扫码登录结果，返回取消订阅函数。 */
  onMeegleLoginEvent: (listener: (event: MeegleLoginEvent) => void) => () => void
  /** 读取代码仓库配置状态。 */
  getRepositoryState: () => Promise<RepositoryState>
  /** 刷新单个仓库的 Git 信息。 */
  refreshRepository: (repositoryId: string) => Promise<RepositoryState>
  /** 重新扫描代码根目录。 */
  refreshRootRepositories: () => Promise<RepositoryScanResult>
  /** 设置代码根目录。 */
  setRepositoryRoot: (rootPath: string) => Promise<RepositoryState>
  /** 清除代码根目录。 */
  clearRepositoryRoot: () => Promise<RepositoryState>
  /** 打开系统目录选择器。 */
  selectDirectory: (title?: string, defaultPath?: string) => Promise<string | null>
  /** 取消当前 Git 克隆。 */
  cancelRepositoryClone: () => Promise<void>
  /** 从 Git 克隆仓库。 */
  cloneRepository: (input: CloneRepositoryInput) => Promise<RepositoryState>
  /** 订阅 Git 克隆进度，返回取消订阅函数。 */
  onRepositoryCloneProgress: (listener: (progress: RepositoryCloneProgress) => void) => () => void
  /** 订阅后台扫描产生的仓库状态变化。 */
  onRepositoriesChanged: (listener: (state: RepositoryState) => void) => () => void
  /** 更新仓库信息。 */
  updateRepository: (repositoryId: string, patch: UpdateRepositoryInput) => Promise<RepositoryState>
  /** 移除仓库元数据。 */
  removeRepository: (repositoryId: string) => Promise<RepositoryState>
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
