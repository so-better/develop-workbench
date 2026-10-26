import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'
import {
  addSite as createSiteRecord,
  getSiteState,
  removeSite as removeSiteRecord,
  updateSite as updateSiteRecord
} from '../../sites'

/**
 * 站点管理工具。
 * 读接口可直接调用，写接口要求模型先说明变更并获得用户确认。
 */
export const siteTools: ToolSet = {
  listSites: tool({
    description:
      '读取用户在本机保存的所有站点，返回 id、名称、URL、标签、打开次数和最近打开时间。分析、更新或删除站点前先调用。',
    metadata: { label: '查询站点' },
    inputSchema: z.object({}),
    execute: async () => getSiteState()
  }),
  addSite: tool({
    description:
      '新增一个本机站点。只有用户明确确认新增后才调用。name、url、tags 必填，没有标签时传空数组。',
    metadata: { label: '新增站点' },
    inputSchema: z.object({
      name: z.string().describe('站点名称'),
      url: z.string().describe('站点 URL，仅支持 http/https'),
      tags: z.array(z.string()).describe('站点标签，没有时传空数组')
    }),
    execute: async ({ name, url, tags }) =>
      createSiteRecord({ name, url, tags })
  }),
  updateSite: tool({
    description:
      '更新一个本机站点。只有用户明确确认修改后才调用。先用 listSites 获取站点 id，并传入完整的 name、url、tags。',
    metadata: { label: '更新站点' },
    inputSchema: z.object({
      id: z.string().describe('listSites 返回的站点 id'),
      name: z.string().describe('新的站点名称'),
      url: z.string().describe('新的站点 URL'),
      tags: z.array(z.string()).describe('新的站点标签，没有时传空数组')
    }),
    execute: async ({ id, name, url, tags }) => {
      return updateSiteRecord(id, { name, url, tags })
    }
  }),
  deleteSite: tool({
    description:
      '删除一个本机站点。只有用户明确确认删除后才调用。先用 listSites 获取站点 id。',
    metadata: { label: '删除站点' },
    inputSchema: z.object({
      id: z.string().describe('listSites 返回的站点 id')
    }),
    execute: async ({ id }) => removeSiteRecord(id)
  })
}
