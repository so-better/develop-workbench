import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App as AntdApp } from 'antd'
import App from './App'
import { AiChatDialogProvider } from './hooks/useAiChatDialog'
import { SettingsDialogProvider } from './components/SettingsModal/SettingsDialogProvider'
import ThemeProvider from './theme/ThemeProvider'
import 'antd/dist/reset.css'
import 'katex/dist/katex.min.css'
import './styles/global.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AntdApp>
        <SettingsDialogProvider>
          <AiChatDialogProvider>
            <App />
          </AiChatDialogProvider>
        </SettingsDialogProvider>
      </AntdApp>
    </ThemeProvider>
  </StrictMode>
)
