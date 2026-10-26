import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState
} from 'react'
import type { ReactNode } from 'react'
import {
  DEFAULT_SETTINGS_SECTION
} from '../../../../types/settings'
import type { SettingsSection } from '../../../../types/settings'

interface SettingsDialogContextValue {
  open: boolean
  section: SettingsSection
  openSettings: (section?: SettingsSection) => void
  closeSettings: () => void
}

const SettingsDialogContext =
  createContext<SettingsDialogContextValue | null>(null)

/**
 * 全局设置弹窗状态。
 * 让 App 和全局 AI 弹窗都能直接打开设置，避免通过 DOM 事件通信。
 */
export function SettingsDialogProvider({
  children
}: {
  children: ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<SettingsSection>(DEFAULT_SETTINGS_SECTION)

  const openSettings = useCallback(
    (next: SettingsSection = DEFAULT_SETTINGS_SECTION): void => {
      setSection(next)
      setOpen(true)
    },
    []
  )

  const closeSettings = useCallback((): void => {
    setOpen(false)
  }, [])

  const value = useMemo(
    () => ({ open, section, openSettings, closeSettings }),
    [closeSettings, open, openSettings, section]
  )

  return (
    <SettingsDialogContext.Provider value={value}>
      {children}
    </SettingsDialogContext.Provider>
  )
}

export const useSettingsDialog = (): SettingsDialogContextValue => {
  const context = useContext(SettingsDialogContext)

  if (!context) {
    throw new Error('useSettingsDialog 必须在 SettingsDialogProvider 内使用')
  }

  return context
}
