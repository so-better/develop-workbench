import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import {
  AndroidOutlined,
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
  RocketOutlined,
  SearchOutlined,
  SettingOutlined,
  SnippetsOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { Button, Modal } from 'antd'
import RobotMark from '../RobotMark/RobotMark'
import './ProductGuide.css'

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
  { index: '01', title: '选需求', detail: '按版本与产线浏览、搜索和筛选' },
  { index: '02', title: '看上下文', detail: '文档、流程、评论和 AI 分析' },
  { index: '03', title: '写代码', detail: '绑定分支、打开 IDE、生成 MR' },
  { index: '04', title: '交付与总结', detail: '缺陷处理、AI 周报' }
]

const CAPABILITIES: GuideCapability[] = [
  {
    title: '需求工作台',
    icon: <ProjectOutlined />,
    items: [
      '我负责的需求按规划版本分组，同一版本的不同产线会自动合并，再按产线细分；缺少规划版本时回退到规划迭代，多版本需求会同时出现在关联的各个版本下',
      '我负责的节点完成后，左侧卡片会显示「我已完成」标记；仍有进行中节点时不显示',
      '支持按版本、产线、状态组合筛选，产线选项会跟随当前版本变化',
      '左侧需求卡片会标记流程节点排期异常，便于优先处理',
      '集中查看详情、评论、流程节点、排期、估分和负责人',
      '需求详情顶部展示按端难度估分：前端 app、前端 PC 和后端，单位为“人天”；本地临时需求不显示该卡片',
      '关联需求文档、完整飞书详情，并直接发起 AI 分析',
      '统一入口新建需求：正式需求会打开飞书需求创建页，临时需求保存在本机',
      '本地临时需求可归入现有版本并维护产线、产品、状态和优先级',
      '临时需求可绑定仓库、打开 IDE 和 AI 分析，只保存在本机',
      '左侧「仓库汇总」可按版本和产线查看仓库、开发分支、轻舟需求分支和迭代分支，支持复制名称，并直接打开远程仓库、创建 MR、轻舟工作任务和轻舟迭代分支构建；统计包含已结束和本地需求',
      '轻舟仓库会检查需求分支是否已合入迭代分支，未合入时显示提交数标记'
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
      '按角色、版本、产线和状态筛选我参与的缺陷',
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
    title: '代码仓库',
    icon: <FolderOpenOutlined />,
    items: [
      '左侧导航「代码」查看根目录下扫描到的本地仓库列表，并可按需求版本和产线筛选',
      '支持搜索、查看主分支/当前分支和切换轻舟接入标记',
      '操作列支持远程仓库、切换分支、新建分支、合并代码和在终端打开；「更多」菜单支持打开 IDE、创建 MR、删除分支和移除仓库，点击合并后会检查分支是否已合并，已合并会提示当前已是最新、无需合并，合并成功后自动推送',
      '支持从 Git 克隆仓库到配置的代码根目录',
      '代码根目录仍在设置的「代码目录」中配置'
    ]
  },
  {
    title: 'ADB 工具',
    icon: <AndroidOutlined />,
    items: [
      '连接本地 Android 模拟器，查看设备和第三方应用包',
      '自动识别当前前台应用包名，并从 adb reverse 端口识别 Dev Server 端口',
      '支持查看和添加 adb reverse 端口，默认适配 Metro 8081 和 Re.Pack 8083',
      '支持刷新页面、打开 RN 开发菜单，以及应用设置、深链、应用信息、权限和录屏',
      '右侧可切换 React Native DevTools 和 PageSpy 网络；PageSpy 会按当前 App 进程和型号自动定位调试房间',
      'DevTools 支持 console、Sources、React 组件和性能面板；PageSpy 用于查看 Network 请求',
      '截图和录屏统一保存到系统下载目录的 Develop Workbench 文件夹'
    ]
  },
  {
    title: '终端',
    icon: <DesktopOutlined />,
    items: [
      '左侧导航最后一项进入多标签终端，每个标签对应一个独立 shell',
      '标签默认显示当前目录末级名称，支持新建、关闭、重命名、拖拽排序和标签右键菜单',
      '支持在默认目录、指定目录或当前标签同目录新建终端，拖入文件会自动插入路径',
      '支持终端内容搜索、路径点击打开和 WebGL 加速',
      '可开启选中即复制；多行粘贴前会二次确认',
      'macOS 使用 Cmd+K 清屏，Windows 使用 cls 命令清屏',
      '重启应用后不恢复历史终端，只打开一个全新的默认终端'
    ]
  },
  {
    title: '防休眠',
    icon: <ThunderboltOutlined />,
    items: [
      '设置「防休眠」中可开启运行期间保持唤醒，应用退出后自动释放，不需要管理员权限',
      '运行期间保持唤醒只阻止系统空闲休眠，屏幕仍可正常息屏；合盖和手动睡眠不受影响',
      '合盖后不睡眠、锁屏后不睡眠通过系统电源策略实现，需要管理员授权，退出应用后仍然生效',
      '关闭系统防休眠开关会恢复到修改前的休眠时间，系统策略和运行时保持唤醒可以分别控制'
    ]
  },
  {
    title: '站点导航',
    icon: <AppstoreOutlined />,
    items: [
      '保存日常系统、文档和工具，按环境与标签管理；可标记最多 4 个重要站点并单独展示',
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
      '编辑完成后直接提交到飞书汇报',
      '周一 00:00 若上一周周报未提交且内容为空，应用运行时会自动分析并提交；已有内容或未保存草稿不会被覆盖；提交结果会通过飞书机器人发到本人'
    ]
  },
  {
    title: '快速访问与简记',
    icon: <SearchOutlined />,
    items: [
      'Cmd/Ctrl+K 搜索需求、缺陷、站点、飞书文档、消息和群聊',
      'Cmd/Ctrl+Shift+K 打开待办简记；Enter 添加，Shift+Enter 换行',
      '待办输入框支持 Markdown、富文本和图片粘贴，列表按 Markdown 渲染；创建后支持再次编辑正文',
      '可设置或修改截止时间，截止前 5 分钟提醒；系统通知不可用时自动显示应用内通知',
      '待办支持每分钟、每小时、每天、每周、每月循环提醒；截止时间为最终期限，在此之前按规则提醒，完成或删除后停止',
      '点击提醒可打开待办简记；待办完成后自动停止提醒',
      '未设置截止时可点击悬停出现的日历图标，已设置的待办显示日期胶囊',
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
      'macOS 自动粘贴首次使用需要在系统设置中授予辅助功能，并允许控制 System Events；没有权限时内容仍会复制，可手动 Cmd+V'
    ]
  },
  {
    title: '内置浏览器',
    icon: <CompassOutlined />,
    items: [
      '支持多页面切换和标签拖拽排序，相同地址复用已打开页面；收起面板后保留浏览位置',
      '点击标签上的 × 关闭该页并释放资源；点击面板右上角 × 或按 Esc 收起面板，保留所有页面',
      '点击标签栏右侧“关闭全部”可直接释放所有页面',
      '收起后可通过底部状态栏的“浏览器”入口重新展开；完全退出应用后不保留页面',
      '外部链接在应用内打开，右键可复制或添加到站点',
      '支持前进、后退、刷新、链接复制、最大化和下载管理',
      '提交登录表单或点击登录按钮后按站点记住账号、邮箱和手机号；下次聚焦账号输入框可从历史中选择，也可一键清除历史',
      '支持页面右键编辑与导航菜单、Cmd/Ctrl+F 查找、Cmd/Ctrl+W 关闭当前标签页、缩放和常用浏览快捷键',
      'F12 或 Cmd/Ctrl 快捷键打开页面开发者工具'
    ]
  },
  {
    title: '环境与设置',
    icon: <SettingOutlined />,
    items: [
      '底部状态栏可提交反馈，支持粘贴截图/添加图片，卡片自动附带用户、客户端和本机诊断信息',
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
      '每次窗口重新显示时静默检查版本更新；下载完成后会先确认是否立即安装，选择「稍后自行安装」不会退出应用；选择「跳过此版本」后不再自动提示，可在设置 → 应用信息中手动检查',
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
      },
      {
        title: 'ADB',
        icon: <AndroidOutlined />,
        description:
          '选择或自动检测 Android SDK 中的 adb；ADB 工具用于连接模拟器、刷新页面、截图录屏和调试。'
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
        title: '代码目录',
        icon: <FolderOpenOutlined />,
        description:
          '配置代码根目录；仓库列表、搜索、克隆和轻舟标记在左侧「代码」页查看和操作。'
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
    title: 'AI 与系统',
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
        title: '开机自启',
        icon: <RocketOutlined />,
        description:
          '设置系统登录后自动启动应用；首次安装后默认开启一次，可在设置中随时关闭。'
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
      key: 'embedded-browser',
      keys: isMac ? ['⌘', '⇧', 'B'] : ['Ctrl', 'Shift', 'B'],
      label: '恢复已收起的浏览器'
    },
    {
      key: 'settings',
      keys: isMac ? ['⌘', ','] : ['Ctrl', ','],
      label: '打开设置'
    },
    {
      key: 'ai-assistant',
      keys: isMac ? ['⌘', '⇧', 'A'] : ['Ctrl', 'Shift', 'A'],
      label: '打开 AI 助手'
    },
    {
      key: 'downloads',
      keys: isMac ? ['⌘', 'J'] : ['Ctrl', 'J'],
      label: '打开下载管理'
    },
    {
      key: 'page-switch',
      keys: isMac ? ['⌘', '1~7'] : ['Ctrl', '1~7'],
      label: '切换一级页面（需求~终端）'
    },
    {
      key: 'help',
      keys: ['F1'],
      label: '打开使用手册'
    },
    {
      key: 'changelog',
      keys: isMac ? ['⌘', '⇧', 'U'] : ['Ctrl', 'Shift', 'U'],
      label: '打开更新日志'
    },
    {
      key: 'requirement-search',
      keys: ['/'],
      label: '需求页聚焦搜索'
    },
    {
      key: 'new-requirement',
      keys: isMac ? ['⌘', 'N'] : ['Ctrl', 'N'],
      label: '需求页新建临时需求'
    },
    {
      key: 'new-formal-requirement',
      keys: isMac ? ['⌘', '⇧', 'N'] : ['Ctrl', 'Shift', 'N'],
      label: '需求页新建正式需求'
    },
    {
      key: 'new-site',
      keys: isMac ? ['⌘', '⇧', 'N'] : ['Ctrl', 'Shift', 'N'],
      label: '站点页新增站点'
    },
    {
      key: 'terminal-new',
      keys: isMac ? ['⌘', 'T'] : ['Ctrl', 'T'],
      label: '终端新建标签'
    },
    {
      key: 'terminal-close',
      keys: isMac ? ['⌘', 'W'] : ['Ctrl', 'W'],
      label: '终端关闭当前标签'
    },
    {
      key: 'terminal-switch',
      keys: isMac ? ['⌘', '1~9'] : ['Ctrl', '1~9'],
      label: '终端切换标签'
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
                    Lark / Meegle 授权 → Git 与代码目录 → IDE → 模型与技能
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
