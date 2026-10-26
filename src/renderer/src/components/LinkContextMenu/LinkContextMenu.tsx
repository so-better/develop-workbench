import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CopyOutlined, GlobalOutlined, PlusOutlined } from '@ant-design/icons'
import { App, Popconfirm } from 'antd'
import { getErrorMessage } from '../../../../utils'

interface LinkMenuState {
  x: number
  y: number
  href: string
  name: string
}

const MENU_WIDTH = 176
const MENU_HEIGHT = 128

const getLinkName = (anchor: HTMLAnchorElement, href: string): string => {
  const explicit =
    anchor.getAttribute('aria-label')?.replace(/\s+/g, ' ').trim() ||
    anchor.getAttribute('title')?.replace(/\s+/g, ' ').trim()
  const text = anchor.textContent?.replace(/\s+/g, ' ').trim() || ''

  if (explicit && explicit !== href && !/^https?:\/\//i.test(explicit)) {
    return explicit.slice(0, 60)
  }

  if (text && !/^https?:\/\//i.test(text)) return text.slice(0, 60)

  try {
    return new URL(href).hostname
  } catch {
    return href
  }
}

/**
 * 全局链接右键菜单。
 * 统一提供复制、应用内打开和添加到站点。
 */
export default function LinkContextMenu(): JSX.Element | null {
  const { message } = App.useApp()
  const menuRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<LinkMenuState | null>(null)

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent): void => {
      const target = event.target

      if (!(target instanceof Element)) {
        setMenu(null)
        return
      }

      const anchor = target.closest<HTMLAnchorElement>('a[href]')

      if (!anchor) {
        setMenu(null)
        return
      }

      const href = anchor.href

      if (!/^https?:\/\//i.test(href)) {
        setMenu(null)
        return
      }

      event.preventDefault()
      setMenu({
        x: Math.max(
          8,
          Math.min(event.clientX, window.innerWidth - MENU_WIDTH - 8)
        ),
        y: Math.max(
          8,
          Math.min(event.clientY, window.innerHeight - MENU_HEIGHT - 8)
        ),
        href,
        name: getLinkName(anchor, href)
      })
    }

    const closeIfOutside = (event: PointerEvent): void => {
      const target = event.target

      if (!(target instanceof Element)) {
        setMenu(null)
        return
      }

      if (
        menuRef.current?.contains(target) ||
        target.closest('.ant-popover')
      ) {
        return
      }

      setMenu(null)
    }
    const close = (): void => setMenu(null)
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }

    document.addEventListener('contextmenu', handleContextMenu)
    document.addEventListener('pointerdown', closeIfOutside, true)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu)
      document.removeEventListener('pointerdown', closeIfOutside, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  useEffect(() => {
    if (menu) menuRef.current?.querySelector('button')?.focus()
  }, [menu])

  if (!menu) return null

  return createPortal(
    <div
      ref={menuRef}
      className="link-context-menu"
      role="menu"
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        onClick={async () => {
          try {
            await window.electron.copyText(menu.href)
            message.success('链接已复制')
          } catch {
            message.error('复制链接失败')
          } finally {
            setMenu(null)
          }
        }}
      >
        <CopyOutlined />
        复制链接
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          window.electron.openEmbeddedBrowser(menu.href)
          setMenu(null)
        }}
      >
        <GlobalOutlined />
        打开链接
      </button>
      <Popconfirm
        title="添加到站点？"
        description={
          <div className="link-context-confirm">
            <div>{menu.name}</div>
            <div className="link-context-confirm-url">{menu.href}</div>
          </div>
        }
        placement="rightTop"
        okText="添加"
        cancelText="取消"
        onConfirm={async () => {
          try {
            await window.electron.addSite({
              name: menu.name,
              url: menu.href,
              tags: []
            })
            message.success('已添加到站点')
            window.dispatchEvent(new Event('sites:changed'))
          } catch (error) {
            message.error(getErrorMessage(error, '添加站点失败'))
          } finally {
            setMenu(null)
          }
        }}
      >
        <button type="button" role="menuitem">
          <PlusOutlined />
          添加到站点
        </button>
      </Popconfirm>
    </div>,
    document.body
  )
}
