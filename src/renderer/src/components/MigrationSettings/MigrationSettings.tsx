import { useState } from 'react'
import {
  CheckCircleFilled,
  ExportOutlined,
  ImportOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { App, Button, ConfigProvider, theme } from 'antd'
import type {
  MigrationExportResult,
  MigrationImportResult
} from '../../../../types/migration'
import { getErrorMessage } from '../../../../utils'
import '../StorageCleanup/StorageCleanup.css'
import './MigrationSettings.css'

const formatBytes = (bytes: number | undefined): string => {
  if (!bytes) return '0 B'
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`

  return `${Math.round(bytes)} B`
}

/**
 * 一键迁移。
 * 导出全部应用数据；导入时跳过本机路径，并提示重启生效。
 */
export default function MigrationSettings(): JSX.Element {
  const { message } = App.useApp()
  const { token } = theme.useToken()
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exportResult, setExportResult] = useState<MigrationExportResult | null>(
    null
  )
  const [importResult, setImportResult] = useState<MigrationImportResult | null>(
    null
  )

  const handleExport = async (): Promise<void> => {
    setExporting(true)

    try {
      const result = await window.electron.exportMigrationData()
      if (!result.canceled) {
        setExportResult(result)
        message.success('迁移包已导出')
      }
    } catch (error) {
      message.error(getErrorMessage(error, '导出迁移包失败'))
    } finally {
      setExporting(false)
    }
  }

  const handleImport = async (): Promise<void> => {
    setImporting(true)

    try {
      const result = await window.electron.importMigrationData()
      if (!result.canceled) {
        setImportResult(result)
        message.success('数据已导入')
      }
    } catch (error) {
      message.error(getErrorMessage(error, '导入迁移包失败'))
    } finally {
      setImporting(false)
    }
  }

  const handleRestart = async (): Promise<void> => {
    try {
      await window.electron.restartApp()
    } catch (error) {
      message.error(getErrorMessage(error, '重启应用失败'))
    }
  }

  return (
    <>
      <div className="settings-panel-header">
        <h3>一键迁移</h3>
        <p>导出本机应用数据，在新电脑导入后恢复。</p>
      </div>

      <div className="storage-cleanup-list">
        <div className="storage-cleanup-card">
          <div className="storage-cleanup-head">
            <span className="storage-cleanup-icon">
              <ExportOutlined />
            </span>
            <div className="storage-cleanup-copy">
              <strong>导出数据</strong>
              <span>
                打包站点、待办、需求相关数据、仓库元数据、模型配置和 AI 对话记录。
              </span>
            </div>
            <Button
              type="text"
              size="small"
              icon={<ExportOutlined />}
              loading={exporting}
              disabled={importing}
              style={{ color: exporting || importing ? undefined : token.colorPrimary }}
              onClick={() => handleExport()}
            >
              导出
            </Button>
          </div>
          <div className="storage-cleanup-meta">
            不包含浏览器登录态、缓存、下载记录和 AI 生成文件。压缩包内包含 AI 模型
            API Key，请妥善保管。
          </div>
          {exportResult?.path ? (
            <div className="migration-result">
              <span>已导出到</span>
              <code>{exportResult.path}</code>
              <span>（{formatBytes(exportResult.bytes)}）</span>
            </div>
          ) : null}
        </div>

        <div className="storage-cleanup-card">
          <div className="storage-cleanup-head">
            <span className="storage-cleanup-icon">
              <ImportOutlined />
            </span>
            <div className="storage-cleanup-copy">
              <strong>导入数据</strong>
              <span>选择迁移包恢复数据；导入前会自动备份当前数据。</span>
            </div>
            <Button
              type="text"
              size="small"
              icon={<ImportOutlined />}
              loading={importing}
              disabled={exporting}
              style={{ color: importing || exporting ? undefined : token.colorPrimary }}
              onClick={() => handleImport()}
            >
              导入
            </Button>
          </div>
          <div className="storage-cleanup-meta">
            会覆盖同名的应用数据。目录和文件路径不会被导入，需要在当前电脑重新配置。
          </div>

          {importResult?.files?.length ? (
            <div className="migration-import-result">
              <div className="migration-import-head">
                <CheckCircleFilled className="migration-import-icon" />
                <div className="migration-import-copy">
                  <strong>已导入 {importResult.files.length} 项数据</strong>
                  <span>需要重启应用后生效。</span>
                </div>
                <ConfigProvider
                  theme={{
                    token: {
                      colorPrimary: token.colorSuccess,
                      colorPrimaryHover: token.colorSuccessHover,
                      colorPrimaryActive: token.colorSuccessActive
                    }
                  }}
                >
                  <Button
                    type="primary"
                    size="small"
                    icon={<ReloadOutlined />}
                    onClick={() => handleRestart()}
                  >
                    立即重启
                  </Button>
                </ConfigProvider>
              </div>
              {importResult.backupPath || importResult.skippedPaths?.length ? (
                <div className="migration-import-meta">
                  {importResult.backupPath ? (
                    <span>当前数据已备份到：{importResult.backupPath}</span>
                  ) : null}
                  {importResult.skippedPaths?.length ? (
                    <span>已跳过：{importResult.skippedPaths.join('、')}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}
