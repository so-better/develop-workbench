import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import {
  ApiOutlined,
  AppstoreOutlined,
  BranchesOutlined,
  BugOutlined,
  ClearOutlined,
  CloudOutlined,
  CodeOutlined,
  CompassOutlined,
  DesktopOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  ProjectOutlined,
  SearchOutlined,
  SettingOutlined,
  SnippetsOutlined,
} from '@ant-design/icons'
import { Button, Modal } from 'antd'
import RobotMark from '../RobotMark/RobotMark'

interface ProductGuideProps {
  open: boolean
  welcome: boolean
  onClose: () => void
}

interface GuideCapability {
  title: string
  icon: ReactNode
  items: string[]
}

interface GuideSetting {
  title: string
  icon: ReactNode
  description: string
}

interface GuideSettingGroup {
  title: string
  items: GuideSetting[]
}

type GuideTab = 'capabilities' | 'settings' | 'shortcuts'

const FLOW = [
  { index: '01', title: '选需求', detail: '按迭代浏览、搜索和筛选' },
  { index: '02', title: '看上下文', detail: '文档、流程、评论和 AI 分析' },
  { index: '03', title: '写代码', detail: '绑定分支、打开 IDE、生成 MR' },
  { index: '04', title: '交付与总结', detail: '缺陷处理、AI 周报' }
]

const CAPABILITIES: GuideCapability[] = [
  {
    title: '需求工作台',
    icon: <ProjectOutlined />,
    items: [
      '我负责的需求按迭代分组，可切换 Meegle 空间并筛选',
      '集中查看详情、评论、流程节点、排期、估分和负责人',
      '需求详情顶部展示按端难度估分：前端 app、前端 PC 和后端，单位为“人天”；本地临时需求不显示该卡片',
      '关联需求文档、完整飞书详情，并直接发起 AI 分析',
      '支持创建本地临时需求，可归入现有迭代并维护产品、状态和优先级',
      '临时需求可绑定仓库、打开 IDE 和 AI 分析，只保存在本机'
    ]
  },
  {
    title: '需求相关链接',
    icon: <FileTextOutlined />,
    items: [
      'Meegle 需求和本地临时需求均支持相关链接，自动提取需求描述和文档字段中的地址',
      '支持手动添加、编辑名称和地址、删除；维护记录按空间和需求保存在本机',
      '飞书链接预览成功后显示真实文档标题，失败时显示保存的名称；点击在内置浏览器打开',
      '进入需求或内容变化时自动扫描，保留删除记录；点击“自动扫描”可恢复当前需求内容中已删除的链接',
      '扫描基于当前已加载的需求内容，远端变更需先刷新需求；编辑替换的旧地址不会因扫描恢复',
      '自动排除当前需求自身的飞书 Story 地址'
    ]
  },
  {
    title: '缺陷工作台',
    icon: <BugOutlined />,
    items: [
      '按角色、状态和迭代筛选我参与的缺陷',
      '支持“显示已结束”筛选，查看已解决、已关闭等缺陷',
      '查看详细字段和评论，编辑 BUG 处理人与责任人',
      '执行缺陷状态流转，并填写流转所需字段',
      '使用 AI 分析缺陷原因、影响范围、修复建议和验证点'
    ]
  },
  {
    title: '代码与 IDE',
    icon: <CodeOutlined />,
    items: [
      '绑定仓库和开发分支，新建分支后自动推送并绑定',
      '打开本地 IDE；Qoder 支持预置需求分析会话',
      '生成合并请求地址，查看远程分支和轻舟构建入口'
    ]
  },
  {
    title: '终端',
    icon: <DesktopOutlined />,
    items: [
      '左侧导航最后一项进入多标签终端，每个标签对应一个独立 shell',
      '支持新建、关闭、重命名、拖拽排序和标签右键菜单',
      '支持在默认目录或指定目录新建终端，拖入文件会自动插入路径',
      '支持终端内容搜索、路径点击打开和 WebGL 加速',
      '可开启选中即复制；多行粘贴前会二次确认',
      'macOS 使用 Cmd+K 清屏，Windows 使用 cls 命令清屏',
      '重启应用后不恢复历史终端，只打开一个全新的默认终端'
    ]
  },
  {
    title: '站点导航',
    icon: <AppstoreOutlined />,
    items: [
      '保存日常系统、文档和工具，按环境与标签管理',
      '常用站点优先展示，支持拖拽排序和一键打开',
      '使用 AI 结合飞书、Meegle、业务、CI/CD 和监控等场景推荐站点与优化建议'
    ]
  },
  {
    title: 'AI 助手',
    icon: <RobotMark />,
    items: [
      '全局 AI 对话，可读取需求详情和工具执行结果',
      '检索并执行技能，覆盖编码、写作、图表、SQL 等场景',
      '生成 Excel、PPT、Markdown、Word、PDF 等文件'
    ]
  },
  {
    title: 'AI 周报',
    icon: <FileTextOutlined />,
    items: [
      '结合本周 Meegle/本地需求、已解决缺陷和代码提交生成周报',
      'AI 生成周报内容并回填到当前编辑字段',
      '编辑完成后直接提交到飞书汇报'
    ]
  },
  {
    title: '快速访问与简记',
    icon: <SearchOutlined />,
    items: [
      'Cmd/Ctrl+K 搜索需求、缺陷、站点、飞书文档、消息和群聊',
      'Cmd/Ctrl+Shift+K 打开待办简记，随手记录、完成和删除',
      '消息与群聊交给飞书 App，其他结果可在应用内打开',
      '搜索结果支持上下键选择、回车打开'
    ]
  },
  {
    title: '粘贴选择',
    icon: <SnippetsOutlined />,
    items: [
      '读取系统剪贴板，保留最近复制内容，供快速选择粘贴',
      '不接管或修改系统剪贴板，只有选择粘贴时才写入目标内容',
      '支持文本、图片和文件引用',
      '在任意应用按 Cmd/Ctrl+Shift+V 呼出底部浮层，方向键选择，Enter 粘贴，Esc 取消',
      '文件只保存路径引用，源文件移动或删除后记录失效',
      'macOS 自动粘贴可能需要在系统设置中授予辅助功能权限'
    ]
  },
  {
    title: '内置浏览器',
    icon: <CompassOutlined />,
    items: [
      '支持多个页面切换，相同地址复用已打开页面；收起面板后保留浏览位置',
      '点击标签上的 × 关闭该页并释放资源；点击面板右上角 × 或按 Esc 收起面板，保留所有页面',
      '点击标签栏右侧“关闭全部”可释放所有页面，操作前会二次确认',
      '收起后可通过底部状态栏的“浏览器”入口重新展开；完全退出应用后不保留页面',
      '外部链接在应用内打开，右键可复制或添加到站点',
      '支持前进、后退、刷新、链接复制、最大化和下载管理',
      'F12 或 Cmd/Ctrl 快捷键打开页面开发者工具'
    ]
  },
  {
    title: '环境与设置',
    icon: <SettingOutlined />,
    items: [
      '检测并登录本机 Lark CLI 和 Meegle CLI',
      '配置 Git、仓库根目录、IDE、终端、AI 模型和技能目录',
      '管理深浅主题、下载记录、缓存和临时数据',
      '一键迁移可导出应用数据并在新电脑导入恢复；导入前会二次确认并自动备份，完成后重启应用生效',
      '迁移包包含模型配置和 API Key，不包含浏览器登录态、缓存和 AI 生成文件'
    ]
  },
  {
    title: '更新与窗口',
    icon: <HistoryOutlined />,
    items: [
      '底部“更新日志”可查看历史版本更新内容',
      'macOS 和 Windows 点击关闭按钮默认最小化，应用保持运行',
      'Windows 可通过托盘菜单重新打开主窗口或退出应用'
    ]
  }
]

