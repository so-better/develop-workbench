import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App as AntdApp } from 'antd'
import App from './App'
import ThemeProvider from './theme/ThemeProvider'
import 'antd/dist/reset.css'
import './styles/global.css'

// 首次渲染前先应用系统主题，避免页面出现短暂的亮色闪屏。
const initialIsDark = window.matchMedia('(prefers-color-scheme: dark)').matches
document.documentElement.dataset.theme = initialIsDark ? 'dark' : 'light'
document.documentElement.style.colorScheme = initialIsDark ? 'dark' : 'light'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AntdApp>
        <App />
      </AntdApp>
    </ThemeProvider>
  </StrictMode>
)
