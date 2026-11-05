/** 迁移压缩包的清单，用于校验来源和兼容性。 */
export interface MigrationManifest {
  app: 'develop-workbench'
  version: string
  exportedAt: string
  files: string[]
}

/** 导出结果。 */
export interface MigrationExportResult {
  canceled: boolean
  path?: string
  bytes?: number
  files?: string[]
}

/** 导入结果。 */
export interface MigrationImportResult {
  canceled: boolean
  files?: string[]
  /** 导入前备份目录；没有旧数据时为 null。 */
  backupPath?: string | null
  /** 因属于本机路径而未导入的字段说明。 */
  skippedPaths?: string[]
}
