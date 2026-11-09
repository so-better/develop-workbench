import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Descriptions,
  Input,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Switch,
  Tag,
  Tooltip
} from 'antd'
import {
  AndroidOutlined,
  BugOutlined,
  CameraOutlined,
  AppstoreOutlined,
  ClearOutlined,
  CodeOutlined,
  CopyOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  StopOutlined,
  VideoCameraOutlined
} from '@ant-design/icons'
import type {
  AdbAppInfo,
  AdbCommandResult,
  AdbDevice,
  AdbInfo,
  AdbPermissionInfo,
  AdbReverseEntry,
  PageSpyRoomInfo,
  AdbScreenRecordResult,
  AdbScreenshotResult
} from '../../../../types/adb'
import type { SettingsSection } from '../../../../types/settings'
import { getErrorMessage } from '../../../../utils'
import './adb-tools.css'

const DEVICE_KEY = 'develop-workbench:adb-device'

interface AdbToolsPageProps {
  onOpenSettings: (section: SettingsSection) => void
}

const DEVICE_STATE_META: Record<
  AdbDevice['state'],
  { label: string; color: string }
> = {
  device: { label: '在线', color: 'green' },
  offline: { label: '离线', color: 'orange' },
  unauthorized: { label: '未授权', color: 'red' },
  'no permissions': { label: '无权限', color: 'red' },
  unknown: { label: '未知', color: 'default' }
}

/**
 * Bare React Native 本地模拟器调试工具。
 */
