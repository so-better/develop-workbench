import { useCallback, useEffect, useRef, useState } from 'react'
import { App as AntdApp, Modal, Spin } from 'antd'
import AppFooter from './components/AppFooter/AppFooter'
import AppTitleBar from './components/AppTitleBar/AppTitleBar'
import QuickAccess from './components/QuickAccess/QuickAccess'
import AppNavigation from './components/AppNavigation/AppNavigation'
import LinkContextMenu from './components/LinkContextMenu/LinkContextMenu'
import ProductGuide from './components/ProductGuide/ProductGuide'
import ChangelogModal from './components/ChangelogModal/ChangelogModal'
import FeedbackModal from './components/FeedbackSettings/FeedbackModal'
import QuickNotes from './components/QuickNotes/QuickNotes'
import UpdatePrompt from './components/UpdatePrompt/UpdatePrompt'
import { APP_PAGES } from './navigation'
import type { AppPage } from './navigation'
import EmbeddedBrowserDownloads from './components/EmbeddedBrowserDownloads/EmbeddedBrowserDownloads'
import EmbeddedBrowserPanel from './components/EmbeddedBrowserPanel/EmbeddedBrowserPanel'
import EnvironmentSetup from './pages/EnvironmentSetup/EnvironmentSetup'
import SettingsModal from './components/SettingsModal/SettingsModal'
import { useSettingsDialog } from './components/SettingsModal/SettingsDialogProvider'
import { useAiChatDialog } from './hooks/useAiChatDialog'
import { useEmbeddedDownloads } from './hooks/useEmbeddedDownloads'
import { useQuickNotes } from './hooks/useQuickNotes'
import type { AppInfo } from '../../types/app'
import type { AuthExpiredEvent } from '../../types/auth'
import type { LarkCliInfo, LarkUser } from '../../types/lark'
import type { MeegleState } from '../../types/meegle'
import changelogContent from '../../../CHANGELOG.md?raw'
import type { UpdateCheckResult } from '../../types/updates'
import { getErrorMessage } from '../../utils'
import './App.css'


interface EnvironmentStatus {
  meegleAuthenticated: boolean
  larkAuthenticated: boolean
  stale: boolean
}

/**
 * 应用根组件。
 * 应用本身没有登录态；Meegle Cli 和 Lark Cli 都完成授权后才能进入工作台。
 */
