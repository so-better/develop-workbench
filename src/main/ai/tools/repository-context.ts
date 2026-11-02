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
      '一次性读取一个或多个已配置代码仓库的分支、顶层目录、关键词命中文件、代码匹配行、package.json 和近期提交。分析需求时把需求标题、模块、分支名等关键词一起传入；可用 repositories[].branch 指定要分析的分支，不传时读取当前分支；branchWarning 非空表示指定分支不存在并已回退当前分支。不要再为每个目录或文件单独调用 executeShell。',
    metadata: { label: '读取仓库上下文' },
    inputSchema: z.object({
      repositories: z
        .array(
          z.union([
            z.string(),
            z.object({
              path: z.string().describe('仓库绝对路径'),
              branch: z
                .string()
                .optional()
                .describe('要分析的分支；不传时使用当前分支')
            })
          ])
        )
        .min(1)
        .max(4)
        .describe('绑定的仓库路径或带分支的仓库对象'),
      keywords: z
        .array(z.string())
        .max(8)
        .describe('需求标题、模块、页面、接口、字段或业务关键词')
    }),
    execute: async ({ repositories, keywords }) => ({
      ok: true,
      repositories: await getRepositoryContext(
        repositories.map((repository) =>
          typeof repository === 'string'
            ? { path: repository }
            : repository
        ),
        keywords
      )
    })
  }),
  readRepositoryFiles: tool({
    description:
      '批量读取已配置仓库中的多个文件内容，一次最多 8 个文件，单文件默认返回 64KB。可为每个文件指定 branch，读取该分支内容；不传时读取当前工作区。返回 truncated=true 时，用同一个 path、branch 和 nextOffset 继续读取；skipped 会列出未读取文件及原因。先用 getRepositoryContext 定位文件，再一次性批量读取。',
    metadata: { label: '批量读取代码文件' },
    inputSchema: z.object({
      files: z
        .array(
          z.union([
            z.string(),
            z.object({
              path: z.string().describe('文件绝对路径'),
              branch: z
                .string()
                .optional()
                .describe('要读取的分支；不传时读取当前工作区'),
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
