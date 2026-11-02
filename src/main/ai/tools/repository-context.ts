import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'
import {
  getRepositoryContext,
  readRepositoryFiles
} from '../../repositories'

/**
 * 需求分析仓库上下文工具。
 * 一次返回结构、命中文件和提交，减少逐文件 executeShell。
 */
export const repositoryContextTools: ToolSet = {
  getRepositoryContext: tool({
    description:
      '一次性读取一个或多个已配置代码仓库的分支、顶层目录、关键词命中文件、代码匹配行、package.json 和近期提交。分析需求或定位代码时优先调用此工具；把需求标题、模块名、接口名、页面名等关键词一起传入。不要再为每个目录或文件单独调用 executeShell。',
    metadata: { label: '读取仓库上下文' },
    inputSchema: z.object({
      paths: z
        .array(z.string())
        .min(1)
        .max(4)
        .describe('绑定的仓库绝对路径，通常直接使用提示词中提供的路径'),
      keywords: z
        .array(z.string())
        .max(8)
        .describe('需求标题、模块、页面、接口、字段或业务关键词')
    }),
    execute: async ({ paths, keywords }) => ({
      ok: true,
      repositories: await getRepositoryContext(paths, keywords)
    })
  }),
  readRepositoryFiles: tool({
    description:
      '批量读取已配置仓库中的多个文件内容，一次最多 8 个文件，单文件默认返回 64KB。返回 truncated=true 时，用同一个 path 和 nextOffset 继续读取剩余内容；skipped 会列出未读取文件及原因。先用 getRepositoryContext 定位文件，再一次性批量读取，不要为每个文件单独调用 cat。',
    metadata: { label: '批量读取代码文件' },
    inputSchema: z.object({
      files: z
        .array(
          z.union([
            z.string(),
            z.object({
              path: z.string().describe('文件绝对路径'),
              offset: z
                .number()
                .int()
                .min(0)
                .optional()
                .describe('从第几个字节开始读取；续读时传 nextOffset')
            })
          ])
        )
        .min(1)
        .max(8)
        .describe('要读取的文件；可传路径字符串或带 offset 的对象')
    }),
    execute: async ({ files }) =>
      readRepositoryFiles(
        files.map((file) =>
          typeof file === 'string' ? { path: file } : file
        )
      ).then((result) => ({ ok: true, ...result }))
  })
}