const SETTINGS_GROUPS: GuideSettingGroup[] = [
  {
    title: '外部连接',
    items: [
      {
        title: 'Lark Cli',
        icon: <CloudOutlined />,
        description:
          '配置可执行文件、自动检测路径并扫码授权；用于读取飞书用户、云文档、消息和群聊。'
      },
      {
        title: 'Meegle Cli',
        icon: <ProjectOutlined />,
        description:
          '配置可执行文件、自动检测路径并扫码授权；用于读取需求、缺陷、流程节点和工作项字段。'
      },
      {
        title: 'Git',
        icon: <BranchesOutlined />,
        description:
          '选择或自动检测本机 Git；仓库扫描、克隆、分支创建与切换、拉取都会调用它。'
      }
    ]
  },
  {
    title: '开发环境',
    items: [
      {
        title: 'IDE',
        icon: <CodeOutlined />,
        description:
          '从 15 种内置预设中选择 IDE，检测或选择可执行文件；启动参数固定，{path} 会替换为仓库路径。'
      },
      {
        title: '代码仓库',
        icon: <FolderOpenOutlined />,
        description:
          '设置代码根目录后自动扫描仓库，也可以从 Git 克隆；支持标记轻舟仓库，移除配置不会删除本地代码。'
      },
      {
        title: '终端',
        icon: <DesktopOutlined />,
        description:
          '配置默认 Shell、字号、滚动历史和 WebGL 加速；支持自动检测或选择 Shell，并提供选中即复制开关。'
      }
    ]
  },
  {
    title: 'AI 与维护',
    items: [
      {
        title: '模型与技能',
        icon: <ApiOutlined />,
        description:
          '在同一栏目切换模型配置和技能目录；模型支持 OpenAI Chat Completions 兼容 JSON 自动保存，技能支持扫描多个绝对路径目录。'
      },
      {
        title: '粘贴选择',
        icon: <SnippetsOutlined />,
        description:
          '设置全局快捷键，查看和清空本机保存的最近内容；只读取系统剪贴板来提供粘贴选择，不接管系统剪贴板。'
      },
      {
        title: '存储清理',
        icon: <ClearOutlined />,
        description:
          '清理 AI 产物、内置浏览器缓存、应用缓存、下载记录和损坏数据备份；不会删除业务配置、登录态或本机文件。'
      },
      {
        title: '应用信息',
        icon: <InfoCircleOutlined />,
        description:
          '查看应用版本、平台以及 Electron、Chromium、Node.js 版本，并复制运行时信息。'
      }
    ]
  }
]

