/**
 * Markdown 图片相对路径解析为绝对路径的纯函数。
 *
 * 用于将 Markdown 中 `![](./images/foo.png)` 这类相对路径解析为本地绝对路径，
 * 供调用方再通过 `convertFileSrc()` 转为 Tauri asset 协议 URL。
 *
 * 平台兼容：
 * - 同时支持正斜杠 `/` 和反斜杠 `\` 作为路径分隔符（Windows 用户常写反斜杠）
 * - 识别 Unix 绝对路径（`/`）和 Windows 盘符绝对路径（`C:/` 或 `C:\`）
 * - `http://` / `https://` / `data:` / `asset://` 等完整 URL 原样返回
 */

/** 已是完整 URL / 协议前缀，无需解析 */
function isAbsoluteUrl(url: string): boolean {
  return (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('data:') ||
    url.startsWith('asset://') ||
    url.startsWith('http://asset.localhost')
  )
}

/** 已是本地绝对路径（Unix `/` 或 Windows 盘符 `C:\` / `C:/`） */
function isLocalAbsolutePath(url: string): boolean {
  return url.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(url)
}

/**
 * 解析 Markdown 图片相对路径为本地绝对路径。
 *
 * @param url - Markdown 中图片 src 原始值
 * @param currentFilePath - 当前笔记的绝对路径（已归一化或未归一化均可）
 * @param rootPath - 工作区根目录绝对路径（当 currentFilePath 为空或其父目录不可用时回退）
 * @returns 解析后的本地绝对路径（正斜杠分隔）；若无法解析则原样返回 url
 */
export function resolveMarkdownImagePath(
  url: string,
  currentFilePath: string,
  rootPath: string,
): string {
  // 完整 URL 原样返回
  if (isAbsoluteUrl(url)) {
    return url
  }

  // 空路径原样返回
  if (!url) {
    return url
  }

  // 已是本地绝对路径
  if (isLocalAbsolutePath(url)) {
    return url
  }

  // 相对路径：基于当前文件所在目录解析
  const fileDir =
    (currentFilePath || '').split(/[\\/]/).slice(0, -1).join('/') || rootPath || ''

  if (!fileDir) {
    return url
  }

  // 归一化：去掉前导 ./，反斜杠转正斜杠（与 resolveFilePath 行为一致）
  const normalizedUrl = url.replace(/^\.\//, '').replace(/\\/g, '/')

  const urlParts = normalizedUrl.split('/')
  const dirParts = fileDir.split('/')

  for (const part of urlParts) {
    if (part === '..') {
      dirParts.pop()
    } else if (part && part !== '.') {
      dirParts.push(part)
    }
  }

  return dirParts.join('/')
}
