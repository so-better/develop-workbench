/**
 * 产品使用手册的展示状态。
 * seenVersion 小于 currentVersion 时，首次进入应用会展示手册。
 */
export interface ProductGuideState {
  /** 当前应用内置的手册版本。 */
  currentVersion: number

  /** 用户已经看过的版本；从未看过时为 0。 */
  seenVersion: number
}