export default function AdbToolsPage({
  onOpenSettings
}: AdbToolsPageProps): JSX.Element {
  const { message } = App.useApp()
  const [info, setInfo] = useState<AdbInfo | null>(null)
  const [infoLoading, setInfoLoading] = useState(true)
  const [infoRefreshing, setInfoRefreshing] = useState(false)
  const [devices, setDevices] = useState<AdbDevice[]>([])
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [serial, setSerial] = useState(() => localStorage.getItem(DEVICE_KEY) ?? '')
  const [packageName, setPackageName] = useState('')
  const [devServerPort, setDevServerPort] = useState('8081')
  const [reverseEntries, setReverseEntries] = useState<AdbReverseEntry[]>([])
  const [reverseLoading, setReverseLoading] = useState(false)
  const [reversePort, setReversePort] = useState('8081')
  const [inspectorTab, setInspectorTab] = useState<'devtools' | 'pagespy'>(
    'devtools'
  )
  const [devToolsUrl, setDevToolsUrl] = useState<string | null>(null)
  const [devToolsLoading, setDevToolsLoading] = useState(false)
  const [devToolsError, setDevToolsError] = useState<string | null>(null)
  const [pageSpyRoom, setPageSpyRoom] = useState<PageSpyRoomInfo | null>(null)
  const [pageSpyLoading, setPageSpyLoading] = useState(false)
  const [pageSpyError, setPageSpyError] = useState<string | null>(null)
  const [executing, setExecuting] = useState<string | null>(null)
  const [screenshot, setScreenshot] = useState<AdbScreenshotResult | null>(null)
  const [deepLinkOpen, setDeepLinkOpen] = useState(false)
  const [deepLinkUrl, setDeepLinkUrl] = useState('')
  const [appInfoOpen, setAppInfoOpen] = useState(false)
  const [appInfo, setAppInfo] = useState<AdbAppInfo | null>(null)
  const [appInfoLoading, setAppInfoLoading] = useState(false)
  const [appInfoError, setAppInfoError] = useState<string | null>(null)
  const [permissionsOpen, setPermissionsOpen] = useState(false)
  const [permissions, setPermissions] = useState<AdbPermissionInfo[]>([])
  const [permissionsLoading, setPermissionsLoading] = useState(false)
  const [permissionsError, setPermissionsError] = useState<string | null>(null)
  const [permissionsKeyword, setPermissionsKeyword] = useState('')
  const [permissionUpdating, setPermissionUpdating] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordStarting, setRecordStarting] = useState(false)
  const [recordStopping, setRecordStopping] = useState(false)
  const [recordResult, setRecordResult] = useState<AdbScreenRecordResult | null>(
    null
  )
  const recordSessionRef = useRef<string | null>(null)
  const devToolsRequestRef = useRef(0)
  const pageSpyRequestRef = useRef(0)

  const selectedDevice = devices.find((device) => device.serial === serial) ?? null
  const online = selectedDevice?.state === 'device'

  const execute = useCallback(
    async (
      label: string,
      task: () => Promise<AdbCommandResult>,
      successMessage = `${label}完成`
    ): Promise<AdbCommandResult | null> => {
      setExecuting(label)

      try {
        const result = await task()
        message.success(successMessage)
        return result
      } catch (error) {
        message.error(getErrorMessage(error, `${label}失败`))
        return null
      } finally {
        setExecuting(null)
      }
    },
    [message]
  )

  const refreshDevices = useCallback(
    async (notify = false): Promise<AdbDevice[]> => {
      setDevicesLoading(true)

      try {
        const next = await window.electron.listAdbDevices()
        setDevices(next)
        setSerial((current) => {
          if (next.some((device) => device.serial === current)) return current

          const preferred =
            next.find((device) => device.state === 'device') ?? next[0]
          return preferred?.serial ?? ''
        })

        if (notify) {
          message.success(`已刷新，发现 ${next.length} 台设备`)
        }

        return next
      } catch (error) {
        setDevices([])
        if (notify) message.error(getErrorMessage(error, '读取设备失败'))
        return []
      } finally {
        setDevicesLoading(false)
      }
    },
    [message]
  )

  const refreshRuntimeInfo = useCallback(async (targetSerial: string): Promise<void> => {
    if (!targetSerial) return

    try {
      const foreground = await window.electron.getAdbForegroundPackage(targetSerial)

      if (foreground) setPackageName(foreground)

      const port = await window.electron.detectAdbDevServerPort(
        targetSerial,
        foreground ?? ''
      )

      if (port) setDevServerPort(String(port))
    } catch {
      // 应用未启动或开发服务器不可达时保留现有值。
    }
  }, [])

  const refreshReverse = useCallback(
    async (targetSerial: string): Promise<void> => {
      if (!targetSerial) {
        setReverseEntries([])
        return
      }

      setReverseLoading(true)

      try {
        const next = await window.electron.listAdbReverse(targetSerial)
        setReverseEntries(next)
        setDevServerPort((current) =>
          next.some((entry) => String(entry.port) === current)
            ? current
            : next[0]?.port
              ? String(next[0].port)
              : current
        )
      } catch (error) {
        setReverseEntries([])
        message.error(getErrorMessage(error, '读取 reverse 列表失败'))
      } finally {
        setReverseLoading(false)
      }
    },
    [message]
  )

  const loadDevTools = useCallback(async (): Promise<void> => {
    const requestId = ++devToolsRequestRef.current

    if (!online || !serial) {
      setDevToolsUrl(null)
      setDevToolsError(null)
      setDevToolsLoading(false)
      return
    }

    const port = Number(devServerPort)

    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      setDevToolsUrl(null)
      setDevToolsError('Dev Server 端口不合法')
      setDevToolsLoading(false)
      return
    }

    setDevToolsLoading(true)
    setDevToolsError(null)

    try {
      const url = await window.electron.getAdbDevToolsUrl(port, packageName)

      if (requestId !== devToolsRequestRef.current) return

      setDevToolsUrl(url)
    } catch (error) {
      if (requestId !== devToolsRequestRef.current) return

      setDevToolsUrl(null)
      setDevToolsError(getErrorMessage(error, '连接 DevTools 失败'))
    } finally {
      if (requestId === devToolsRequestRef.current) {
        setDevToolsLoading(false)
      }
    }
  }, [devServerPort, online, packageName, serial])

  useEffect(() => {
    void loadDevTools()
  }, [loadDevTools])

  const loadPageSpyRoom = useCallback(async (): Promise<void> => {
    const requestId = ++pageSpyRequestRef.current

    if (!online || !serial) {
      setPageSpyRoom(null)
      setPageSpyError(null)
      setPageSpyLoading(false)
      return
    }

    setPageSpyLoading(true)
    setPageSpyError(null)

    try {
      const room = await window.electron.getAdbPageSpyRoom(
        serial,
        packageName.trim() || undefined
      )

      if (requestId !== pageSpyRequestRef.current) return

      setPageSpyRoom(room)
    } catch (error) {
      if (requestId !== pageSpyRequestRef.current) return

      setPageSpyRoom(null)
      setPageSpyError(getErrorMessage(error, '定位 PageSpy 房间失败'))
    } finally {
      if (requestId === pageSpyRequestRef.current) {
        setPageSpyLoading(false)
      }
    }
  }, [online, packageName, serial])

  useEffect(() => {
    if (inspectorTab === 'pagespy') {
      void loadPageSpyRoom()
    }
  }, [inspectorTab, loadPageSpyRoom])

  const refreshAdb = useCallback(
    async (notify = false): Promise<void> => {
      setInfoRefreshing(true)

      try {
        const next = await window.electron.getAdbInfo()
        setInfo(next)

        if (next.available) {
          const nextDevices = await refreshDevices(notify)
          const target =
            nextDevices.find(
              (device) => device.serial === serial && device.state === 'device'
            ) ?? nextDevices.find((device) => device.state === 'device')

          if (target) await refreshRuntimeInfo(target.serial)
        } else if (notify) {
          message.warning('未检测到可用的 ADB')
        }
      } catch (error) {
        if (notify) message.error(getErrorMessage(error, '检测 ADB 失败'))
      } finally {
        setInfoRefreshing(false)
      }
    },
    [message, refreshDevices, refreshRuntimeInfo, serial]
  )

  useEffect(() => {
    let cancelled = false

    window.electron
      .getAdbInfo()
      .then((next) => {
        if (!cancelled) setInfo(next)
      })
      .catch(() => {
        if (!cancelled) setInfo(null)
      })
      .finally(() => {
        if (!cancelled) setInfoLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!info?.available) return
    void refreshDevices()
  }, [info?.available, refreshDevices])

  useEffect(() => {
    const handleFocus = (): void => {
      void refreshAdb()
    }

    window.addEventListener('focus', handleFocus)

    return () => {
      window.removeEventListener('focus', handleFocus)
    }
  }, [refreshAdb])

  useEffect(() => {
    localStorage.setItem(DEVICE_KEY, serial)
  }, [serial])

  useEffect(() => {
    if (!online || !serial) return
    void refreshRuntimeInfo(serial)
  }, [online, refreshRuntimeInfo, serial])

  useEffect(() => {
    if (!online) {
      setReverseEntries([])
      return
    }

    void refreshReverse(serial)
  }, [online, refreshReverse, serial])

  useEffect(() => {
    const unsubscribe = window.electron.onAdbScreenRecordFinished((event) => {
      if (event.sessionId !== recordSessionRef.current) return

      recordSessionRef.current = null
      setRecording(false)
      setRecordStopping(false)

      if (event.error) {
        message.error(event.error)
      } else if (event.result) {
        setRecordResult(event.result)
      }
    })

    return unsubscribe
  }, [message])

  useEffect(() => {
    return () => {
      if (recordSessionRef.current) {
        void window.electron
          .stopAdbScreenRecord(recordSessionRef.current)
          .catch(() => undefined)
      }
    }
  }, [])

  const handleDeviceChange = (value: string): void => {
    setPackageName('')
    setSerial(value)
  }

  const requireOnline = (): boolean => {
    if (!online || !serial) {
      message.warning('请先选择一台在线设备')
      return false
    }

    return true
  }

  const requirePackage = (): boolean => {
    if (!requireOnline()) return false

    if (!packageName.trim()) {
      message.warning('请先选择或输入应用包名')
      return false
    }

    return true
  }

  const handleReload = (): void => {
    if (!requireOnline()) return

    const port = Number(devServerPort)

    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      message.warning('请输入 1-65535 之间的开发服务器端口')
      return
    }

    void execute(
      '刷新页面',
      () => window.electron.reloadReactNativeApp(port),
      '已发送刷新信号'
    )
  }

  const handleDevMenu = (): void => {
    if (!requireOnline()) return
    void execute('打开开发菜单', () =>
      window.electron.openAdbDevMenu(serial)
    )
  }

  const handleAddReverse = (): void => {
    if (!requireOnline()) return

    const port = Number(reversePort)

    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      message.warning('请输入 1-65535 之间的端口')
      return
    }

    void execute(
      `添加 reverse ${port}`,
      async () => {
        const result = await window.electron.addAdbReverse(serial, port)
        await refreshReverse(serial)
        return result
      },
      `已添加 reverse ${port}`
    )
  }

  const handleRemoveReverse = (port: number): void => {
    if (!requireOnline()) return

    void execute(
      `移除 reverse ${port}`,
      async () => {
        const result = await window.electron.removeAdbReverse(serial, port)
        await refreshReverse(serial)
        return result
      },
      `已移除 reverse ${port}`
    )
  }

  const handleScreenshot = (): void => {
    if (!requireOnline()) return

    setExecuting('截图')

    window.electron
      .takeAdbScreenshot(serial)
      .then((result) => setScreenshot(result))
      .catch((error) => message.error(getErrorMessage(error, '截图失败')))
      .finally(() => setExecuting(null))
  }

  const handleOpenScreenshotFolder = async (): Promise<void> => {
    if (!screenshot) return

    try {
      await window.electron.openDirectory(screenshot.directory)
    } catch (error) {
      message.error(getErrorMessage(error, '打开截图文件夹失败'))
    }
  }

  const handleCopyScreenshot = async (): Promise<void> => {
    if (!screenshot) return

    try {
      await window.electron.copyAdbScreenshot(screenshot.dataUrl)
      message.success('截图已复制到剪贴板')
    } catch (error) {
      message.error(getErrorMessage(error, '复制截图失败'))
    }
  }

  const handleOpenAppSettings = (): void => {
    if (!requirePackage()) return

    void execute(
      '打开应用设置',
      () => window.electron.openAdbAppSettings(serial, packageName.trim()),
      '已打开应用设置'
    )
  }

  const handleOpenDeepLink = async (): Promise<void> => {
    if (!requireOnline()) return

    const url = deepLinkUrl.trim()

    if (!url) {
      message.warning('请输入深链地址')
      return
    }

    const result = await execute(
      '打开深链',
      () =>
        window.electron.openAdbDeepLink(
          serial,
          url,
          packageName.trim() || undefined
        ),
      '深链已发送'
    )

    if (result) {
      setDeepLinkOpen(false)
      setDeepLinkUrl('')
    }
  }

  const loadAppInfo = async (): Promise<void> => {
    if (!packageName.trim()) return

    setAppInfoLoading(true)
    setAppInfoError(null)

    try {
      setAppInfo(await window.electron.getAdbAppInfo(serial, packageName.trim()))
    } catch (error) {
      setAppInfoError(getErrorMessage(error, '读取应用信息失败'))
      setAppInfo(null)
    } finally {
      setAppInfoLoading(false)
    }
  }

  const handleOpenAppInfo = (): void => {
    if (!requirePackage()) return
    setAppInfoOpen(true)
    void loadAppInfo()
  }

  const loadPermissions = async (): Promise<void> => {
    if (!packageName.trim()) return

    setPermissionsLoading(true)
    setPermissionsError(null)

    try {
      setPermissions(
        await window.electron.listAdbPermissions(serial, packageName.trim())
      )
    } catch (error) {
      setPermissionsError(getErrorMessage(error, '读取应用权限失败'))
      setPermissions([])
    } finally {
      setPermissionsLoading(false)
    }
  }

  const handleOpenPermissions = (): void => {
    if (!requirePackage()) return
    setPermissionsKeyword('')
    setPermissionsOpen(true)
    void loadPermissions()
  }

  const filteredPermissions = useMemo(() => {
    const keyword = permissionsKeyword.trim().toLowerCase()

    if (!keyword) return permissions

    return permissions.filter((permission) =>
      permission.name.toLowerCase().includes(keyword)
    )
  }, [permissions, permissionsKeyword])

  const grantedPermissionCount = useMemo(
    () => permissions.filter((permission) => permission.granted).length,
    [permissions]
  )

  const handlePermissionChange = async (
    permission: AdbPermissionInfo,
    granted: boolean
  ): Promise<void> => {
    setPermissionUpdating(permission.name)

    try {
      await window.electron.setAdbPermission(
        serial,
        packageName.trim(),
        permission.name,
        granted
      )
      setPermissions((current) =>
        current.map((item) =>
          item.name === permission.name ? { ...item, granted } : item
        )
      )
      message.success(granted ? '权限已授予' : '权限已撤销')
    } catch (error) {
      message.error(getErrorMessage(error, '修改权限失败'))
    } finally {
      setPermissionUpdating(null)
    }
  }

  const handleRecordScreen = async (): Promise<void> => {
    if (!requireOnline()) return

    setRecordStarting(true)

    try {
      const result = await window.electron.startAdbScreenRecord(serial)
      recordSessionRef.current = result.sessionId
      setRecording(true)
    } catch (error) {
      message.error(getErrorMessage(error, '启动录屏失败'))
    } finally {
      setRecordStarting(false)
    }
  }

  const handleStopRecord = async (): Promise<void> => {
    const sessionId = recordSessionRef.current

    if (!sessionId) return

    setRecordStopping(true)

    try {
      await window.electron.stopAdbScreenRecord(sessionId)
    } catch (error) {
      message.error(getErrorMessage(error, '停止录屏失败'))
    } finally {
      setRecordStopping(false)
    }
  }

  const handleOpenRecordFolder = async (): Promise<void> => {
    if (!recordResult) return

    try {
      await window.electron.openDirectory(recordResult.directory)
    } catch (error) {
      message.error(getErrorMessage(error, '打开录屏文件夹失败'))
    }
  }

  return (
    <div className="adb-tools-page">
      <header className="adb-tools-header">
        <div className="adb-tools-heading">
          <span className="adb-tools-eyebrow">开发环境 / Android</span>
          <h1>ADB 工具</h1>
          <p>连接本地模拟器，快速刷新页面，并直接在右侧查看 React Native DevTools 或 PageSpy 网络。</p>
        </div>
        <div className="adb-tools-header-actions">
          {info?.available ? (
            <Tag color="green" bordered={false}>
              ADB {info.version ?? '可用'}
            </Tag>
          ) : null}
          <Tooltip title="重新检测 ADB 路径、版本并刷新设备">
            <Button
              type="text"
              icon={<ReloadOutlined />}
              loading={infoRefreshing || devicesLoading}
              onClick={() => void refreshAdb(true)}
            >
              重新检测
            </Button>
          </Tooltip>
        </div>
      </header>

      <main className="adb-tools-content">
        {infoLoading ? (
          <div className="adb-tools-loading">
            <Spin />
          </div>
        ) : !info?.available ? (
          <Alert
            type="warning"
            showIcon
            message="还没有可用的 ADB"
            description="请先在设置中配置 Android SDK 的 adb，或点击自动检测。"
            action={
              <Button size="small" onClick={() => onOpenSettings('adb')}>
                去设置
              </Button>
            }
          />
        ) : (
          <div className="adb-tools-grid">
            <div className="adb-tools-column">
              <section className="adb-card">
                <div className="adb-card-heading">
                  <span className="adb-card-title">
                    <AndroidOutlined />
                    设备
                  </span>
                  <Tooltip title="只刷新设备列表">
                    <Button
                      type="text"
                      size="small"
                      icon={<ReloadOutlined />}
                      loading={devicesLoading}
                      onClick={() => void refreshDevices()}
                    >
                      刷新
                    </Button>
                  </Tooltip>
                </div>

                <Select
                  className="adb-device-select"
                  value={serial || undefined}
                  options={devices.map((device) => ({
                    value: device.serial,
                    label: `${device.label} · ${device.serial}`
                  }))}
                  placeholder={
                    devices.length === 0 ? '未发现设备' : '选择设备'
                  }
                  loading={devicesLoading}
                  onChange={handleDeviceChange}
                />

                {selectedDevice ? (
                  <div className="adb-device-meta">
                    <Tag
                      color={DEVICE_STATE_META[selectedDevice.state].color}
                      bordered={false}
                    >
                      {DEVICE_STATE_META[selectedDevice.state].label}
                    </Tag>
                    <span>{selectedDevice.serial}</span>
                  </div>
                ) : (
                  <p className="adb-empty-hint">
                    启动模拟器后点击刷新，设备会自动出现在这里。
                  </p>
                )}
              </section>

              <section className="adb-card">
                <div className="adb-card-heading">
                  <span className="adb-card-title">
                    <CodeOutlined />
                    应用操作
                  </span>
                </div>

                <div className="adb-runtime-meta">
                  <Tag color="blue" bordered={false}>
                    应用：{packageName || '未识别'}
                  </Tag>
                  <Tag bordered={false}>Dev Server：{devServerPort}</Tag>
                </div>

                <div className="adb-action-grid">
                  <Button
                    type="primary"
                    icon={<ReloadOutlined />}
                    disabled={!online || Boolean(executing)}
                    loading={executing === '刷新页面'}
                    onClick={handleReload}
                  >
                    刷新页面
                  </Button>
                  <Button
                    type="primary"
                    ghost
                    icon={<BugOutlined />}
                    disabled={!online || Boolean(executing)}
                    loading={executing === '打开开发菜单'}
                    onClick={handleDevMenu}
                  >
                    开发菜单
                  </Button>
                  {recording ? (
                    <Button
                      danger
                      icon={<StopOutlined />}
                      loading={recordStopping}
                      disabled={recordStopping}
                      onClick={() => void handleStopRecord()}
                    >
                      停止录屏
                    </Button>
                  ) : (
                    <Button
                      icon={<VideoCameraOutlined />}
                      loading={recordStarting}
                      disabled={!online || recordStarting || Boolean(executing)}
                      onClick={() => void handleRecordScreen()}
                    >
                      录屏
                    </Button>
                  )}
                  <Button
                    icon={<CameraOutlined />}
                    disabled={!online || Boolean(executing)}
                    loading={executing === '截图'}
                    onClick={handleScreenshot}
                  >
                    截图
                  </Button>
                  <Button
                    icon={<AppstoreOutlined />}
                    disabled={!online || !packageName || Boolean(executing)}
                    loading={executing === '打开应用设置'}
                    onClick={handleOpenAppSettings}
                  >
                    应用设置
                  </Button>
                  <Button
                    icon={<InfoCircleOutlined />}
                    disabled={!online || !packageName || Boolean(executing)}
                    onClick={handleOpenAppInfo}
                  >
                    应用信息
                  </Button>
                  <Button
                    icon={<SafetyCertificateOutlined />}
                    disabled={!online || !packageName || Boolean(executing)}
                    onClick={handleOpenPermissions}
                  >
                    权限
                  </Button>
                  <Button
                    icon={<LinkOutlined />}
                    disabled={!online || Boolean(executing)}
                    onClick={() => setDeepLinkOpen(true)}
                  >
                    深链
                  </Button>
                </div>
              </section>

              <section className="adb-card">
                <div className="adb-card-heading">
                  <span className="adb-card-title">
                    <LinkOutlined />
                    Metro Reverse
                  </span>
                  <Button
                    type="text"
                    size="small"
                    icon={<ReloadOutlined />}
                    loading={reverseLoading}
                    onClick={() => void refreshReverse(serial)}
                  />
                </div>

                <div className="adb-reverse-list">
                  {reverseEntries.length > 0 ? (
                    reverseEntries.map((entry) => (
                      <div className="adb-reverse-item" key={entry.raw}>
                        <Tag color="blue" bordered={false}>
                          {entry.port ? `:${entry.port}` : entry.raw}
                        </Tag>
                        {entry.port ? (
                          <Popconfirm
                            title={`移除 reverse :${entry.port}？`}
                            description="移除后设备可能无法通过 localhost 访问对应的开发服务器。"
                            okText="移除"
                            cancelText="取消"
                            okButtonProps={{ danger: true }}
                            onConfirm={() =>
                              handleRemoveReverse(entry.port as number)
                            }
                          >
                            <Button
                              type="text"
                              size="small"
                              danger
                              icon={<ClearOutlined />}
                            >
                              移除
                            </Button>
                          </Popconfirm>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <span className="adb-empty-hint">还没有 reverse 端口</span>
                  )}
                </div>

                <div className="adb-reverse-add">
                  <Input
                    value={reversePort}
                    addonBefore="tcp"
                    onChange={(event) => setReversePort(event.target.value)}
                  />
                  <Button
                    variant="text"
                    color="primary"
                    icon={<LinkOutlined />}
                    disabled={!online || Boolean(executing)}
                    onClick={handleAddReverse}
                  >
                    添加
                  </Button>
                </div>
              </section>
            </div>

            <div className="adb-tools-output">
              <div className="adb-inspector-tabs">
                <div
                  className="adb-inspector-tab-list"
                  role="tablist"
                  aria-label="调试面板"
                >
                  <button
                    id="adb-tab-devtools"
                    type="button"
                    role="tab"
                    aria-selected={inspectorTab === 'devtools'}
                    aria-controls="adb-panel-devtools"
                    className={
                      inspectorTab === 'devtools'
                        ? 'adb-inspector-tab is-active'
                        : 'adb-inspector-tab'
                    }
                    onClick={() => setInspectorTab('devtools')}
                  >
                    <CodeOutlined />
                    React Native DevTools
                  </button>
                  <button
                    id="adb-tab-pagespy"
                    type="button"
                    role="tab"
                    aria-selected={inspectorTab === 'pagespy'}
                    aria-controls="adb-panel-pagespy"
                    className={
                      inspectorTab === 'pagespy'
                        ? 'adb-inspector-tab is-active'
                        : 'adb-inspector-tab'
                    }
                    onClick={() => setInspectorTab('pagespy')}
                  >
                    <LinkOutlined />
                    PageSpy 网络
                  </button>
                </div>
                <div className="adb-inspector-actions">
                  {inspectorTab === 'devtools' ? (
                    <>
                      <Tag bordered={false}>Dev Server :{devServerPort}</Tag>
                      <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        loading={devToolsLoading}
                        onClick={() => void loadDevTools()}
                      >
                        重连
                      </Button>
                    </>
                  ) : (
                    <>
                      <Tooltip title={pageSpyRoom?.title ?? undefined}>
                        <Tag bordered={false}>
                          {pageSpyRoom?.name ?? '未定位房间'}
                        </Tag>
                      </Tooltip>
                      <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        loading={pageSpyLoading}
                        onClick={() => void loadPageSpyRoom()}
                      >
                        重新定位
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="adb-inspector-content">
                {inspectorTab === 'devtools' ? (
                  <div
                    id="adb-panel-devtools"
                    className="adb-devtools-panel"
                    role="tabpanel"
                    aria-labelledby="adb-tab-devtools"
                  >
                    <div className="adb-devtools-body">
                      {devToolsLoading ? (
                        <div className="adb-modal-loading">
                          <Spin />
                        </div>
                      ) : devToolsError ? (
                        <Alert
                          type="warning"
                          showIcon
                          message="DevTools 暂不可用"
                          description={devToolsError}
                        />
                      ) : devToolsUrl ? (
                        <iframe
                          key={devToolsUrl}
                          className="adb-devtools-frame"
                          src={devToolsUrl}
                          title="React Native DevTools"
                        />
                      ) : (
                        <p className="adb-modal-hint">
                          启动 App 后点击「重连」加载 React Native DevTools。
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div
                    id="adb-panel-pagespy"
                    className="adb-devtools-panel"
                    role="tabpanel"
                    aria-labelledby="adb-tab-pagespy"
                  >
                    <div className="adb-devtools-body">
                      {pageSpyLoading && !pageSpyRoom ? (
                        <div className="adb-modal-loading">
                          <Spin />
                        </div>
                      ) : pageSpyError && !pageSpyRoom ? (
                        <Alert
                          type="warning"
                          showIcon
                          message="PageSpy 房间暂不可用"
                          description={pageSpyError}
                        />
                      ) : pageSpyRoom ? (
                        <iframe
                          key={pageSpyRoom.url}
                          className="adb-devtools-frame"
                          src={pageSpyRoom.url}
                          title="PageSpy 网络"
                        />
                      ) : (
                        <p className="adb-modal-hint">
                          在 App 中打开 PageSpy 后，点击「重新定位」加载网络面板。
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <Modal
        title="深链测试"
        open={deepLinkOpen}
        okText="打开"
        cancelText="取消"
        confirmLoading={executing === '打开深链'}
        destroyOnHidden
        onOk={() => void handleOpenDeepLink()}
        onCancel={() => setDeepLinkOpen(false)}
      >
        <p className="adb-modal-hint">
          支持自定义 Scheme 或 http/https，例如 myapp://detail/123。
        </p>
        <Input
          value={deepLinkUrl}
          placeholder="myapp://detail/123"
          spellCheck={false}
          onChange={(event) => setDeepLinkUrl(event.target.value)}
        />
        <p className="adb-modal-hint">
          当前应用：{packageName || '未识别，将不限定目标应用'}
        </p>
      </Modal>

      <Modal
        title="应用信息"
        open={appInfoOpen}
        width={620}
        footer={[
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            loading={appInfoLoading}
            onClick={() => void loadAppInfo()}
          >
            刷新
          </Button>,
          <Button key="close" onClick={() => setAppInfoOpen(false)}>
            关闭
          </Button>
        ]}
        destroyOnHidden
        onCancel={() => setAppInfoOpen(false)}
      >
        {appInfoLoading ? (
          <div className="adb-modal-loading">
            <Spin />
          </div>
        ) : appInfoError ? (
          <Alert type="error" showIcon message={appInfoError} />
        ) : appInfo ? (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="包名">
              {appInfo.packageName}
            </Descriptions.Item>
            <Descriptions.Item label="版本">
              {appInfo.versionName ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label="版本号">
              {appInfo.versionCode ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label="SDK">
              target {appInfo.targetSdk ?? '-'} / min {appInfo.minSdk ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Debuggable">
              {appInfo.debuggable ? (
                <Tag color="green" bordered={false}>
                  是
                </Tag>
              ) : (
                <Tag bordered={false}>否</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="运行状态">
              {appInfo.running ? (
                <span>
                  运行中 <code>PID {appInfo.pid}</code>
                </span>
              ) : (
                '未运行'
              )}
            </Descriptions.Item>
          </Descriptions>
        ) : null}
      </Modal>

      <Modal
        title="应用权限"
        open={permissionsOpen}
        width={700}
        footer={[
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            loading={permissionsLoading}
            onClick={() => void loadPermissions()}
          >
            刷新
          </Button>,
          <Button key="close" onClick={() => setPermissionsOpen(false)}>
            关闭
          </Button>
        ]}
        destroyOnHidden
        onCancel={() => setPermissionsOpen(false)}
      >
        {permissionsLoading ? (
          <div className="adb-modal-loading">
            <Spin />
          </div>
        ) : permissionsError ? (
          <Alert type="error" showIcon message={permissionsError} />
        ) : (
          <>
            <div className="adb-permission-overview">
              <div className="adb-permission-app">
                <span>应用</span>
                <strong title={packageName}>{packageName}</strong>
              </div>
              <div className="adb-permission-counts">
                <Tag color="green" bordered={false}>
                  已授权 {grantedPermissionCount}
                </Tag>
                <Tag bordered={false}>
                  未授权 {permissions.length - grantedPermissionCount}
                </Tag>
              </div>
            </div>

            {permissions.length > 0 ? (
              <>
                <Input
                  className="adb-permission-search"
                  prefix={<SearchOutlined />}
                  value={permissionsKeyword}
                  placeholder="搜索权限"
                  allowClear
                  onChange={(event) => setPermissionsKeyword(event.target.value)}
                />
                {filteredPermissions.length > 0 ? (
                  <div className="adb-permission-list">
                    {filteredPermissions.map((permission) => (
                      <div
                        className={`adb-permission-row${
                          permission.granted ? ' is-granted' : ''
                        }`}
                        key={permission.name}
                      >
                        <span className="adb-permission-icon">
                          <SafetyCertificateOutlined />
                        </span>
                        <div className="adb-permission-copy">
                          <strong>
                            {(
                              permission.name.split('.').pop() ?? permission.name
                            ).replace(/_/g, ' ')}
                          </strong>
                          <code title={permission.name}>{permission.name}</code>
                        </div>
                        <div className="adb-permission-status">
                          <span
                            className={
                              permission.granted ? 'is-granted' : undefined
                            }
                          >
                            {permission.granted ? '已授权' : '未授权'}
                          </span>
                          <Switch
                            size="small"
                            checked={permission.granted}
                            loading={permissionUpdating === permission.name}
                            onChange={(granted) =>
                              void handlePermissionChange(permission, granted)
                            }
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="adb-permission-empty">没有匹配的权限</p>
                )}
              </>
            ) : (
              <p className="adb-permission-empty">
                没有读取到运行时可切换权限。
              </p>
            )}
          </>
        )}
      </Modal>

      <Modal
        title="录屏已完成"
        open={Boolean(recordResult)}
        destroyOnHidden
        onCancel={() => setRecordResult(null)}
        footer={[
          <Button key="ok" type="primary" onClick={() => setRecordResult(null)}>
            确定
          </Button>
        ]}
      >
        <p className="adb-modal-hint">录屏文件已保存到：</p>
        <div className="adb-result-path-row">
          <p className="adb-modal-path">{recordResult?.filePath}</p>
          <div className="adb-result-actions">
            <Tooltip title="打开文件夹">
              <Button
                type="text"
                size="small"
                icon={<FolderOpenOutlined />}
                aria-label="打开录屏文件夹"
                onClick={() => void handleOpenRecordFolder()}
              />
            </Tooltip>
          </div>
        </div>
      </Modal>

      <Modal
        title="截图已完成"
        open={Boolean(screenshot)}
        destroyOnHidden
        onCancel={() => setScreenshot(null)}
        footer={[
          <Button key="ok" type="primary" onClick={() => setScreenshot(null)}>
            确定
          </Button>
        ]}
      >
        {screenshot ? (
          <>
            <p className="adb-modal-hint">截图已保存到：</p>
            <div className="adb-result-path-row">
              <p className="adb-modal-path">{screenshot.filePath}</p>
              <div className="adb-result-actions">
                <Tooltip title="打开文件夹">
                  <Button
                    type="text"
                    size="small"
                    icon={<FolderOpenOutlined />}
                    aria-label="打开截图文件夹"
                    onClick={() => void handleOpenScreenshotFolder()}
                  />
                </Tooltip>
                <Tooltip title="复制图片">
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    aria-label="复制截图"
                    onClick={() => void handleCopyScreenshot()}
                  />
                </Tooltip>
              </div>
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  )
}
