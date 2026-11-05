/**
 * 需求相关链接的本地持久化。
 * 自动扫描只补充记录，人工修改优先；不向 Meegle 回写需求内容。
 */
import { app, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { backupCorruptStore } from './store-backup'
import { normalizeRequirementLinkUrl } from '../types/requirement-links'
import type { RequirementLink, RequirementLinkScope } from '../types/requirement-links'

const linkSchema = z.object({ name: z.string().trim().min(1).max(200), url: z.string().max(8192).transform(normalizeRequirementLinkUrl) })
const scopeSchema = z.object({ projectKey: z.string().min(1).max(500), requirementId: z.string().min(1).max(500) })
const idSchema = z.string().min(1)
const storeSchema = z.record(z.string(), z.object({
  links: z.array(linkSchema.extend({ id: z.string().min(1) })),
  // 删除排除可由手动扫描恢复；旧版本混合记录继续按此规则兼容。
  suppressed: z.array(z.string()),
  // 编辑替换的旧地址不随手动扫描恢复，仍允许用户手动添加。
  replaced: z.array(z.string()).default([])
}))
type Store = z.infer<typeof storeSchema>
const storePath = (): string => join(app.getPath('userData'), 'requirement-links.json')

/** 旧数据可能同时存在污染地址和规范化地址，读取后按 URL 去重并修正名称。 */
const dedupeLinks = (store: Store): Store => {
  for (const state of Object.values(store)) {
    const seen = new Set<string>()
    state.links = state.links.filter((link) => {
      // 旧版自动识别会把正文并入名称，名称是纯地址时改用地址生成更易辨认的标题。
      if (/^https?:\/\//i.test(link.name)) {
        try {
          const parsed = new URL(link.url)
          link.name = `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`.slice(0, 200)
        } catch {
          // 地址异常时保留原名称，交给后续编辑处理。
        }
      }
      if (seen.has(link.url)) return false
      seen.add(link.url)
      return true
    })
  }
  return store
}

/** 文件不存在视为首次使用；读取失败直接上抛，损坏内容先备份再提示。 */
const readStore = async (): Promise<Store> => {
  let raw: string
  try { raw = await readFile(storePath(), 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  try { return dedupeLinks(storeSchema.parse(JSON.parse(raw))) } catch {
    await backupCorruptStore(storePath())
    throw new Error('相关链接数据损坏，已备份，请检查备份后重试')
  }
}
let queue: Promise<unknown> = Promise.resolve()
// 用元组序列化避免简单拼接时，空间或需求 ID 中的分隔符造成键冲突。
const keyOf = (scope: RequirementLinkScope): string => JSON.stringify([scope.projectKey, scope.requirementId])

/** 扫描和人工维护共用队列，避免刷新覆盖编辑或其他需求的数据。 */
const mutateRequirementLinks = (
  scope: RequirementLinkScope,
  operation: (state: Store[string]) => void
): Promise<RequirementLink[]> => {
  const result = queue.then(async (): Promise<RequirementLink[]> => {
    const store = await readStore()
    const key = keyOf(scope)
    const state = store[key] ?? { links: [], suppressed: [], replaced: [] }
    const before = JSON.stringify(state)
    operation(state)
    if (before !== JSON.stringify(state)) {
      // 无变化的扫描不写盘；先写独立临时文件再替换，避免写入失败截断原文件。
      store[key] = state
      const path = storePath()
      const temporary = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify(store, null, 2), 'utf8')
        await rename(temporary, path)
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined)
      }
    }
    return state.links
  })
  // 本次失败仍返回给调用方，但不能让队列永久拒绝后续需求的操作。
  queue = result.catch(() => undefined)
  return result
}

/** 自动扫描尊重排除记录；手动扫描可重新发现原始地址，但不覆盖已有链接。 */
export const scanRequirementLinks = (scopeValue: unknown, linksValue: unknown, restoreValue: unknown = false): Promise<RequirementLink[]> => {
  const scope = scopeSchema.parse(scopeValue)
  const links = z.array(linkSchema).parse(linksValue)
  const restoreDeleted = z.boolean().parse(restoreValue)
  return mutateRequirementLinks(scope, (state) => {
    if (restoreDeleted) {
      // 只恢复本次仍存在于需求内容中的地址，避免一次手动扫描清空所有历史排除记录。
      const discoveredUrls = new Set(links.map((link) => link.url))
      state.suppressed = state.suppressed.filter((url) => !discoveredUrls.has(url))
    }
    for (const link of links) {
      if (!state.suppressed.includes(link.url) && !state.replaced.includes(link.url) && !state.links.some((item) => item.url === link.url)) {
        state.links.push({ ...link, id: randomUUID() })
      }
    }
  })
}

/** 手动新增链接；允许重新添加曾被删除的地址，但不允许当前列表中重复。 */
export const addRequirementLink = (scopeValue: unknown, linkValue: unknown): Promise<RequirementLink[]> => {
  const scope = scopeSchema.parse(scopeValue)
  const link = linkSchema.parse(linkValue)
  return mutateRequirementLinks(scope, (state) => {
    if (state.links.some((item) => item.url === link.url)) throw new Error('该链接已存在')
    state.links.push({ ...link, id: randomUUID() })
  })
}

/** 按稳定 ID 编辑链接，并排除旧地址，避免扫描重新添加已被替换的入口。 */
export const updateRequirementLink = (scopeValue: unknown, idValue: unknown, linkValue: unknown): Promise<RequirementLink[]> => {
  const scope = scopeSchema.parse(scopeValue)
  const id = idSchema.parse(idValue)
  const link = linkSchema.parse(linkValue)
  return mutateRequirementLinks(scope, (state) => {
    const current = state.links.find((item) => item.id === id)
    if (!current) throw new Error('链接已不存在，请刷新后重试')
    if (state.links.some((item) => item.id !== id && item.url === link.url)) throw new Error('该链接已存在')
    if (current.url !== link.url) {
      state.replaced = [...new Set([...state.replaced, current.url])]
    }
    // 当前手动选定的地址重新成为有效入口，之后若删除可由手动扫描恢复。
    state.replaced = state.replaced.filter((url) => url !== link.url)
    Object.assign(current, link)
  })
}

/** 删除记录并记住其地址，使后续自动扫描不会恢复用户已删除的链接。 */
export const removeRequirementLink = (scopeValue: unknown, idValue: unknown): Promise<RequirementLink[]> => {
  const scope = scopeSchema.parse(scopeValue)
  const id = idSchema.parse(idValue)
  return mutateRequirementLinks(scope, (state) => {
    const link = state.links.find((item) => item.id === id)
    if (!link) return
    state.suppressed = [...new Set([...state.suppressed, link.url])]
    state.replaced = state.replaced.filter((url) => url !== link.url)
    state.links = state.links.filter((item) => item.id !== id)
  })
}

/** 注册独立的扫描、新增、编辑、删除 IPC，参数校验由对应业务函数负责。 */
export const initializeRequirementLinks = (): void => {
  ipcMain.handle('requirement-links:scan', (_event, scope: unknown, links: unknown, restoreDeleted: unknown) => scanRequirementLinks(scope, links, restoreDeleted))
  ipcMain.handle('requirement-links:add', (_event, scope: unknown, link: unknown) => addRequirementLink(scope, link))
  ipcMain.handle('requirement-links:update', (_event, scope: unknown, id: unknown, link: unknown) => updateRequirementLink(scope, id, link))
  ipcMain.handle('requirement-links:remove', (_event, scope: unknown, id: unknown) => removeRequirementLink(scope, id))
}
