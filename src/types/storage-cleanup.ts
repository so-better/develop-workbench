/**
 * 存储清理分类。
 */
export type StorageCleanupKind =
  | 'ai-artifacts'
  | 'browser-cache'
  | 'app-cache'
  | 'download-records'
  | 'corrupt-backups'

/**
 * 单个清理分类的数量和占用空间。
 */
export interface StorageCleanupItem {
  count: number
  bytes: number
}

/**
 * 存储清理统计。
 */
export interface StorageCleanupStats {
  items: Record<StorageCleanupKind, StorageCleanupItem>
}
