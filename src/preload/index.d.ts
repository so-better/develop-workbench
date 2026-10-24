import type { AiConfigDocument } from '../types/ai-config'
import type { AppInfo } from '../types/app'
import type { AuthExpiredEvent } from '../types/auth'
import type { GitInfo } from '../types/git'
import type {
  EmbeddedBrowserBounds,
  EmbeddedBrowserDownload,
  EmbeddedBrowserState
} from '../types/embedded-browser'
import type { IdeConfig, IdeConfigState, IdePresetId } from '../types/ide'
import type { RequirementBindingState } from '../types/bindings'
import type { LarkCliInfo, LarkLoginEvent, LarkLoginSession, LarkUser } from '../types/lark'
import type { LinkPreview } from '../types/link-preview'
import type { MeegleCliInfo, MeegleLoginEvent, MeegleLoginSession, MeegleState } from '../types/meegle'
import type {
  MeegleMyRequirements,
  MeegleProject,
  MeegleRequirementActivity,
  MeegleRequirementOwner,
  UpdateNodeInfoInput
} from '../types/requirements'
import type {
  CloneRepositoryInput,
  RepositoryBindingStatus,
  RepositoryBranchList,
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
  /** 获取链接预览信息。 */
  getLinkPreview: (url: string) => Promise<LinkPreview>
  /** 通过应用内浏览器登录态获取飞书 Markdown 图片。 */
  getMarkdownImage: (url: string) => Promise<string | null>
  /** 在应用内浏览器打开链接。 */
  openEmbeddedBrowser: (url: string) => Promise<boolean>
  /** 读取内嵌浏览器状态。 */
  getEmbeddedBrowserState: () => Promise<EmbeddedBrowserState>
  /** 关闭内嵌浏览器面板。 */
  closeEmbeddedBrowser: () => Promise<void>
  /** 内嵌浏览器刷新。 */
  reloadEmbeddedBrowser: () => Promise<void>
  /** 更新内嵌浏览器视图位置。 */
  setEmbeddedBrowserBounds: (bounds: EmbeddedBrowserBounds) => Promise<void>
  /** 临时隐藏/恢复内嵌浏览器，用于覆盖层和弹窗。 */
  setEmbeddedBrowserSuppressed: (suppressed: boolean) => Promise<void>
  /** 读取内嵌浏览器下载列表。 */
  getEmbeddedBrowserDownloads: () => Promise<EmbeddedBrowserDownload[]>
  /** 取消下载。 */
  cancelEmbeddedBrowserDownload: (downloadId: string) => Promise<void>
  /** 暂停下载。 */
  pauseEmbeddedBrowserDownload: (downloadId: string) => Promise<void>
  /** 继续下载。 */
  resumeEmbeddedBrowserDownload: (downloadId: string) => Promise<void>
  /** 重试中断的下载。 */
  retryEmbeddedBrowserDownload: (downloadId: string) => Promise<void>
  /** 打开已下载文件。 */
  openEmbeddedBrowserDownload: (downloadId: string) => Promise<void>
  /** 在文件管理器中显示下载文件。 */
  showEmbeddedBrowserDownload: (downloadId: string) => Promise<void>
  /** 清除已结束的下载记录。 */
  clearEmbeddedBrowserDownloads: () => Promise<void>
  /** 订阅下载列表变化。 */
  onEmbeddedBrowserDownloads: (
    listener: (downloads: EmbeddedBrowserDownload[]) => void
  ) => () => void
  /** 订阅内嵌浏览器状态。 */
  onEmbeddedBrowserState: (
    listener: (state: EmbeddedBrowserState) => void
  ) => () => void
  /** 订阅主进程发起的关闭请求。 */
  onEmbeddedBrowserCloseRequest: (listener: () => void) => () => void
  /** 读取 IDE 配置。 */
  getIdeConfig: () => Promise<IdeConfigState>
  /** 保存 IDE 配置。 */
  setIdeConfig: (config: IdeConfig) => Promise<IdeConfigState>
  /** 自动检测 Qoder。 */
  detectIdeConfig: (presetId: IdePresetId) => Promise<IdeConfig>
  /** 检查 IDE 配置并准备仓库分支。 */
  prepareRepositoryInIde: (
    repositoryId: string,
    branchName: string
  ) => Promise<{
    switched: boolean
    pulled: boolean
    hasUpstream: boolean
  }>
  /** 启动 IDE 打开仓库。 */
  launchRepositoryInIde: (repositoryId: string) => Promise<void>
  /** 选择 IDE 可执行文件。 */
  selectIdeCommand: (
    currentPath?: string | null,
    presetId?: IdePresetId
  ) => Promise<string | null>
  /** 将文本写入系统剪贴板。 */
  copyText: (text: string) => Promise<void>
  /** 读取 Git 路径、来源和版本。 */
  getGitInfo: () => Promise<GitInfo>
  /** 只执行 Git 自动检测。 */
  detectGitInfo: () => Promise<GitInfo>
  /** 保存 Git 路径，传 null 恢复自动检测。 */
  setGitPath: (gitPath: string | null) => Promise<GitInfo>
  /** 打开系统文件选择器选择 Git。 */
  selectGitPath: (currentPath?: string | null) => Promise<string | null>
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
  /** 订阅 CLI 授权过期事件，返回取消订阅函数。 */
  onAuthExpired: (listener: (event: AuthExpiredEvent) => void) => () => void
  /** 读取当前 Meegle 用户负责的需求，并按迭代分组。 */
  getMyRequirements: () => Promise<MeegleMyRequirements>
  /** 读取用户可访问的 Meegle 空间。 */
  listMeegleProjects: () => Promise<MeegleProject[]>
  /** 切换当前 Meegle 空间。 */
  setMeegleProject: (projectKey: string) => Promise<MeegleProject>
  /** 按姓名或邮箱搜索 Meegle 用户。 */
  searchRequirementUsers: (keyword: string) => Promise<MeegleRequirementOwner[]>
  /** 更新需求描述。 */
  updateRequirementDescription: (workItemId: string, content: string) => Promise<void>
  /** 读取需求的代码仓库绑定。 */
  getRequirementBindings: (requirementId: string) => Promise<RequirementBindingState>
  /** 新增需求仓库绑定。 */
  addRequirementBinding: (
    requirementId: string,
    repositoryId: string,
    branchName: string
  ) => Promise<RequirementBindingState>
  /** 绑定轻舟工作项。 */
  addQingzhouRequirementBinding: (
    requirementId: string,
    repositoryId: string
  ) => Promise<RequirementBindingState>
  /** 同步轻舟工作项分支。 */
  syncQingzhouRequirementBinding: (
    requirementId: string,
    bindingId: string
  ) => Promise<RequirementBindingState>
  /** 解除需求仓库绑定。 */
  removeRequirementBinding: (
    requirementId: string,
    bindingId: string
  ) => Promise<RequirementBindingState>
  /** 读取需求流程节点和评论。 */
  getRequirementActivity: (workItemId: string) => Promise<MeegleRequirementActivity>
  /** 发表需求评论。 */
  addRequirementComment: (
    workItemId: string,
    content: string,
    notifyUserKeys?: string[]
  ) => Promise<void>
  /** 完成或回滚需求节点。 */
  transitionRequirementNode: (
    workItemId: string,
    nodeId: string,
    action: 'confirm' | 'rollback',
    rollbackReason?: string
  ) => Promise<void>
  /** 更新节点排期、估分和实际工时。 */
  updateRequirementNode: (
    workItemId: string,
    nodeId: string,
    input: UpdateNodeInfoInput
  ) => Promise<void>
  /** 读取代码仓库配置状态。 */
  getRepositoryState: () => Promise<RepositoryState>
  /** 刷新单个仓库的 Git 信息。 */
  refreshRepository: (repositoryId: string) => Promise<RepositoryState>
  /** 读取指定仓库的本地和远程分支。 */
  listRepositoryBranches: (
    repositoryId: string,
    fetchRemote?: boolean
  ) => Promise<RepositoryBranchList>
  /** 读取需求仓库绑定的实时状态。 */
  getRepositoryBindingStatus: (
    repositoryId: string,
    branchName: string,
    iterationBranch?: string | null
  ) => Promise<RepositoryBindingStatus>
  /** 从基线分支创建本地开发分支。 */
  createRepositoryBranch: (
    repositoryId: string,
    branchName: string,
    baseBranch: string
  ) => Promise<void>
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
