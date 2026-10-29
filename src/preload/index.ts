import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AiConfigDocument } from '../types/ai-config'
import type {
  AiChatEvent,
  AiChatStartInput,
  AiAttachmentFilePayload,
  AiChatAttachment,
  AiChatStartResult,
  AiConfigStatus,
  AiArtifactStats,
  AiAssistantSessionState,
  AiStoredMessage
} from '../types/ai'
import type { AppInfo } from '../types/app'
import type { ProductGuideState } from '../types/product-guide'
import type { QuickNoteState } from '../types/quick-note'
import type {
  UpdateCheckResult,
  UpdateDownloadResult,
  UpdatePackage
} from '../types/updates'
import type {
  StorageCleanupKind,
  StorageCleanupStats
} from '../types/storage-cleanup'
import type { AuthExpiredEvent } from '../types/auth'
import type { GitInfo } from '../types/git'
import type {
  EmbeddedBrowserBounds,
  EmbeddedBrowserDownload,
  EmbeddedBrowserState
} from '../types/embedded-browser'
import type { IdeConfig, IdeConfigState, IdePresetId } from '../types/ide'
import type { RequirementBindingState } from '../types/bindings'
import type {
  DefectRole,
  DefectTransitionFieldValue,
  DefectTransitions,
  MeegleDefectComments,
  MeegleMyDefects,
  UpdateDefectAssigneesInput
} from '../types/defects'
import type { RequirementPersonalStatusState } from '../types/requirement-status'
import type {
  LarkCliInfo,
  LarkChatSearchResult,
  LarkDocSearchResult,
  LarkMessageSearchResult,
  LarkLoginEvent,
  LarkLoginSession,
  LarkUser
} from '../types/lark'
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
import type { SiteInput, SiteState } from '../types/sites'
import type { SkillSettingsState } from '../types/skills'
import type {
  SubmitWeeklyReportInput,
  WeeklyReportState
} from '../types/weekly-report'

