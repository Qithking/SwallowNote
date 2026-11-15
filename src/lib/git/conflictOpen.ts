/**
 * S-02 前端修复：普通打开文件时的冲突拦截。
 *
 * 约束：冲突处理只走冲突面板——冲突文件（工作树含 <<<<<<< 标记）不得通过
 * 普通编辑器 tab 加载内容（编辑器正文不出现冲突标记）。文件树/搜索等普通
 * 打开入口在加载内容前调用本守卫：命中冲突则改走冲突面板并返回冲突信息，
 * 未命中返回 null 让调用方继续普通打开。
 */
import { useEditorStore } from '@/stores/editor'
import { useGitStore } from '@/stores/git'

export interface ConflictGuardHit {
  isConflict: true
  repoPath: string
}

/**
 * 判断 filePath 是否位于 repoPath 内（前缀匹配）。
 * Windows 文件系统大小写不敏感：repoPath 与 filePath 可能大小写写法不同
 * （如 D:/Notes 与 D:/notes）——前缀比较忽略大小写；长度不变，
 * slice 结果不受大小写影响，相对路径内容仍正确。
 * 不命中返回 null（调用方回退使用完整 filePath）。
 */
function relPathWithin(repoPath: string, filePath: string): string | null {
  if (
    repoPath &&
    filePath.length > repoPath.length &&
    filePath.slice(0, repoPath.length).toLowerCase() === repoPath.toLowerCase() &&
    filePath.charAt(repoPath.length) === '/'
  ) {
    return filePath.slice(repoPath.length + 1)
  }
  return null
}

/**
 * 检查文件是否为 git 冲突文件；若是，打开对应冲突面板并返回命中信息，
 * 否则返回 null（调用方继续普通打开流程）。
 */
export function openFileWithConflictGuard(filePath: string): ConflictGuardHit | null {
  const hit = useGitStore.getState().isConflictFile(filePath)
  if (!hit) return null

  // 计算仓库内相对路径作为冲突面板自动选中项（与 ConflictResolver 的
  // initialSelectedFile 语义一致：仓库内相对路径）
  const rel = relPathWithin(hit.repoPath, filePath) ?? filePath
  useEditorStore.getState().openConflictTab(hit.repoPath, hit.repoName, {
    autoSelectFile: rel,
    autoHideTree: false,
  })
  return { isConflict: true, repoPath: hit.repoPath }
}