export default function App(): JSX.Element {
  const { message, modal } = AntdApp.useApp()

  // 应用版本及运行时信息，用于 Footer 和设置弹窗。
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)

  // 本地 CLI 的授权状态，不代表应用自身登录。
  const [larkUser, setLarkUser] = useState<LarkUser | null>(null)
  const [larkCliInfo, setLarkCliInfo] = useState<LarkCliInfo | null>(null)
  const [meegleState, setMeegleState] = useState<MeegleState | null>(null)
  const [environmentLoading, setEnvironmentLoading] = useState(true)
  const [environmentRefreshing, setEnvironmentRefreshing] = useState(false)
  const [authExpiredNotice, setAuthExpiredNotice] = useState<AuthExpiredEvent | null>(null)
  const environmentRequestRef = useRef(0)

  // 设置弹窗开关状态及打开时定位到的设置分类。
  const [workspace, setWorkspace] = useState<AppPage>('requirements')
  const [visitedPages, setVisitedPages] = useState<Set<AppPage>>(
    () => new Set<AppPage>(['requirements'])
  )
  const [terminalRequest, setTerminalRequest] = useState<{
    cwd: string
    token: number
  } | null>(null)

  // 内嵌浏览器下载状态统一由应用层维护，Footer 和浏览器面板共用。
  const { downloads, activeCount } = useEmbeddedDownloads()
  const [browserVisible, setBrowserVisible] = useState(false)
  // 面板收起后仍保留的页面数量，用于底部栏恢复入口。
  const [browserTabCount, setBrowserTabCount] = useState(0)
  const [downloadsPanelOpen, setDownloadsPanelOpen] = useState(false)
  const [downloadsModalOpen, setDownloadsModalOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [guideWelcome, setGuideWelcome] = useState(false)
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [quickNotesOpen, setQuickNotesOpen] = useState(false)
  const quickNotes = useQuickNotes()
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [windowShowCount, setWindowShowCount] = useState(0)
  const updateOpenRef = useRef(false)
  const autoUpdateCheckRequestRef = useRef(0)
  const sessionDismissedUpdateVersionRef = useRef<string | null>(null)

  /**
   * 重新读取本地 CLI 安装和授权状态。
   * 这里不做应用登录判断，只反映环境是否具备对应能力。
   */
  const refreshEnvironment = useCallback(
    async (showLoading = false): Promise<EnvironmentStatus> => {
      const requestId = ++environmentRequestRef.current

      if (showLoading) setEnvironmentLoading(true)

      const [meegleResult, larkUserResult, larkCliResult] = await Promise.allSettled([
        window.electron.getMeegleState(),
        window.electron.getLarkUser(),
        window.electron.getLarkCliInfo()
      ])

      const nextMeegle =
        meegleResult.status === 'fulfilled' ? meegleResult.value : null
      const nextLarkUser =
        larkUserResult.status === 'fulfilled' ? larkUserResult.value : null
      const status: EnvironmentStatus = {
        meegleAuthenticated: nextMeegle?.authenticated ?? false,
        larkAuthenticated: Boolean(nextLarkUser),
        stale: requestId !== environmentRequestRef.current
      }

      // 旧请求不能覆盖新的登录状态，也不能提前结束初始 loading，
      // 否则会短暂渲染出未授权的环境准备页。
      if (status.stale) return status

      setMeegleState(nextMeegle)
      setLarkUser(nextLarkUser)
      setLarkCliInfo(
        larkCliResult.status === 'fulfilled' ? larkCliResult.value : null
      )
      setEnvironmentLoading(false)

      // 状态已恢复时清掉旧的授权过期提示，避免后续再次回到环境页时误显示。
      setAuthExpiredNotice((current) => {
        if (!current) return current
        if (current.provider === 'meegle' && status.meegleAuthenticated) {
          return null
        }
        if (current.provider === 'lark' && status.larkAuthenticated) {
          return null
        }
        return current
      })

      return status
    },
    []
  )

  const handleRefreshEnvironment = useCallback(async (): Promise<void> => {
    setEnvironmentRefreshing(true)

    try {
      await refreshEnvironment()
    } finally {
      setEnvironmentRefreshing(false)
    }
  }, [refreshEnvironment])

  const {
    open: settingsOpen,
    section: settingsSection,
    openSettings,
    closeSettings
  } = useSettingsDialog()
  const { openAiDialog, isOpen: aiDialogOpen } = useAiChatDialog()

  useEffect(() => {
    let mounted = true

    window.electron
      .getEmbeddedBrowserState()
      .then((state) => {
        if (mounted) {
          setBrowserVisible(state.visible)
          setBrowserTabCount(state.tabs.length)
        }
      })
      .catch(() => undefined)

    const unsubscribe = window.electron.onEmbeddedBrowserState((state) => {
      setBrowserVisible(state.visible)
      setBrowserTabCount(state.tabs.length)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!browserVisible) setDownloadsPanelOpen(false)
  }, [browserVisible])

  useEffect(() => {
    let mounted = true

    // 应用信息只需读取一次。
    window.electron
      .getAppInfo()
      .then((info) => {
        if (mounted) setAppInfo(info)
      })
      .catch(() => undefined)

    // 首次进入读取环境状态；窗口重新显示时静默刷新。
    refreshEnvironment(true)
    const unsubscribeWindow = window.electron.onWindowShown(() => {
      setWindowShowCount((value) => value + 1)
      refreshEnvironment()
    })
    const unsubscribeMeegle = window.electron.onMeegleLoginEvent((event) => {
      if (event.status === 'success') {
        setAuthExpiredNotice((current) =>
          current?.provider === 'meegle' ? null : current
        )
      }
      refreshEnvironment()
    })
    const unsubscribeLark = window.electron.onLarkLoginEvent((event) => {
      if (event.status === 'success') {
        setAuthExpiredNotice((current) =>
          current?.provider === 'lark' ? null : current
        )
      }
      refreshEnvironment()
    })
    const unsubscribeAuth = window.electron.onAuthExpired((event) => {
      refreshEnvironment().then((status) => {
        if (status.stale) return

        const expired =
          event.provider === 'meegle'
            ? !status.meegleAuthenticated
            : !status.larkAuthenticated

        if (!expired) {
          setAuthExpiredNotice((current) =>
            current?.provider === event.provider ? null : current
          )
          return
        }

        setAuthExpiredNotice(event)
        message.warning({
          content: event.message,
          key: `auth-expired-${event.provider}`
        })
      })
    })

    return () => {
      mounted = false
      unsubscribeWindow()
      unsubscribeMeegle()
      unsubscribeLark()
      unsubscribeAuth()
    }
  }, [message, refreshEnvironment])

  const handlePageChange = useCallback((page: AppPage): void => {
    setVisitedPages((current) => {
      if (current.has(page)) return current

      const next = new Set(current)
      next.add(page)
      return next
    })
    setWorkspace(page)
  }, [])

  const handleTerminalRequestHandled = useCallback((): void => {
    setTerminalRequest(null)
  }, [])

  /** 快速访问打开本地需求时切换到需求页。 */
  useEffect(() => {
    const handleOpenRequirement = (): void => {
      handlePageChange('requirements')
    }

    window.addEventListener('workbench:open-requirement', handleOpenRequirement)

    return () => {
      window.removeEventListener('workbench:open-requirement', handleOpenRequirement)
    }
  }, [handlePageChange])

  /** 从代码仓库页打开终端时，携带工作目录切换到终端页。 */
  useEffect(() => {
    const handleOpenTerminal = (event: Event): void => {
      const detail = (event as CustomEvent<{ cwd?: unknown }>).detail

      if (!detail || typeof detail.cwd !== 'string' || !detail.cwd) return

      setTerminalRequest({ cwd: detail.cwd, token: Date.now() })
      handlePageChange('terminal')
    }

    window.addEventListener('workbench:open-terminal', handleOpenTerminal)

    return () => {
      window.removeEventListener('workbench:open-terminal', handleOpenTerminal)
    }
  }, [handlePageChange])

  const handleOpenDownloads = useCallback((): void => {
    if (browserVisible) {
      setDownloadsPanelOpen((value) => !value)
      return
    }

    setDownloadsModalOpen(true)
  }, [browserVisible])

  const meegleAuthenticated = meegleState?.authenticated ?? false
  const larkAuthenticated = Boolean(larkUser)
  const environmentReady =
    meegleAuthenticated && larkAuthenticated && Boolean(larkCliInfo?.available)

  useEffect(() => {
    if (environmentLoading) return

    if (environmentReady) {
      setAuthExpiredNotice(null)
      return
    }

    // 原生浏览视图不会随 React 组件卸载，环境不可用时必须主动关闭。
    window.electron.closeEmbeddedBrowser()
    setDownloadsPanelOpen(false)
    setDownloadsModalOpen(false)
  }, [environmentLoading, environmentReady])

  useEffect(() => {
    if (environmentLoading || !environmentReady) return

    let cancelled = false

    window.electron
      .getProductGuideState()
      .then((state) => {
        if (!cancelled && state.seenVersion < state.currentVersion) {
          setGuideWelcome(true)
          setGuideOpen(true)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [environmentLoading, environmentReady])

  useEffect(() => {
    updateOpenRef.current = updateOpen
  }, [updateOpen])

  useEffect(() => {
    if (
      environmentLoading ||
      !environmentReady ||
      guideOpen ||
      changelogOpen ||
      settingsOpen ||
      downloadsModalOpen ||
      quickNotesOpen ||
      feedbackOpen
    ) {
      return
    }

    const requestId = ++autoUpdateCheckRequestRef.current
    const delay = windowShowCount === 0 ? 3000 : 800
    let cancelled = false
    const timer = window.setTimeout(() => {
      window.electron
        .checkForUpdates()
        .then((result) => {
          if (cancelled || requestId !== autoUpdateCheckRequestRef.current) {
            return
          }

          if (!result.hasUpdate) return
          if (result.skippedVersion === result.latestVersion) return
          if (result.latestVersion === sessionDismissedUpdateVersionRef.current) {
            return
          }
          if (updateOpenRef.current) return

          updateOpenRef.current = true
          setUpdateInfo(result)
          setUpdateOpen(true)
        })
        .catch(() => undefined)
    }, delay)

    return () => {
      cancelled = true
      window.clearTimeout(timer)

      if (autoUpdateCheckRequestRef.current === requestId) {
        autoUpdateCheckRequestRef.current += 1
      }
    }
  }, [
    changelogOpen,
    downloadsModalOpen,
    environmentLoading,
    environmentReady,
    feedbackOpen,
    guideOpen,
    quickNotesOpen,
    settingsOpen,
    windowShowCount
  ])

  const closeUpdatePrompt = useCallback((): void => {
    updateOpenRef.current = false
    setUpdateOpen(false)
  }, [])

  const handleDownloadUpdate = useCallback(
    async (next: UpdateCheckResult): Promise<void> => {
      if (!next.package) return

      sessionDismissedUpdateVersionRef.current = next.latestVersion
      closeUpdatePrompt()

      // 下载进入下载管理，用户可以先看到进度。
      if (browserVisible) {
        setDownloadsPanelOpen(true)
      } else {
        setDownloadsModalOpen(true)
      }

      try {
        const result = await window.electron.downloadUpdatePackage(next.package)

        modal.confirm({
          title: '更新已下载',
          content: `安装包 v${next.latestVersion} 已保存到下载目录：${result.name}。是否立即安装？`,
          okText: '立即安装',
          cancelText: '稍后自行安装',
          onOk: async () => {
            try {
              await window.electron.installUpdateDownload(result.downloadId)
            } catch (installError) {
              message.error(
                getErrorMessage(
                  installError,
                  '安装更新失败，请稍后自行安装'
                )
              )
            }
          },
          onCancel: () => {
            message.info(
              `安装包已下载：${result.name}，可在下载管理中手动安装`
            )
          }
        })
      } catch (downloadError) {
        message.error(getErrorMessage(downloadError, '下载更新失败'))
      }
    },
    [browserVisible, closeUpdatePrompt, message, modal]
  )

  const closeGuide = useCallback((): void => {
    setGuideOpen(false)
    window.electron.markProductGuideSeen().catch(() => undefined)
  }, [])

  const openQuickNotes = useCallback((): void => {
    if (browserVisible) {
      window.electron.closeEmbeddedBrowser().catch(() => undefined)
    }

    setQuickNotesOpen(true)
  }, [browserVisible])

  const closeQuickNotes = useCallback((): void => {
    setQuickNotesOpen(false)
  }, [])

  // 全局快捷键：设置、AI、下载、帮助、页面切换和浏览器恢复。
  useEffect(() => {
    const isMac = window.electron.platform === 'darwin'

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return

      const modifier = isMac ? event.metaKey : event.ctrlKey
      const key = event.key.toLowerCase()
      const hasOverlay =
        settingsOpen ||
        quickNotesOpen ||
        guideOpen ||
        changelogOpen ||
        downloadsModalOpen ||
        updateOpen ||
        aiDialogOpen ||
        feedbackOpen

      // F1：打开/关闭使用手册。
      if (event.key === 'F1' && !modifier && !event.altKey) {
        event.preventDefault()
        event.stopPropagation()

        if (guideOpen) {
          closeGuide()
        } else if (!hasOverlay) {
          setGuideWelcome(false)
          setGuideOpen(true)
        }

        return
      }

      if (!modifier || event.altKey) return

      // 设置：Cmd/Ctrl + ,；再次按下关闭。
      if (!event.shiftKey && event.key === ',') {
        event.preventDefault()
        event.stopPropagation()

        if (settingsOpen) {
          closeSettings()
        } else if (!hasOverlay) {
          openSettings()
        }

        return
      }

      if (hasOverlay) return

      // AI 助手。
      if (event.shiftKey && key === 'a') {
        event.preventDefault()
        event.stopPropagation()
        openAiDialog({
          title: 'AI 助手',
          prompt: '',
          autoStart: false,
          persistSession: true
        })
        return
      }

      // 下载管理。
      if (!event.shiftKey && key === 'j') {
        event.preventDefault()
        event.stopPropagation()
        handleOpenDownloads()
        return
      }

      // 更新日志。
      if (event.shiftKey && key === 'u') {
        event.preventDefault()
        event.stopPropagation()
        setChangelogOpen(true)
        return
      }

      // 恢复已收起的浏览器。
      if (event.shiftKey && key === 'b') {
        if (browserVisible || browserTabCount === 0) return

        event.preventDefault()
        event.stopPropagation()
        window.electron.showEmbeddedBrowser().catch(() => undefined)
        return
      }

      // 一级页面切换：Cmd/Ctrl + 1~7。
      if (
        environmentReady &&
        !environmentLoading &&
        !event.shiftKey &&
        /^[1-7]$/.test(event.key)
      ) {
        // 终端页内数字键用于切换终端标签。
        if (workspace === 'terminal') return

        const page = APP_PAGES[Number(event.key) - 1]

        if (page) {
          event.preventDefault()
          event.stopPropagation()
          handlePageChange(page.key)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)

    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [
    aiDialogOpen,
    browserTabCount,
    browserVisible,
    changelogOpen,
    closeGuide,
    closeSettings,
    downloadsModalOpen,
    environmentLoading,
    environmentReady,
    feedbackOpen,
    guideOpen,
    handleOpenDownloads,
    handlePageChange,
    openAiDialog,
    openSettings,
    quickNotesOpen,
    settingsOpen,
    updateOpen,
    workspace
  ])

  return (
    <div className="app-shell">
      <AppTitleBar />
      <div className="app-body">
        {environmentReady && !environmentLoading ? (
          <AppNavigation activePage={workspace} onChange={handlePageChange} />
        ) : null}

        <main
          className={`workspace-canvas${environmentReady && !environmentLoading ? ' workspace-canvas--workbench' : ''}`}
        >
          {environmentLoading ? (
            <div className="auth-loading">
              <Spin />
            </div>
          ) : environmentReady ? (
            APP_PAGES.filter((page) => visitedPages.has(page.key)).map((page) => (
              <div
                key={page.key}
                className="app-page"
                hidden={workspace !== page.key}
                aria-hidden={workspace !== page.key}
              >
                {page.render({
                  active: workspace === page.key,
                  onOpenSettings: openSettings,
                  larkUser,
                  terminalRequest,
                  onTerminalRequestHandled: handleTerminalRequestHandled
                })}
              </div>
            ))
          ) : (
            <EnvironmentSetup
              meegleState={meegleState}
              larkCliInfo={larkCliInfo}
              larkUser={larkUser}
              authExpiredProvider={authExpiredNotice?.provider ?? null}
              refreshing={environmentRefreshing}
              onRefresh={() => void handleRefreshEnvironment()}
              onOpenSettings={openSettings}
            />
          )}
        </main>

        {!environmentLoading ? (
          <EmbeddedBrowserPanel
            downloads={downloads}
            downloadsOpen={downloadsPanelOpen}
            onCloseDownloads={() => setDownloadsPanelOpen(false)}
          />
        ) : null}
      </div>

      <QuickAccess />

      <QuickNotes
        open={quickNotesOpen}
        notes={quickNotes.notes}
        loading={quickNotes.loading}
        error={quickNotes.error}
        onOpen={openQuickNotes}
        onReload={() => quickNotes.reload()}
        onClose={closeQuickNotes}
        onAdd={quickNotes.add}
        onSetDueAt={quickNotes.setDueAt}
        onSetDone={quickNotes.setDone}
        onUpdateText={quickNotes.updateText}
        onRemove={quickNotes.remove}
        onClearCompleted={quickNotes.clearCompleted}
      />

      <ProductGuide
        open={guideOpen}
        welcome={guideWelcome}
        onClose={closeGuide}
      />

      <ChangelogModal
        open={changelogOpen}
        content={changelogContent}
        onClose={() => setChangelogOpen(false)}
      />

      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
      />

      <UpdatePrompt
        update={updateInfo}
        open={updateOpen}
        onLater={(version) => {
          sessionDismissedUpdateVersionRef.current = version
          window.electron.skipUpdateVersion(version).catch(() => {
            message.error('保存“跳过此版本”设置失败，下次启动可能再次提示')
          })
          closeUpdatePrompt()
        }}
        onDownload={handleDownloadUpdate}
      />

      <AppFooter
        appInfo={appInfo}
        onOpenSettings={() => openSettings()}
        downloadCount={activeCount}
        quickNoteCount={quickNotes.openCount}
        browserTabCount={browserVisible ? 0 : browserTabCount}
        onResumeBrowser={() => {
          window.electron.showEmbeddedBrowser()
        }}
        onOpenDownloads={handleOpenDownloads}
        onOpenQuickNotes={() => {
          if (quickNotesOpen) {
            closeQuickNotes()
          } else {
            openQuickNotes()
          }
        }}
        onOpenGuide={() => {
          setGuideWelcome(false)
          setGuideOpen(true)
        }}
        onOpenChangelog={() => setChangelogOpen(true)}
        onOpenFeedback={() => setFeedbackOpen(true)}
        onOpenQuickAccess={() => window.dispatchEvent(new Event('quick-access:open'))}
        onOpenAi={() =>
          openAiDialog({
            title: 'AI 助手',
            prompt: '',
            autoStart: false,
            persistSession: true
          })
        }
        onOpenCloudDocs={() =>
          window.electron.openEmbeddedBrowser(
            'https://www.feishu.cn/drive/home/'
          )
        }
      />

      <SettingsModal
        open={settingsOpen}
        initialSection={settingsSection}
        appInfo={appInfo}
        onLarkCliUpdated={() => refreshEnvironment()}
        onOpenUpdatePrompt={(update) => {
          updateOpenRef.current = true
          setUpdateInfo(update)
          setUpdateOpen(true)
        }}
        onClose={() => {
          closeSettings()
          refreshEnvironment()
        }}
      />

      <LinkContextMenu />
      <Modal
        title="下载管理"
        open={downloadsModalOpen}
        footer={null}
        width={620}
        className="download-manager-modal"
        destroyOnHidden
        onCancel={() => setDownloadsModalOpen(false)}
      >
        <EmbeddedBrowserDownloads downloads={downloads} />
      </Modal>
    </div>
  )
}
