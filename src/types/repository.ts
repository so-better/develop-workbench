/**
 * 本地代码仓库。
 */
export interface Repository {
  /** 应用生成的稳定仓库 ID，不随路径或名称变化。 */
  id: string

  /** 仓库名称，始终取自本地仓库目录名，不支持单独修改。 */
  name: string

  /** 本地仓库根目录的绝对路径。 */
  localPath: string

  /** origin 远程地址，用于识别仓库；没有远程仓库时为 null。 */
  remoteUrl: string | null

  /** 远程仓库的主分支，例如 main、master、develop。 */
  defaultBranch: string | null

  /** 本地当前检出的分支；分离 HEAD 状态或读取失败时为 null。 */
  currentBranch: string | null

  /** 是否已标记接入轻舟。 */
  qingzhouEnabled: boolean

  /** 本地路径当前是否存在且可访问。 */
  available: boolean

  /** 仓库数据最后一次更新时间的 ISO 字符串。 */
  updatedAt: string
}

/**
 * 代码仓库配置页面状态。
 */
export interface RepositoryState {
  /** 唯一代码根目录的绝对路径；尚未配置时为 null。 */
  root: string | null

  /** 已维护的本地仓库列表。 */
  repositories: Repository[]
}

/**
 * 仓库分支列表和远程刷新结果。
 */
export interface RepositoryBranchList {
  /** 本地分支和 origin 远程分支合并去重后的列表。 */
  branches: string[]

  /** 有远程仓库但 fetch 失败时的提示；无远程或成功时为 null。 */
  fetchWarning: string | null
}

/**
 * 切换仓库分支的结果。
 */
export interface RepositoryBranchSwitchResult {
  /** 是否真的执行了切换；已经在目标分支时为 false。 */
  switched: boolean

  /** 切换后是否执行了 pull。 */
  pulled: boolean

  /** 实际切换到的分支名。 */
  branchName: string
}

/**
 * 合并分支的结果。
 */
export interface RepositoryMergeResult {
  /** 是否发生了合并冲突；为 true 时合并状态会保留，等待手动解决。 */
  conflicted: boolean

  /** 冲突文件列表。 */
  conflicts: string[]

  /** 合并成功后是否已推送到远程。 */
  pushed: boolean

  /** 是否因为没有远程仓库而跳过推送。 */
  pushSkipped: boolean

  /** 推送失败原因；成功、跳过或冲突时为空。 */
  pushError: string | null
}

/**
 * 需求仓库绑定的实时状态。
 */
export interface RepositoryBindingStatus {
  /** 仓库路径是否可访问。 */
  available: boolean

  /** 绑定的目标分支是否存在。 */
  branchExists: boolean

  /** 轻舟迭代分支是否存在。 */
  iterationBranchExists: boolean
}

/**
 * 根目录扫描结果。
 * 在仓库状态之外附带本次扫描的统计信息。
 */
export interface RepositoryScanResult extends RepositoryState {
  /** 本次扫描新发现的仓库数量。 */
  added: number

  /** 本次扫描中已存在并更新的仓库数量。 */
  updated: number

  /** 本次扫描中从应用配置里移除的仓库数量。 */
  removed: number

  /** 当前本地路径不可用的仓库数量。 */
  unavailable: number

  /** 根目录或单个仓库读取失败时的错误信息。 */
  errors: string[]
}

/**
 * Git 克隆过程日志和进度。
 */
export interface RepositoryCloneProgress {
  /** Git 输出的原始日志行，已去除潜在的地址凭据。 */
  message: string

  /** 当前进度百分比；无法解析时为 null。 */
  percent: number | null
}

/**
 * 从 Git 克隆仓库。
 */
export interface CloneRepositoryInput {
  /** Git 仓库地址，支持 https、ssh、git 协议或 SCP 格式。 */
  url: string

  /** 克隆后的目录名；留空时根据仓库地址自动生成。 */
  directoryName?: string
}

/**
 * 更新仓库配置。
 * 未传入的字段保持不变。
 */
export interface UpdateRepositoryInput {
  /** 是否接入轻舟。 */
  qingzhouEnabled?: boolean
}
