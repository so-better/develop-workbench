/**
 * 内嵌终端会话信息。
 */
export interface TerminalSessionInfo {
  /** 会话 ID，用于写入、调整尺寸和关闭。 */
  id: string

  /** 终端标签标题。 */
  title: string

  /** 标题是否是用户手动设置的；为 true 时不再跟随 shell 标题。 */
  customTitle: boolean

  /** shell 可执行文件路径。 */
  shell: string

  /** 会话工作目录。 */
  cwd: string

  /** 当前列数。 */
  cols: number

  /** 当前行数。 */
  rows: number
}

/**
 * 新建终端会话的入参。
 */
export interface TerminalCreateInput {
  /** 初始列数；缺省使用默认值。 */
  cols?: number

  /** 初始行数；缺省使用默认值。 */
  rows?: number

  /** 工作目录；缺省使用用户主目录。 */
  cwd?: string
}

/**
 * 终端输出事件。
 */
export interface TerminalDataEvent {
  /** 会话 ID。 */
  id: string

  /** 原始输出内容，包含 ANSI 控制序列。 */
  data: string
}

/**
 * 终端进程退出事件。
 */
export interface TerminalExitEvent {
  /** 会话 ID。 */
  id: string

  /** 进程退出码。 */
  exitCode: number

  /** 终止信号；正常退出时为 0。 */
  signal: number
}

/** 默认等宽字体。 */
export const DEFAULT_TERMINAL_FONT_FAMILY =
  '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

/**
 * 终端外观和运行配置。
 */
export interface TerminalSettings {
  /** 自定义 shell 路径；null 表示自动检测。 */
  shell: string | null

  /** 终端字体。 */
  fontFamily: string

  /** 字号，单位 px。 */
  fontSize: number

  /** 滚动历史行数。 */
  scrollback: number

  /** 是否启用 WebGL 加速。 */
  webgl: boolean

  /** 是否在选中文本后自动复制到剪贴板。 */
  copyOnSelect: boolean
}

/** 终端设置的默认值。 */
export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  shell: null,
  fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
  fontSize: 13,
  scrollback: 5000,
  webgl: true,
  copyOnSelect: false
}

/** Shell 配置来源。 */
export type TerminalShellSource = 'settings' | 'environment' | 'auto'

/**
 * 当前生效的 shell 信息。
 */
export interface TerminalShellInfo {
  /** shell 可执行文件路径。 */
  path: string

  /** 路径是否可用。 */
  available: boolean

  /** 来源：应用设置、环境变量或自动回退。 */
  source: TerminalShellSource

  /** shell 名称，例如 zsh、bash。 */
  name: string
}
