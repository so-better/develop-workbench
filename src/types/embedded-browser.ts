/**
 * 内嵌浏览器在窗口内容区中的位置。
 */
export interface EmbeddedBrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 内嵌浏览器状态。
 */
export interface EmbeddedBrowserState {
  /** 面板是否打开。 */
  visible: boolean

  /** 当前页面地址。 */
  url: string | null

  /** 当前页面标题。 */
  title: string | null

  /** 页面是否正在加载。 */
  loading: boolean

  /** 最近一次加载失败信息。 */
  error: string | null
}

/**
 * 内嵌浏览器下载状态。
 */
export type EmbeddedBrowserDownloadStatus =
  | 'progressing'
  | 'completed'
  | 'cancelled'
  | 'interrupted'

/**
 * 内嵌浏览器下载项。
 */
export interface EmbeddedBrowserDownload {
  /** 应用生成的下载记录 ID。 */
  id: string

  /** 文件名。 */
  filename: string

  /** 下载来源地址。 */
  url: string

  /** 最终保存路径；用户尚未选择路径时为 null。 */
  savePath: string | null

  /** 总字节数；未知时为 0。 */
  totalBytes: number

  /** 已下载字节数。 */
  receivedBytes: number

  /** 当前下载速度，字节/秒。 */
  bytesPerSecond: number

  /** 当前下载状态。 */
  status: EmbeddedBrowserDownloadStatus

  /** 开始时间，Unix 毫秒。 */
  startedAt: number

  /** 中断后是否还能继续。 */
  canResume: boolean

  /** 是否处于暂停状态。 */
  paused: boolean
}
