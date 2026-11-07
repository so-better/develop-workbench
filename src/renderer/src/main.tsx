import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App as AntdApp } from 'antd'
import App from './App'
import ClipboardOverlay from './clipboard-overlay/ClipboardOverlay'
import { AiChatDialogProvider } from './hooks/useAiChatDialog'
import { SettingsDialogProvider } from './components/SettingsModal/SettingsDialogProvider'
import ThemeProvider from './theme/ThemeProvider'
import 'antd/dist/reset.css'
import 'katex/dist/katex.min.css'
import './styles/global.css'

const isClipboardOverlay = window.location.hash === '#clipboard-overlay'

if (isClipboardOverlay) {
  document.documentElement.classList.add('clipboard-overlay-root')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isClipboardOverlay ? (
      <AntdApp>
        <ClipboardOverlay />
      </AntdApp>
    ) : (
      <ThemeProvider>
        <AntdApp>
          <SettingsDialogProvider>
            <AiChatDialogProvider>
              <App />
            </AiChatDialogProvider>
          </SettingsDialogProvider>
        </AntdApp>
      </ThemeProvider>
    )}
  </StrictMode>
)
