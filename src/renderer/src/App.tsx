import { useCallback, useEffect, useRef, useState } from 'react'
import { App as AntdApp, Modal, Spin } from 'antd'
import AppFooter from './components/AppFooter/AppFooter'
import AppTitleBar from './components/AppTitleBar/AppTitleBar'
import QuickAccess from './components/QuickAccess/QuickAccess'
import AppNavigation from './components/AppNavigation/AppNavigation'
import LinkContextMenu from './components/LinkContextMenu/LinkContextMenu'
import ProductGuide from './components/ProductGuide/ProductGuide'
import ChangelogModal from './components/ChangelogModal/ChangelogModal'
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
  const { message } = AntdApp.useApp()

  // 应用版本及运行时信息，用于 Footer 和设置弹窗。
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)

  // 本地 CLI 的授权状态，不代表应用自身登录。
  const [larkUser, setLarkUser] = useState<LarkUser | null>(null)
  const [larkCliInfo, setLarkCliInfo] = useState<LarkCliInfo | null>(null)
  const [meegleState, setMeegleState] = useState<MeegleState | null>(null)
  const [environmentLoading, setEnvironmentLoading] = useState(true)
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

      return status
    },
    []
  )

  const {
    open: settingsOpen,
    section: settingsSection,
    openSettings,
    closeSettings
  } = useSettingsDialog()
  const { openAiDialog } = useAiChatDialog()

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

  const handleOpenDownloads = (): void => {
    if (browserVisible) {
      setDownloadsPanelOpen((value) => !value)
      return
    }

    setDownloadsModalOpen(true)
  }

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
      quickNotesOpen
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
    guideOpen,
    quickNotesOpen,
    settingsOpen,
    windowShowCount
  ])

  const closeUpdatePrompt = useCallback((): void => {
    updateOpenRef.current = false
    setUpdateOpen(false)
  }, [])

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

      <UpdatePrompt
        update={updateInfo}
        open={updateOpen}
        onClose={closeUpdatePrompt}
        onLater={(version) => {
          sessionDismissedUpdateVersionRef.current = version
          window.electron.skipUpdateVersion(version).catch(() => {
            message.error('保存“稍后更新”设置失败，下次启动可能再次提示')
          })
          closeUpdatePrompt()
        }}
        onStartUpdate={(version) => {
          sessionDismissedUpdateVersionRef.current = version
        }}
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
