/**
 * 将 Git 远程地址转换为不包含 .git 的仓库根地址。
 * 支持 https 和常见 SSH 地址。
 */
export const getRemoteRepositoryBaseUrl = (
  remoteUrl?: string | null
): string | null => {
  if (!remoteUrl?.trim()) return null

  let normalized = remoteUrl.trim()

  const scpMatch = normalized.match(/^git@([^:]+):(.+)$/)
  const sshMatch = normalized.match(/^ssh:\/\/git@([^/]+)\/(.+)$/)

  if (scpMatch) {
    normalized = `https://${scpMatch[1]}/${scpMatch[2]}`
  } else if (sshMatch) {
    normalized = `https://${sshMatch[1]}/${sshMatch[2]}`
  }

  try {
    const url = new URL(normalized)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

    const path = url.pathname.replace(/\.git\/?$/i, '').replace(/\/$/, '')

    return path ? `${url.origin}${path}` : null
  } catch {
    return null
  }
}

/** 打开远程仓库分支页面。 */
export const getRemoteBranchesUrl = (
  remoteUrl?: string | null
): string | null => {
  const baseUrl = getRemoteRepositoryBaseUrl(remoteUrl)

  return baseUrl ? `${baseUrl}/branches` : null
}

/** 按 Codeup 地址格式生成创建合并请求页面。 */
export const getMergeRequestUrl = (
  remoteUrl: string | null | undefined,
  sourceBranch: string,
  targetBranch: string
): string | null => {
  const baseUrl = getRemoteRepositoryBaseUrl(remoteUrl)

  if (!baseUrl) return null

  return `${baseUrl}/changes/new?target_branch=${encodeURIComponent(
    targetBranch
  )}&source_branch=${encodeURIComponent(sourceBranch)}`
}
