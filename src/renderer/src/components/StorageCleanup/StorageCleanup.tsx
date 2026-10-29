import { useCallback, useEffect, useState } from 'react'
import {
  AppstoreOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FileTextOutlined,
  GlobalOutlined,
  WarningOutlined
} from '@ant-design/icons'
import { Alert, App, Button, Popconfirm, Spin } from 'antd'
import type {
  StorageCleanupItem,
  StorageCleanupKind,
  StorageCleanupStats
} from '../../../../types/storage-cleanup'
import { getErrorMessage } from '../../../../utils'

interface CleanupDefinition {
  kind: StorageCleanupKind
  title: string
  description: string
  icon: JSX.Element
  confirmTitle: string
  confirmDescription: string
}

const CLEANUP_ITEMS: CleanupDefinition[] = [
  {
    kind: 'ai-artifacts',
    title: 'AI 产物',
    description: '对话中生成但尚未下载的临时文件。',
    icon: <FileTextOutlined />,
    confirmTitle: '清理 AI 产物？',
    confirmDescription: '将删除尚未下载的 AI 临时文件，已经保存到本机的文件不受影响。'
  },
  {
    kind: 'browser-cache',
    title: '内置浏览器缓存',
    description: '清理网页缓存并关闭内置浏览器，不会退出网站登录。',
    icon: <GlobalOutlined />,
    confirmTitle: '清理内置浏览器缓存？',
    confirmDescription: '会先关闭内置浏览器，再清理网页缓存；Cookie 和登录状态不会清除。'
  },
  {
    kind: 'app-cache',
    title: '应用界面缓存',
    description: '清理应用页面加载缓存，不影响配置和登录数据。',
    icon: <AppstoreOutlined />,
    confirmTitle: '清理应用界面缓存？',
    confirmDescription: '清理后应用页面首次加载可能稍慢，不会删除配置或登录数据。'
  },
  {
    kind: 'download-records',
    title: '下载记录',
    description: '清空已经结束的下载历史，不会删除已下载文件。',
    icon: <DownloadOutlined />,
    confirmTitle: '清空下载记录？',
    confirmDescription: '只清理下载历史，已经保存到本机的文件不会被删除。'
  },
  {
    kind: 'corrupt-backups',
    title: '损坏数据备份',
    description: '数据文件损坏时自动隔离的原始文件，删除后无法恢复。',
    icon: <WarningOutlined />,
    confirmTitle: '删除损坏数据备份？',
    confirmDescription: '删除后无法再通过备份文件恢复损坏数据，建议确认不再需要排查后再清理。'
  }
]

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`

  return `${Math.max(0, Math.round(bytes))} B`
}

const formatItemStats = (
  kind: StorageCleanupKind,
  item: StorageCleanupItem | undefined
): string => {
  if (!item) return '不可用'

  if (kind === 'download-records') return `${item.count} 条记录`
  if (kind === 'ai-artifacts' || kind === 'corrupt-backups') {
    return `${item.count} 个文件 · ${formatBytes(item.bytes)}`
  }

  return formatBytes(item.bytes)
}

const hasCleanableData = (item: StorageCleanupItem | undefined): boolean =>
  Boolean(item && (item.count > 0 || item.bytes > 0))

/**
 * 存储清理设置页。
 * 只清理可再生成的缓存、临时文件和损坏备份。
 */
export default function StorageCleanup(): JSX.Element {
  const { message } = App.useApp()
  const [stats, setStats] = useState<StorageCleanupStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [clearingKind, setClearingKind] = useState<StorageCleanupKind | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadStats = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)

    try {
      setStats(await window.electron.getStorageCleanupStats())
    } catch (loadError) {
      setError(getErrorMessage(loadError, '读取存储统计失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  const handleClear = async (item: CleanupDefinition): Promise<void> => {
    setClearingKind(item.kind)
    setError(null)

    try {
      const next = await window.electron.clearStorageCleanup(item.kind)

      setStats(next)
      message.success(`已清理${item.title}`)
    } catch (clearError) {
      const next = await window.electron
        .getStorageCleanupStats()
        .catch(() => null)

      if (next) setStats(next)
      setError(getErrorMessage(clearError, `清理${item.title}失败`))
    } finally {
      setClearingKind(null)
    }
  }

  return (
    <>
      <div className="settings-panel-header">
        <h3>存储清理</h3>
        <p>
          清理可再生成的缓存、临时文件和损坏备份，不会删除业务配置、登录态或本机文件。
        </p>
      </div>

      {loading ? (
        <div className="settings-loading">
          <Spin />
        </div>
      ) : (
        <>
          {error ? (
            <Alert
              className="storage-cleanup-error"
              type="error"
              showIcon
              message={error}
              action={
                <Button
                  type="primary"
                  danger
                  size="small"
                  onClick={() => void loadStats()}
                >
                  重试
                </Button>
              }
            />
          ) : null}
          <div className="storage-cleanup-list">
            {CLEANUP_ITEMS.map((item) => {
              const itemStats = stats?.items[item.kind]
              const clearing = clearingKind === item.kind

              return (
                <div className="storage-cleanup-card" key={item.kind}>
                  <div className="storage-cleanup-head">
                    <span className="storage-cleanup-icon">{item.icon}</span>
                    <div className="storage-cleanup-copy">
                      <strong>{item.title}</strong>
                      <span>{item.description}</span>
                    </div>
                    <Popconfirm
                      title={item.confirmTitle}
                      description={item.confirmDescription}
                      okText="清理"
                      cancelText="取消"
                      onConfirm={() => handleClear(item)}
                    >
                      <Button
                        type="primary"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        loading={clearing}
                        disabled={
                          !hasCleanableData(itemStats) ||
                          (clearingKind !== null && !clearing)
                        }
                      >
                        清理
                      </Button>
                    </Popconfirm>
                  </div>
                  <div className="storage-cleanup-meta">
                    <span>{formatItemStats(item.kind, itemStats)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}
