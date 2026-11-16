import { ipcRenderer } from 'electron'

/**
 * 内置浏览器账号历史提示。
 * 仅记录账号/邮箱/手机号等公开输入，不读取密码字段。
 */
const HOST_ID = '__workbench_account_autofill'
const ACCOUNT_HINT =
  /(user(name)?|account|email|mail|login|phone|mobile|tel|账号|帐号|账户|邮箱|手机|用户名|登录名|工号)/i
const EXCLUDED_AUTOCOMPLETE =
  /(current-password|new-password|one-time-code|cc-|credit-card)/i
const MAX_VISIBLE_ITEMS = 10

let history: string[] = []
let historyLoaded = false
let showRequestId = 0
let activeInput: HTMLInputElement | null = null
let activeIndex = -1
let host: HTMLDivElement | null = null
let shadowRoot: ShadowRoot | null = null
let listElement: HTMLDivElement | null = null

/** 判断输入框是否属于账号类字段。 */
const isAccountInput = (element: EventTarget | null): element is HTMLInputElement => {
  if (!(element instanceof HTMLInputElement)) return false
  if (element.disabled || element.readOnly) return false

  const type = (element.type || 'text').toLowerCase()

  if (!['text', 'email', 'tel', 'search'].includes(type)) return false

  const autocomplete = (element.getAttribute('autocomplete') || '').toLowerCase()

  if (EXCLUDED_AUTOCOMPLETE.test(autocomplete)) return false
  if (/(username|email|tel|phone|webauthn)/.test(autocomplete)) return true
  if (type === 'email' || type === 'tel') return true

  const hint = [
    element.name,
    element.id,
    element.placeholder,
    element.getAttribute('aria-label'),
    element.getAttribute('data-testid')
  ]
    .filter(Boolean)
    .join(' ')

  return ACCOUNT_HINT.test(hint)
}

/** 从事件路径中找出账号输入框，兼容 Shadow DOM。 */
const findAccountInput = (event: Event): HTMLInputElement | null => {
  for (const target of event.composedPath()) {
    if (isAccountInput(target)) return target
  }

  return null
}

/** 读取站点账号历史。 */
const loadHistory = async (force = false): Promise<string[]> => {
  if (historyLoaded && !force) return history

  try {
    const result = await ipcRenderer.invoke('embedded-autofill:get')

    history = Array.isArray(result)
      ? result.filter((value): value is string => typeof value === 'string')
      : []
    historyLoaded = true
  } catch {
    history = []
    historyLoaded = true
  }

  return history
}

/** 保存账号到站点历史。 */
const saveHistory = async (value: string, input?: HTMLInputElement): Promise<void> => {
  const account = value.trim()

  if (!account || account.length > 200) return
  if (input?.placeholder && account === input.placeholder) return
  if (/[\r\n]/.test(account)) return

  try {
    const result = await ipcRenderer.invoke('embedded-autofill:save', account)

    history = Array.isArray(result)
      ? result.filter((item): item is string => typeof item === 'string')
      : history
  } catch {
    // 账号历史写入失败不影响页面正常输入。
  }
}

/** 清空当前站点的账号历史。 */
const clearHistory = async (): Promise<void> => {
  try {
    await ipcRenderer.invoke('embedded-autofill:clear')
  } catch {
    // 清理失败时保持当前列表，不阻塞页面。
  }

  history = []
  hideDropdown()
}