/**
 * 首次启动展示的产品能力手册。
 * 内容只描述当前已经具备的入口，不把规划中的能力写成现状。
 */
export default function ProductGuide({
  open,
  welcome,
  onClose
}: ProductGuideProps): JSX.Element {
  const isMac = window.electron.platform === 'darwin'
  const quickAccessKeys = isMac ? ['⌘', 'K'] : ['Ctrl', 'K']
  const devtoolsKeys = isMac ? ['⌘', '⌥', 'I'] : ['Ctrl', 'Shift', 'I']
  const shortcuts = [
    {
      key: 'quick-access',
      keys: quickAccessKeys,
      label: '打开全局快速访问'
    },
    {
      key: 'quick-notes',
      keys: isMac ? ['⌘', '⇧', 'K'] : ['Ctrl', 'Shift', 'K'],
      label: '打开待办简记'
    },
    {
      key: 'paste-picker',
      keys: isMac ? ['⌘', '⇧', 'V'] : ['Ctrl', 'Shift', 'V'],
      label: '打开粘贴选择（默认快捷键）'
    },
    {
      key: 'theme',
      keys: isMac ? ['⌘', '⇧', 'L'] : ['Ctrl', 'Shift', 'L'],
      label: '切换主题模式'
    },
    {
      key: 'terminal-copy',
      keys: isMac ? ['⌘', 'C'] : ['Ctrl', 'Shift', 'C'],
      label: '终端复制选中内容'
    },
    {
      key: 'terminal-paste',
      keys: isMac ? ['⌘', 'V'] : ['Ctrl', 'V'],
      label: '终端粘贴'
    },
    {
      key: 'terminal-search',
      keys: isMac ? ['⌘', 'F'] : ['Ctrl', 'Shift', 'F'],
      label: '终端内搜索'
    },
    ...(isMac
      ? [
          {
            key: 'terminal-clear',
            keys: ['⌘', 'K'],
            label: '终端清屏'
          }
        ]
      : []),
    {
      key: 'close',
      keys: ['Esc'],
      label: '关闭浏览器或弹窗'
    },
    {
      key: 'devtools',
      keys: devtoolsKeys,
      label: '打开内置浏览器开发者工具'
    }
  ]
  const tabs: Array<{ key: GuideTab; label: string; count: number }> = [
    { key: 'capabilities', label: '产品能力', count: CAPABILITIES.length },
    {
      key: 'settings',
      label: '设置详解',
      count: SETTINGS_GROUPS.reduce(
        (total, group) => total + group.items.length,
        0
      )
    },
    { key: 'shortcuts', label: '快捷键', count: shortcuts.length }
  ]
  const [activeTab, setActiveTab] = useState<GuideTab>('capabilities')
  const contentRef = useRef<HTMLDivElement>(null)

  /** 支持左右方向键在页签间切换。 */
  const handleTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>
  ): void => {
    const currentIndex = tabs.findIndex((tab) => tab.key === activeTab)
    let nextIndex = currentIndex

    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabs.length
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1
    } else {
      return
    }

    event.preventDefault()
    const nextTab = tabs[nextIndex]

    setActiveTab(nextTab.key)
    document.getElementById(`product-guide-tab-${nextTab.key}`)?.focus()
  }

  useEffect(() => {
    if (!open) return

    setActiveTab('capabilities')
  }, [open])

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }, [activeTab])

  return (
    <Modal
      open={open}
      width={980}
      centered
      destroyOnHidden
      title={null}
      footer={
        <div className="product-guide-footer">
          <span className="product-guide-footer-note">
            登录态来自本机 Lark / Meegle CLI，AI 使用你在设置中配置的模型。
          </span>
          <Button type="primary" onClick={onClose}>
            {welcome ? '开始使用' : '关闭手册'}
          </Button>
        </div>
      }
      className="product-guide-modal"
      onCancel={onClose}
    >
      <div className="product-guide">
        <header className="product-guide-hero">
          <div className="product-guide-hero-copy">
            <span className="product-guide-kicker">产品使用手册</span>
            <h2>AI 研发工作台</h2>
            <p>
              把需求、缺陷、代码、站点、周报、待办和 AI 放进同一个桌面工作台，减少在浏览器、IDE 和飞书之间来回切换。
            </p>
          </div>
        </header>

        <nav className="product-guide-tabs" role="tablist" aria-label="手册分类">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              id={`product-guide-tab-${tab.key}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              aria-controls="product-guide-tabpanel"
              tabIndex={activeTab === tab.key ? 0 : -1}
              className={`product-guide-tab${
                activeTab === tab.key ? ' is-active' : ''
              }`}
              onClick={() => setActiveTab(tab.key)}
              onKeyDown={handleTabKeyDown}
            >
              <span>{tab.label}</span>
              <em>{tab.count}</em>
            </button>
          ))}
        </nav>

        <div
          id="product-guide-tabpanel"
          ref={contentRef}
          className="product-guide-content"
          role="tabpanel"
          aria-labelledby={`product-guide-tab-${activeTab}`}
        >
          {activeTab === 'capabilities' ? (
            <section className="product-guide-panel">
              <div className="product-guide-flow" aria-label="推荐使用流程">
                {FLOW.map((step) => (
                  <div className="product-guide-flow-step" key={step.index}>
                    <span className="product-guide-flow-index">{step.index}</span>
                    <strong>{step.title}</strong>
                    <span>{step.detail}</span>
                  </div>
                ))}
              </div>

              <div className="product-guide-section-heading">
                <h3>产品能力</h3>
                <span>从日常入口到交付闭环</span>
              </div>

              <div className="product-guide-grid">
                {CAPABILITIES.map((capability, index) => (
                  <section className="product-guide-card" key={capability.title}>
                    <div className="product-guide-card-head">
                      <span className="product-guide-card-icon">
                        {capability.icon}
                      </span>
                      <span className="product-guide-card-index">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                    </div>
                    <h3>{capability.title}</h3>
                    <ul>
                      {capability.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>

              <footer className="product-guide-tip">
                底部工具栏还提供更新日志、待办简记、下载管理、搜索、使用手册、飞书云文档、AI
                助手、设置和主题切换。关闭后仍可从“使用手册”再次查看。
              </footer>
            </section>
          ) : null}

          {activeTab === 'settings' ? (
            <section className="product-guide-panel product-guide-panel--settings">
              <div className="product-guide-settings-intro">
                <SettingOutlined />
                <div>
                  <strong>推荐配置顺序</strong>
                  <span>
                    Lark / Meegle 授权 → Git 与代码仓库 → IDE → 模型与技能
                  </span>
                </div>
              </div>

              {SETTINGS_GROUPS.map((group) => (
                <section
                  className="product-guide-settings-group"
                  key={group.title}
                >
                  <div className="product-guide-settings-group-head">
                    <h3>{group.title}</h3>
                    <span>{group.items.length} 项</span>
                  </div>
                  <div className="product-guide-settings-grid">
                    {group.items.map((setting) => (
                      <div className="product-guide-setting" key={setting.title}>
                        <span className="product-guide-setting-icon">
                          {setting.icon}
                        </span>
                        <div>
                          <h4>{setting.title}</h4>
                          <p>{setting.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}

              <footer className="product-guide-tip">
                路径类设置支持自动检测；模型 JSON 格式正确时自动保存。
                设置入口位于底部工具栏的齿轮按钮。
              </footer>
            </section>
          ) : null}

          {activeTab === 'shortcuts' ? (
            <section className="product-guide-panel">
              <div className="product-guide-section-heading">
                <h3>常用快捷键</h3>
                <span>上手后可以完全用键盘完成大部分操作</span>
              </div>

              <div className="product-guide-shortcut-grid">
                {shortcuts.map((shortcut) => (
                  <div className="product-guide-shortcut" key={shortcut.key}>
                    <div className="product-guide-key-row">
                      {shortcut.keys.map((key) => (
                        <kbd key={key}>{key}</kbd>
                      ))}
                    </div>
                    <span>{shortcut.label}</span>
                  </div>
                ))}
              </div>

              <div className="product-guide-shortcut-notes">
                <div>
                  <strong>快速访问</strong>
                  <p>输入关键词后，用上下键切换结果，回车直接打开。</p>
                </div>
                <div>
                  <strong>内置浏览器</strong>
                  <p>先点击网页内容再按快捷键，开发者工具会以独立窗口打开。</p>
                </div>
                <div>
                  <strong>平台差异</strong>
                  <p>macOS 使用 Cmd，Windows 使用 Ctrl。</p>
                </div>
              </div>

              <footer className="product-guide-tip">
                使用手册可以随时从底部工具栏重新打开。
              </footer>
            </section>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}
