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
