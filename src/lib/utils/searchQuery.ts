/**
 * Frontmatter cache used by the file tree to avoid repeatedly reading files
 * when sorting / displaying frontmatter-derived metadata.
 */
import type { NoteFrontmatter } from '@/lib/types/frontmatter'
import { parseFrontmatter } from '@/lib/utils/frontmatter'

const frontmatterCache = new Map<string, NoteFrontmatter>()

/**
 * Get frontmatter for a file, using cache when available.
 * Reads the file content and parses frontmatter on cache miss.
 */
export async function getFileFrontmatter(filePath: string): Promise<NoteFrontmatter> {
  const cached = frontmatterCache.get(filePath)
  if (cached) return cached

  try {
    const { readFile } = await import('@/lib/tauri')
    const content = await readFile(filePath)
    const { data } = parseFrontmatter(content)
    frontmatterCache.set(filePath, data)
    return data
  } catch {
    return {}
  }
}

/**
 * Get frontmatter for a file from raw content string (sync version for when content is already available).
 */
export function getFrontmatterFromContent(content: string): NoteFrontmatter {
  const { data } = parseFrontmatter(content)
  return data
}

/**
 * Invalidate cache entry for a specific file path.
 */
export function invalidateFrontmatterCache(filePath: string): void {
  frontmatterCache.delete(filePath)
}

/**
 * Clear the entire frontmatter cache.
 */
export function clearFrontmatterCache(): void {
  frontmatterCache.clear()
}
