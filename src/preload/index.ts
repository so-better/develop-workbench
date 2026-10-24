import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AiConfigDocument } from '../types/ai-config'
import type { AppInfo } from '../types/app'
import type {
  EmbeddedBrowserBounds,
  EmbeddedBrowserState
} from '../types/embedded-browser'
import type { IdeConfig, IdeConfigState, IdePresetId } from '../types/ide'
import type { RequirementBindingState } from '../types/bindings'
import type { LarkCliInfo, LarkLoginEvent, LarkLoginSession, LarkUser } from '../types/lark'
import type { LinkPreview } from '../types/link-preview'
import type { MeegleCliInfo, MeegleLoginEvent, MeegleLoginSession, MeegleState } from '../types/meegle'
import type {
  MeegleMyRequirements,
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

const electronAPI = {
  // 当前运行平台，渲染进程可在首次渲染时同步读取。
  platform: process.platform,

  /**
   * 获取应用版本及 Electron、Chromium、Node.js 运行时信息。
   */
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:get-info'),

  /**
   * 获取链接预览信息。
   */
  getLinkPreview: (url: string): Promise<LinkPreview> =>
    ipcRenderer.invoke('link-preview:get', url),

  openEmbeddedBrowser: (url: string): Promise<boolean> =>
    ipcRenderer.invoke('embedded-browser:open', url),

  getEmbeddedBrowserState: (): Promise<EmbeddedBrowserState> =>
    ipcRenderer.invoke('embedded-browser:get-state'),

  closeEmbeddedBrowser: (): Promise<void> =>
    ipcRenderer.invoke('embedded-browser:close'),

  reloadEmbeddedBrowser: (): Promise<void> =>
    ipcRenderer.invoke('embedded-browser:reload'),

  setEmbeddedBrowserBounds: (bounds: EmbeddedBrowserBounds): Promise<void> =>
    ipcRenderer.invoke('embedded-browser:set-bounds', bounds),

  setEmbeddedBrowserSuppressed: (suppressed: boolean): Promise<void> =>
    ipcRenderer.invoke('embedded-browser:set-suppressed', suppressed),

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
  launchRepositoryInIde: (repositoryId: string): Promise<void> =>
    ipcRenderer.invoke('ide:launch-repository', repositoryId),

  /**
   * 选择 IDE 可执行文件。
   */
  selectIdeCommand: (
    currentPath?: string | null,
    presetId?: IdePresetId
  ): Promise<string | null> =>
    ipcRenderer.invoke('ide:select-command', currentPath, presetId),

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
   * 读取当前 Meegle 用户负责的需求，并按迭代分组。
   */
  getMyRequirements: (): Promise<MeegleMyRequirements> =>
    ipcRenderer.invoke('requirements:get-my'),

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
    branchName: string
  ): Promise<RepositoryBindingStatus> =>
    ipcRenderer.invoke('repositories:get-binding-status', repositoryId, branchName),

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