const electronAPI = {
  // 当前运行平台，渲染进程可在首次渲染时同步读取。
  platform: process.platform,

  /**
   * 打开系统协议链接，用于飞书消息等外部客户端跳转。
   */
  openExternalUrl: (url: string): Promise<void> =>
    ipcRenderer.invoke('system:open-external-url', url),

  /**
   * 获取应用版本及 Electron、Chromium、Node.js 运行时信息。
   */
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:get-info'),

  /** 读取产品使用手册的当前版本和已读版本。 */
  getProductGuideState: (): Promise<ProductGuideState> =>
    ipcRenderer.invoke('product-guide:get-state'),

  /** 将当前产品手册版本标记为已读。 */
  markProductGuideSeen: (): Promise<void> =>
    ipcRenderer.invoke('product-guide:mark-seen'),

  /** 读取待办简记。 */
  getQuickNoteState: (): Promise<QuickNoteState> =>
    ipcRenderer.invoke('quick-notes:get-state'),

  /** 新增一条待办简记。 */
  addQuickNote: (text: string): Promise<QuickNoteState> =>
    ipcRenderer.invoke('quick-notes:add', text),

  /** 更新待办完成状态。 */
  setQuickNoteDone: (id: string, done: boolean): Promise<QuickNoteState> =>
    ipcRenderer.invoke('quick-notes:set-done', id, done),

  /** 删除一条待办。 */
  removeQuickNote: (id: string): Promise<QuickNoteState> =>
    ipcRenderer.invoke('quick-notes:remove', id),

  /** 清空已完成待办。 */
  clearCompletedQuickNotes: (): Promise<QuickNoteState> =>
    ipcRenderer.invoke('quick-notes:clear-completed'),

  /** 订阅主进程转发的待办简记打开事件。 */
  onQuickNotesOpen: (listener: () => void): (() => void) => {
    const handler = (): void => {
      listener()
    }

    ipcRenderer.on('quick-notes:open', handler)

    return () => {
      ipcRenderer.removeListener('quick-notes:open', handler)
    }
  },

  /**
   * 获取链接预览信息。
   */
  getLinkPreview: (url: string): Promise<LinkPreview> =>
    ipcRenderer.invoke('link-preview:get', url),

  /**
   * 通过应用内浏览器登录态获取飞书 Markdown 图片。
   */
  getMarkdownImage: (url: string): Promise<string | null> =>
    ipcRenderer.invoke('markdown:get-image', url),

  openEmbeddedBrowser: (
    url: string,
    options?: { navigation?: boolean }
  ): Promise<boolean> =>
    ipcRenderer.invoke('embedded-browser:open', url, options),

  getEmbeddedBrowserState: (): Promise<EmbeddedBrowserState> =>
    ipcRenderer.invoke('embedded-browser:get-state'),

  /** 在系统默认浏览器中打开当前页面。 */
  openEmbeddedBrowserExternal: (): Promise<void> =>
    ipcRenderer.invoke('embedded-browser:open-external'),

  closeEmbeddedBrowser: (): Promise<void> =>
    ipcRenderer.invoke('embedded-browser:close'),

  reloadEmbeddedBrowser: (): Promise<void> =>
    ipcRenderer.invoke('embedded-browser:reload'),

  /** 打开或关闭内嵌浏览器开发者工具。 */
  toggleEmbeddedBrowserDevTools: (): Promise<void> =>
    ipcRenderer.invoke('embedded-browser:toggle-devtools'),

  goBackEmbeddedBrowser: (): Promise<void> =>
    ipcRenderer.invoke('embedded-browser:go-back'),

  goForwardEmbeddedBrowser: (): Promise<void> =>
    ipcRenderer.invoke('embedded-browser:go-forward'),

  setEmbeddedBrowserBounds: (bounds: EmbeddedBrowserBounds): Promise<void> =>
    ipcRenderer.invoke('embedded-browser:set-bounds', bounds),

  setEmbeddedBrowserSuppressed: (suppressed: boolean): Promise<void> =>
    ipcRenderer.invoke('embedded-browser:set-suppressed', suppressed),

  getEmbeddedBrowserDownloads: (): Promise<EmbeddedBrowserDownload[]> =>
    ipcRenderer.invoke('embedded-browser:get-downloads'),

  cancelEmbeddedBrowserDownload: (downloadId: string): Promise<void> =>
    ipcRenderer.invoke('embedded-browser:cancel-download', downloadId),

  pauseEmbeddedBrowserDownload: (downloadId: string): Promise<void> =>
    ipcRenderer.invoke('embedded-browser:pause-download', downloadId),

  resumeEmbeddedBrowserDownload: (downloadId: string): Promise<void> =>
    ipcRenderer.invoke('embedded-browser:resume-download', downloadId),

  retryEmbeddedBrowserDownload: (downloadId: string): Promise<void> =>
    ipcRenderer.invoke('embedded-browser:retry-download', downloadId),

  openEmbeddedBrowserDownload: (downloadId: string): Promise<void> =>
    ipcRenderer.invoke('embedded-browser:open-download', downloadId),

  showEmbeddedBrowserDownload: (downloadId: string): Promise<void> =>
    ipcRenderer.invoke('embedded-browser:show-download', downloadId),

  clearEmbeddedBrowserDownloads: (): Promise<void> =>
    ipcRenderer.invoke('embedded-browser:clear-downloads'),

  onEmbeddedBrowserDownloads: (
    listener: (downloads: EmbeddedBrowserDownload[]) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      downloads: EmbeddedBrowserDownload[]
    ): void => {
      listener(downloads)
    }

    ipcRenderer.on('embedded-browser:downloads', handler)

    return () => {
      ipcRenderer.removeListener('embedded-browser:downloads', handler)
    }
  },

  onEmbeddedBrowserState: (
    listener: (state: EmbeddedBrowserState) => void
  ): (() => void) => {
    const handler = (_event: IpcRendererEvent, state: EmbeddedBrowserState): void => {
      listener(state)
    }

    ipcRenderer.on('embedded-browser:state', handler)

    return () => {
      ipcRenderer.removeListener('embedded-browser:state', handler)
    }
  },

  onEmbeddedBrowserCloseRequest: (listener: () => void): (() => void) => {
    const handler = (): void => {
      listener()
    }

    ipcRenderer.on('embedded-browser:request-close', handler)

    return () => {
      ipcRenderer.removeListener('embedded-browser:request-close', handler)
    }
  },

  /**
   * 读取 IDE 配置。
   */
  getIdeConfig: (): Promise<IdeConfigState> => ipcRenderer.invoke('ide:get'),

  /**
   * 保存 IDE 配置。
   */
  setIdeConfig: (config: IdeConfig): Promise<IdeConfigState> =>
    ipcRenderer.invoke('ide:set', config),

  /**
   * 自动检测 Qoder。
   */
  detectIdeConfig: (presetId: IdePresetId): Promise<IdeConfig> =>
    ipcRenderer.invoke('ide:detect', presetId),

  /**
   * 检查 IDE 配置并准备仓库分支。
   */
  prepareRepositoryInIde: (
    repositoryId: string,
    branchName: string
  ): Promise<{
    switched: boolean
    pulled: boolean
    hasUpstream: boolean
  }> => ipcRenderer.invoke('ide:prepare-repository', repositoryId, branchName),

  /**
   * 启动 IDE 打开仓库。
   */
  launchRepositoryInIde: (
    repositoryId: string,
    chatPrompt?: string
  ): Promise<void> =>
    ipcRenderer.invoke('ide:launch-repository', repositoryId, chatPrompt),

  /**
   * 选择 IDE 可执行文件。
   */
  selectIdeCommand: (
    currentPath?: string | null,
    presetId?: IdePresetId
  ): Promise<string | null> =>
    ipcRenderer.invoke('ide:select-command', currentPath, presetId),

  /**
   * 读取 Git 路径、来源和版本。
   */
  getGitInfo: (): Promise<GitInfo> => ipcRenderer.invoke('git:get-info'),

  /**
   * 只执行 Git 自动检测，不修改已保存路径。
   */
  detectGitInfo: (): Promise<GitInfo> => ipcRenderer.invoke('git:detect-info'),

  /**
   * 保存 Git 路径；传 null 恢复自动检测。
   */
  setGitPath: (gitPath: string | null): Promise<GitInfo> =>
    ipcRenderer.invoke('git:set-path', gitPath),

  /**
   * 选择 Git 可执行文件。
   */
  selectGitPath: (currentPath?: string | null): Promise<string | null> =>
    ipcRenderer.invoke('git:select-path', currentPath),

  /**
   * 将文本写入系统剪贴板。
   */
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write-text', text),

  /**
   * 读取 lark-cli 当前登录的飞书用户。
   * 未登录或 lark-cli 不可用时返回 null。
   */
  getLarkUser: (): Promise<LarkUser | null> => ipcRenderer.invoke('lark:get-user'),

  /** 搜索飞书云文档。 */
  searchLarkDocs: (query: string): Promise<LarkDocSearchResult[]> =>
    ipcRenderer.invoke('lark:search-docs', query),

  /** 搜索飞书消息。 */
  searchLarkMessages: (query: string): Promise<LarkMessageSearchResult[]> =>
    ipcRenderer.invoke('lark:search-messages', query),

  /** 搜索飞书群聊。 */
  searchLarkChats: (query: string): Promise<LarkChatSearchResult[]> =>
    ipcRenderer.invoke('lark:search-chats', query),

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
   * 发起飞书扫码登录，返回二维码 data URL。
   */
  startLarkLogin: (): Promise<LarkLoginSession> => ipcRenderer.invoke('lark:start-login'),

  /**
   * 取消当前扫码登录。
   */
  cancelLarkLogin: (): Promise<void> => ipcRenderer.invoke('lark:cancel-login'),

  /**
   * 退出 lark-cli 当前飞书登录态。
   */
  logoutLark: (): Promise<void> => ipcRenderer.invoke('lark:logout'),

  /**
   * 订阅扫码登录结果，返回取消订阅函数。
   */
  onLarkLoginEvent: (listener: (event: LarkLoginEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, result: LarkLoginEvent): void => {
      listener(result)
    }

    ipcRenderer.on('lark:login-event', handler)

    return () => {
      ipcRenderer.removeListener('lark:login-event', handler)
    }
  },

  /**
   * 读取 Meegle CLI 状态和登录用户。
   */
  getMeegleState: (): Promise<MeegleState> => ipcRenderer.invoke('meegle:get-state'),

  /**
   * 保存 Meegle CLI 路径；传 null 恢复自动检测。
   */
  setMeegleCliPath: (cliPath: string | null): Promise<MeegleCliInfo> =>
    ipcRenderer.invoke('meegle:set-cli-path', cliPath),

  /**
   * 只执行 Meegle CLI 自动检测，不修改已保存路径。
   */
  detectMeegleCliInfo: (): Promise<MeegleCliInfo> =>
    ipcRenderer.invoke('meegle:detect-cli-info'),

  /**
   * 选择 Meegle CLI 可执行文件，优先定位到当前路径所在目录。
   */
  selectMeegleCliPath: (currentPath?: string | null): Promise<string | null> =>
    ipcRenderer.invoke('meegle:select-cli-path', currentPath),

  /**
   * 发起 Meegle 扫码登录，返回二维码。
   */
  startMeegleLogin: (): Promise<MeegleLoginSession> => ipcRenderer.invoke('meegle:start-login'),

  /**
   * 取消 Meegle 扫码登录。
   */
  cancelMeegleLogin: (): Promise<void> => ipcRenderer.invoke('meegle:cancel-login'),

  /**
   * 退出 Meegle 登录。
   */
  logoutMeegle: (): Promise<MeegleState> => ipcRenderer.invoke('meegle:logout'),

  /**
   * 订阅 Meegle 扫码登录结果，返回取消订阅函数。
   */
  onMeegleLoginEvent: (listener: (event: MeegleLoginEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, result: MeegleLoginEvent): void => {
      listener(result)
    }

    ipcRenderer.on('meegle:login-event', handler)

    return () => {
      ipcRenderer.removeListener('meegle:login-event', handler)
    }
  },

  /**
   * 订阅 CLI 授权过期事件，返回取消订阅函数。
   */
  onAuthExpired: (listener: (event: AuthExpiredEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, result: AuthExpiredEvent): void => {
      listener(result)
    }

    ipcRenderer.on('auth:expired', handler)

    return () => {
      ipcRenderer.removeListener('auth:expired', handler)
    }
  },

  /**
   * 读取站点快捷入口。
   */
  getSiteState: (): Promise<SiteState> => ipcRenderer.invoke('sites:get-state'),

  /**
   * 新增站点快捷入口。
   */
  addSite: (input: SiteInput): Promise<SiteState> => ipcRenderer.invoke('sites:add', input),

  /**
   * 更新站点快捷入口。
   */
  updateSite: (id: string, input: SiteInput): Promise<SiteState> =>
    ipcRenderer.invoke('sites:update', id, input),

  /**
   * 记录一次站点打开，用于计算常用站点。
   */
  recordSiteOpen: (id: string): Promise<SiteState> =>
    ipcRenderer.invoke('sites:open', id),

  /**
   * 保存站点拖拽排序。
   */
  reorderSites: (ids: string[]): Promise<SiteState> =>
    ipcRenderer.invoke('sites:reorder', ids),

  /**
   * 删除站点快捷入口。
   */
  removeSite: (id: string): Promise<SiteState> => ipcRenderer.invoke('sites:remove', id),

  /**
   * 读取飞书个人工作周报。
   */
  getWeeklyReport: (): Promise<WeeklyReportState> =>
    ipcRenderer.invoke('weekly-report:get'),

  /**
   * 提交飞书个人工作周报。
   */
  submitWeeklyReport: (input: SubmitWeeklyReportInput): Promise<WeeklyReportState> =>
    ipcRenderer.invoke('weekly-report:submit', input),

  /**
   * 读取当前 Meegle 用户负责的需求，并按迭代分组。
   */
  getMyRequirements: (): Promise<MeegleMyRequirements> =>
    ipcRenderer.invoke('requirements:get-my'),

  /** 按关键词搜索当前空间内的全部需求。 */
  searchRequirements: (keyword: string): Promise<MeegleMyRequirements> =>
    ipcRenderer.invoke('requirements:search', keyword),

  /**
   * 读取当前用户参与的缺陷，可按缺陷角色过滤。
   */
  getMyDefects: (role?: DefectRole | null): Promise<MeegleMyDefects> =>
    ipcRenderer.invoke('defects:get-my', role ?? null),

  /** 按关键词搜索当前空间内的全部缺陷。 */
  searchDefects: (keyword: string): Promise<MeegleMyDefects> =>
    ipcRenderer.invoke('defects:search', keyword),

  /**
   * 更新 BUG 处理人。
   */
  updateDefectAssignees: (
    workItemId: string,
    input: UpdateDefectAssigneesInput
  ): Promise<void> => ipcRenderer.invoke('defects:update-assignees', workItemId, input),

  /**
   * 读取缺陷评论。
   */
  getDefectComments: (workItemId: string): Promise<MeegleDefectComments> =>
    ipcRenderer.invoke('defects:get-comments', workItemId),

  /**
   * 读取缺陷可流转状态。
   */
  getDefectTransitions: (workItemId: string): Promise<DefectTransitions> =>
    ipcRenderer.invoke('defects:get-transitions', workItemId),

  /**
   * 执行缺陷状态流转。
   */
  transitionDefect: (
    workItemId: string,
    transitionId: string,
    fields?: DefectTransitionFieldValue[]
  ): Promise<void> =>
    ipcRenderer.invoke('defects:transition', workItemId, transitionId, fields),

  /**
   * 发表缺陷评论。
   */
  addDefectComment: (
    workItemId: string,
    content: string,
    notifyUserKeys?: string[]
  ): Promise<void> =>
    ipcRenderer.invoke('defects:add-comment', workItemId, content, notifyUserKeys),

  /**
   * 读取用户可访问的 Meegle 空间。
   */
  listMeegleProjects: (): Promise<MeegleProject[]> =>
    ipcRenderer.invoke('requirements:list-projects'),

  /**
   * 切换当前 Meegle 空间。
   */
  setMeegleProject: (projectKey: string): Promise<MeegleProject> =>
    ipcRenderer.invoke('requirements:set-project', projectKey),

  /**
   * 按姓名或邮箱搜索 Meegle 用户。
   */
  searchRequirementUsers: (keyword: string): Promise<MeegleRequirementOwner[]> =>
    ipcRenderer.invoke('requirements:search-users', keyword),

  /**
   * 更新需求描述。
   */
  updateRequirementDescription: (workItemId: string, content: string): Promise<void> =>
    ipcRenderer.invoke('requirements:update-description', workItemId, content),

  /**
   * 读取需求的本地个人状态。
   */
  getRequirementPersonalStatus: (
    projectKey: string,
    requirementId: string
  ): Promise<RequirementPersonalStatusState> =>
    ipcRenderer.invoke('requirement-status:get', projectKey, requirementId),

  /**
   * 保存需求的本地个人状态；传空字符串表示清除。
   */
  setRequirementPersonalStatus: (
    projectKey: string,
    requirementId: string,
    value: string
  ): Promise<RequirementPersonalStatusState> =>
    ipcRenderer.invoke('requirement-status:set', projectKey, requirementId, value),

  /**
   * 读取需求的代码仓库绑定。
   */
  getRequirementBindings: (requirementId: string): Promise<RequirementBindingState> =>
    ipcRenderer.invoke('bindings:get', requirementId),

  /**
   * 新增需求仓库绑定。
   */
  addRequirementBinding: (
    requirementId: string,
    repositoryId: string,
    branchName: string
  ): Promise<RequirementBindingState> =>
    ipcRenderer.invoke('bindings:add', requirementId, repositoryId, branchName),

  /**
   * 绑定轻舟工作项。
   */
  addQingzhouRequirementBinding: (
    requirementId: string,
    repositoryId: string
  ): Promise<RequirementBindingState> =>
    ipcRenderer.invoke('bindings:add-qingzhou', requirementId, repositoryId),

  /**
   * 同步轻舟工作项分支。
   */
  syncQingzhouRequirementBinding: (
    requirementId: string,
    bindingId: string
  ): Promise<RequirementBindingState> =>
    ipcRenderer.invoke('bindings:sync-qingzhou', requirementId, bindingId),

  /**
   * 解除需求仓库绑定。
   */
  removeRequirementBinding: (
    requirementId: string,
    bindingId: string
  ): Promise<RequirementBindingState> =>
    ipcRenderer.invoke('bindings:remove', requirementId, bindingId),

  /**
   * 读取需求流程节点和评论。
   */
  getRequirementActivity: (workItemId: string): Promise<MeegleRequirementActivity> =>
    ipcRenderer.invoke('requirements:get-activity', workItemId),

  /**
   * 发表需求评论。
   */
  addRequirementComment: (
    workItemId: string,
    content: string,
    notifyUserKeys?: string[]
  ): Promise<void> =>
    ipcRenderer.invoke('requirements:add-comment', workItemId, content, notifyUserKeys),

  /**
   * 完成或回滚需求节点。
   */
  transitionRequirementNode: (
    workItemId: string,
    nodeId: string,
    action: 'confirm' | 'rollback',
    rollbackReason?: string
  ): Promise<void> =>
    ipcRenderer.invoke(
      'requirements:transition-node',
      workItemId,
      nodeId,
      action,
      rollbackReason
    ),

  /**
   * 更新节点排期、估分和实际工时。
   */
  updateRequirementNode: (
    workItemId: string,
    nodeId: string,
    input: UpdateNodeInfoInput
  ): Promise<void> => ipcRenderer.invoke('requirements:update-node', workItemId, nodeId, input),

  /**
   * 读取代码仓库配置状态。
   */
  getRepositoryState: (): Promise<RepositoryState> =>
    ipcRenderer.invoke('repositories:get-state'),

  /**
   * 刷新单个仓库的 Git 信息。
   */
  refreshRepository: (repositoryId: string): Promise<RepositoryState> =>
    ipcRenderer.invoke('repositories:refresh-repository', repositoryId),

  /**
   * 读取指定仓库的本地和远程分支。
   */
  listRepositoryBranches: (
    repositoryId: string,
    fetchRemote = false
  ): Promise<RepositoryBranchList> =>
    ipcRenderer.invoke('repositories:list-branches', repositoryId, fetchRemote),

  /**
   * 读取需求仓库绑定的实时状态。
   */
  getRepositoryBindingStatus: (
    repositoryId: string,
    branchName: string,
    iterationBranch?: string | null
  ): Promise<RepositoryBindingStatus> =>
    ipcRenderer.invoke(
      'repositories:get-binding-status',
      repositoryId,
      branchName,
      iterationBranch
    ),

  /**
   * 从基线分支创建本地开发分支。
   */
  createRepositoryBranch: (
    repositoryId: string,
    branchName: string,
    baseBranch: string
  ): Promise<void> =>
    ipcRenderer.invoke(
      'repositories:create-branch',
      repositoryId,
      branchName,
      baseBranch
    ),

  /**
   * 重新扫描代码根目录，同步仓库增删和 Git 信息。
   */
  refreshRootRepositories: (): Promise<RepositoryScanResult> =>
    ipcRenderer.invoke('repositories:refresh-root'),

  /**
   * 设置代码根目录。
   */
  setRepositoryRoot: (rootPath: string): Promise<RepositoryState> =>
    ipcRenderer.invoke('repositories:set-root', rootPath),

  /**
   * 清除代码根目录，不删除本地文件。
   */
  clearRepositoryRoot: (): Promise<RepositoryState> =>
    ipcRenderer.invoke('repositories:clear-root'),

  /**
   * 打开系统目录选择器。
   */
  selectDirectory: (title?: string, defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('repositories:select-directory', title, defaultPath),

  /**
   * 取消当前正在执行的 Git 克隆。
   */
  cancelRepositoryClone: (): Promise<void> =>
    ipcRenderer.invoke('repositories:cancel-clone'),

  /**
   * 从 Git 克隆仓库到指定根目录。
   */
  cloneRepository: (input: CloneRepositoryInput): Promise<RepositoryState> =>
    ipcRenderer.invoke('repositories:clone', input),

  /**
   * 订阅 Git 克隆进度，返回取消订阅函数。
   */
  onRepositoryCloneProgress: (
    listener: (progress: RepositoryCloneProgress) => void
  ): (() => void) => {
    const handler = (_event: IpcRendererEvent, progress: RepositoryCloneProgress): void => {
      listener(progress)
    }

    ipcRenderer.on('repositories:clone-progress', handler)

    return () => {
      ipcRenderer.removeListener('repositories:clone-progress', handler)
    }
  },

  /**
   * 订阅后台扫描产生的仓库状态变化。
   */
  onRepositoriesChanged: (listener: (state: RepositoryState) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, state: RepositoryState): void => {
      listener(state)
    }

    ipcRenderer.on('repositories:changed', handler)

    return () => {
      ipcRenderer.removeListener('repositories:changed', handler)
    }
  },

  /**
   * 更新仓库名称或轻舟接入状态。
   */
  updateRepository: (repositoryId: string, patch: UpdateRepositoryInput): Promise<RepositoryState> =>
    ipcRenderer.invoke('repositories:update', repositoryId, patch),

  /**
   * 移除仓库元数据，不删除本地代码。
   */
  removeRepository: (repositoryId: string): Promise<RepositoryState> =>
    ipcRenderer.invoke('repositories:remove', repositoryId),

  /**
   * 读取 AI 配置文件内容。
   */
  readAiConfig: (): Promise<AiConfigDocument> => ipcRenderer.invoke('ai-config:read'),

  /**
   * 校验并保存 AI 配置文件。
   */
  writeAiConfig: (content: string): Promise<AiConfigDocument> => ipcRenderer.invoke('ai-config:write', content),
  /**
   * 读取 AI 配置是否可用，不返回密钥。
   */
  getAiConfigStatus: (): Promise<AiConfigStatus> =>
    ipcRenderer.invoke('ai:config:get-status'),

  /**
   * 将应用内 AI 产物通过下载管理保存到本机。
   */
  downloadAiArtifact: (
    artifactId: string
  ): Promise<{ path: string; downloadId: string } | null> =>
    ipcRenderer.invoke('ai:artifact:download', artifactId),

  /**
   * 统计应用内 AI 产物。
   */
  getAiArtifactStats: (): Promise<AiArtifactStats> =>
    ipcRenderer.invoke('ai:artifacts:stats'),

  /**
   * 清空应用内 AI 产物。
   */
  clearAiArtifacts: (): Promise<AiArtifactStats> =>
    ipcRenderer.invoke('ai:artifacts:clear'),

  /** 通过飞书云盘检查新版本。 */
  checkForUpdates: (): Promise<UpdateCheckResult> =>
    ipcRenderer.invoke('updater:check'),

  /** 下载指定更新安装包到系统下载目录。 */
  downloadUpdatePackage: (item: UpdatePackage): Promise<UpdateDownloadResult> =>
    ipcRenderer.invoke('updater:download', item),

  /** 打开已下载的更新安装包并退出应用。 */
  installUpdateDownload: (downloadId: string): Promise<void> =>
    ipcRenderer.invoke('updater:install', downloadId),

  /** 读取底部 AI 助手的历史会话。 */
  getAiAssistantSession: (): Promise<AiAssistantSessionState> =>
    ipcRenderer.invoke('ai:assistant-session:get'),

  /** 保存底部 AI 助手的历史会话。 */
  saveAiAssistantSession: (
    messages: AiStoredMessage[]
  ): Promise<AiAssistantSessionState> =>
    ipcRenderer.invoke('ai:assistant-session:save', messages),

  /** 读取存储清理统计。 */
  getStorageCleanupStats: (): Promise<StorageCleanupStats> =>
    ipcRenderer.invoke('storage:get-stats'),

  /** 清理指定存储分类并返回最新统计。 */
  clearStorageCleanup: (kind: StorageCleanupKind): Promise<StorageCleanupStats> =>
    ipcRenderer.invoke('storage:clear', kind),

  /**
   * 读取额外技能目录。
   */
  getSkillSettings: (): Promise<SkillSettingsState> =>
    ipcRenderer.invoke('skills:get-settings'),

  /**
   * 保存额外技能目录。
   */
  setSkillDirectories: (directories: string[]): Promise<SkillSettingsState> =>
    ipcRenderer.invoke('skills:set-directories', directories),

  /**
   * 打开系统目录选择器。
   */
  selectSkillDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('skills:select-directory'),

  /**
   * 解析剪贴板粘贴的附件文件。
   */
  parseAiAttachmentFiles: (
    files: AiAttachmentFilePayload[]
  ): Promise<AiChatAttachment[]> =>
    ipcRenderer.invoke('ai:attachments:parse', files),

  /**
   * 选择并解析 AI 附件。
   */
  pickAiAttachments: (): Promise<AiChatAttachment[]> =>
    ipcRenderer.invoke('ai:attachments:pick'),

  /**
   * 启动一次无状态流式对话。
   */
  startAiChat: (input: AiChatStartInput): Promise<AiChatStartResult> =>
    ipcRenderer.invoke('ai:chat:start', input),

  /**
   * 中止指定聊天请求。
   */
  abortAiChat: (requestId: string): Promise<void> =>
    ipcRenderer.invoke('ai:chat:abort', requestId),

  /**
   * 订阅 AI 流式事件。调用方应在 startAiChat 之前订阅。
   */
  onAiChatEvent: (listener: (event: AiChatEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: AiChatEvent): void => {
      listener(payload)
    }

    ipcRenderer.on('ai:chat:event', handler)

    return () => {
      ipcRenderer.removeListener('ai:chat:event', handler)
    }
  },
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