/** 创建隔离样式的下拉容器。 */
const ensureHost = (): { host: HTMLDivElement; shadow: ShadowRoot } => {
  if (host && host.isConnected && shadowRoot) {
    return { host, shadow: shadowRoot }
  }

  host = document.createElement('div')
  host.id = HOST_ID
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; display: none;'
  const shadow = host.attachShadow({ mode: 'closed' })
  shadowRoot = shadow
  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; }
    .panel {
      box-sizing: border-box;
      overflow: hidden;
      color: #1f2329;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
      font-size: 13px;
      background: #fff;
      border: 1px solid #dee0e3;
      border-radius: 8px;
      box-shadow: 0 10px 32px rgba(31, 35, 41, 0.18);
    }
    .list { max-height: 220px; overflow-y: auto; padding: 4px; }
    .item {
      padding: 8px 10px;
      overflow: hidden;
      line-height: 20px;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: default;
      border-radius: 5px;
    }
    .item.is-active, .item:hover { background: #f2f3f5; }
    .footer {
      display: flex;
      justify-content: flex-end;
      padding: 6px 8px;
      border-top: 1px solid #eff0f1;
    }
    .clear {
      padding: 4px 6px;
      color: #8f959e;
      font: inherit;
      font-size: 12px;
      white-space: nowrap;
      background: transparent;
      border: 0;
      border-radius: 4px;
      cursor: pointer;
    }
    .clear:hover { color: #1f2329; background: #f2f3f5; }
  `

  const panel = document.createElement('div')
  panel.className = 'panel'
  listElement = document.createElement('div')
  listElement.className = 'list'
  const footer = document.createElement('div')
  footer.className = 'footer'
  const clearButton = document.createElement('button')
  clearButton.className = 'clear'
  clearButton.type = 'button'
  clearButton.textContent = '清除历史记录'
  clearButton.addEventListener('pointerdown', (event) => event.preventDefault())
  clearButton.addEventListener('click', () => {
    void clearHistory()
  })
  footer.appendChild(clearButton)
  panel.append(listElement, footer)
  shadow.append(style, panel)
  document.documentElement.appendChild(host)

  return { host, shadow }
}

/** 隐藏账号下拉。 */
const hideDropdown = (): void => {
  showRequestId += 1
  activeInput = null
  activeIndex = -1

  if (host) host.style.display = 'none'
}

/** 将输入框的值写入页面并触发 React 等受控组件需要的原生事件。 */
const setInputValue = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set

  if (setter) setter.call(input, value)
  else input.value = value

  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
}

/** 选择历史账号。 */
const selectItem = (input: HTMLInputElement, value: string): void => {
  setInputValue(input, value)
  hideDropdown()
  input.focus({ preventScroll: true })
}

/** 根据输入内容过滤历史账号。 */
const getVisibleHistory = (input: HTMLInputElement): string[] => {
  const query = input.value.trim().toLocaleLowerCase()
  const filtered = query
    ? history.filter((value) => value.toLocaleLowerCase().includes(query))
    : history

  return filtered.slice(0, MAX_VISIBLE_ITEMS)
}

/** 渲染并定位账号下拉。 */
const renderDropdown = (input: HTMLInputElement): void => {
  const visible = getVisibleHistory(input)

  if (visible.length === 0) {
    hideDropdown()
    return
  }

  const { host: dropdownHost, shadow } = ensureHost()
  const list = listElement

  if (!list) return

  activeInput = input
  activeIndex = -1
  list.replaceChildren()

  visible.forEach((value, index) => {
    const item = document.createElement('div')
    item.className = 'item'
    item.textContent = value
    item.dataset.index = String(index)
    item.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      selectItem(input, value)
    })
    item.addEventListener('mouseenter', () => {
      activeIndex = index
      updateActiveItem(shadow)
    })
    list.appendChild(item)
  })

  const rect = input.getBoundingClientRect()

  if (
    !input.isConnected ||
    rect.width === 0 ||
    rect.height === 0 ||
    rect.bottom < 0 ||
    rect.top > window.innerHeight
  ) {
    hideDropdown()
    return
  }

  const width = Math.max(rect.width, 220)
  const maxWidth = Math.max(160, window.innerWidth - rect.left - 8)
  dropdownHost.style.left = `${Math.max(8, rect.left)}px`
  dropdownHost.style.top = `${rect.bottom + 4}px`
  dropdownHost.style.width = `${Math.min(width, maxWidth)}px`
  dropdownHost.style.display = 'block'

  // 空间不足时翻转到输入框上方。
  const dropdownRect = dropdownHost.getBoundingClientRect()

  if (dropdownRect.bottom > window.innerHeight - 8) {
    dropdownHost.style.top = `${Math.max(8, rect.top - dropdownRect.height - 4)}px`
  }
}

/** 更新键盘选中态。 */
const updateActiveItem = (shadow: ShadowRoot): void => {
  shadow.querySelectorAll<HTMLElement>('.item').forEach((item, index) => {
    item.classList.toggle('is-active', index === activeIndex)
  })
}

/** 显示账号下拉。 */
const showDropdown = async (input: HTMLInputElement): Promise<void> => {
  const requestId = ++showRequestId

  await loadHistory(true)

  if (requestId !== showRequestId || !input.isConnected) return

  renderDropdown(input)
}

/** 处理键盘选择。 */
const handleKeyDown = (event: KeyboardEvent): void => {
  if (!activeInput || !host || host.style.display === 'none') return

  const visible = getVisibleHistory(activeInput)

  if (!shadowRoot) return

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (visible.length === 0) return

    event.preventDefault()
    const delta = event.key === 'ArrowDown' ? 1 : -1
    activeIndex = (activeIndex + delta + visible.length) % visible.length
    updateActiveItem(shadowRoot)
    return
  }

  if (event.key === 'Enter' && activeIndex >= 0 && visible[activeIndex]) {
    event.preventDefault()
    selectItem(activeInput, visible[activeIndex])
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    hideDropdown()
  }
}

/** 初始化账号历史监听。 */
const setup = (): void => {
  if (document.getElementById(HOST_ID)) return

  void loadHistory()

  document.addEventListener(
    'focusin',
    (event) => {
      const input = findAccountInput(event)

      if (input) void showDropdown(input)
    },
    true
  )

  document.addEventListener(
    'click',
    (event) => {
      const input = findAccountInput(event)

      if (input) void showDropdown(input)
    },
    true
  )

  document.addEventListener(
    'input',
    (event) => {
      const input = findAccountInput(event)

      if (input && input === activeInput) renderDropdown(input)
    },
    true
  )

  document.addEventListener(
    'change',
    (event) => {
      const input = findAccountInput(event)

      if (input) void saveHistory(input.value, input)
    },
    true
  )

  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target

      if (!(form instanceof HTMLFormElement)) return

      for (const element of Array.from(form.elements)) {
        if (isAccountInput(element)) void saveHistory(element.value, element)
      }
    },
    true
  )

  document.addEventListener('keydown', handleKeyDown, true)

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!host || host.style.display === 'none') return
      if (event.composedPath().includes(host)) return
      if (findAccountInput(event)) return

      hideDropdown()
    },
    true
  )

  let repositionFrame: number | null = null
  const handleViewportChange = (event?: Event): void => {
    if (event && host) {
      const target = event.target

      if (event.composedPath().includes(host)) return
      if (target instanceof Node && host.contains(target)) return
    }

    if (repositionFrame !== null) return

    repositionFrame = window.requestAnimationFrame(() => {
      repositionFrame = null

      if (activeInput) renderDropdown(activeInput)
      else hideDropdown()
    })
  }

  window.addEventListener('resize', handleViewportChange, true)
  window.addEventListener('scroll', handleViewportChange, true)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup, { once: true })
} else {
  setup()
}
