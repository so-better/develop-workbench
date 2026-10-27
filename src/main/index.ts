/**
 * Electron 主进程入口。
 * 负责应用启动、单实例控制和进程生命周期，具体能力拆分到独立模块。
 */
import { app } from 'electron'
import { join } from 'node:path'
import { initializeAiArtifacts } from './ai/artifacts'
import { initializeAiAttachments } from './ai/attachments'
import { initializeAiChat } from './ai/chat'
import { initializeDefects } from './defects'
import { initializeAiConfig } from './ai/config'
import { initializeEmbeddedBrowser } from './embedded-browser'
import { initializeGit } from './git'
import { initializeIde } from './ide'
import { initializeLark } from './lark'
import { initializeLinkPreview } from './link-preview'
import { initializeMarkdownImages } from './markdown-images'
import { initializeMeegle } from './meegle'
import { initializeRepositories } from './repositories'
import { initializeRequirementBindings } from './requirement-bindings'
import { initializeRequirementStatuses } from './requirement-statuses'
import { initializeRequirements } from './requirements'
import { initializeSites } from './sites'
import { initializeSkillSettings } from './skill-settings'
import { initializeSystem } from './system'
import { initializeTheme } from './theme'
import { initializeWeeklyReport } from './weekly-report'
import { createMainWindow, focusMainWindow, getMainWindow } from './window'

// 保留原有数据路径，避免修改应用名后丢失偏好、站点、登录态和浏览器会话。
const originalUserDataPath = app.getPath('userData')
const originalSessionDataPath = app.getPath('sessionData')

app.setName('AI 研发工作台')
app.setPath('userData', originalUserDataPath)
app.setPath('sessionData', originalSessionDataPath)

// 单实例锁：确保同一时间只运行一个工作台实例。
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  // 已有实例在运行时，当前进程直接退出。
  app.quit()
} else {
  // 用户再次启动应用时，聚焦已有窗口而不是新开一个实例。
  app.on('second-instance', focusMainWindow)

  // Electron 初始化完成后，再注册 IPC 并创建窗口。
  app.whenReady().then(() => {
    // Windows 需要设置 AppUserModelID，任务栏分组和通知才能正确显示。
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.lingkai.develop-workbench')
    }

    // 开发模式下让 macOS Dock 显示项目图标，而不是默认的 Electron 图标。
    if (process.platform === 'darwin' && !app.isPackaged) {
      app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
    }

    // 各业务模块自行注册 IPC；先恢复主题，再创建窗口，避免启动时主题闪烁。
    initializeTheme()
    initializeSystem()
    initializeEmbeddedBrowser()
    initializeGit()
    initializeIde()
    initializeLark()
    initializeLinkPreview()
    initializeMarkdownImages()
    initializeMeegle()
    initializeRepositories()
    initializeRequirements()
    initializeDefects()
    initializeRequirementBindings()
    initializeRequirementStatuses()
    initializeSites()
    initializeSkillSettings()
    initializeWeeklyReport()
    initializeAiConfig()
    initializeAiAttachments()
    initializeAiArtifacts()
    initializeAiChat()
    createMainWindow()

    // macOS 点击 Dock 图标时恢复或聚焦窗口，这是用户主动操作，需要正常聚焦。
    app.on('activate', () => {
      if (!getMainWindow()) {
        createMainWindow()
        return
      }

      focusMainWindow()
    })
  })

  // Windows/Linux 关闭所有窗口后退出；macOS 保持应用常驻。
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
