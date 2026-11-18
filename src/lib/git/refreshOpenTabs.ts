/**
 * S-01 修复：git 同步（pull）完成后刷新已打开的编辑器 tab。
 *
 * 根因（审计 S-01）：useFileWatcher 在 isPulling/isSyncing 期间丢弃全部
 * file-watcher-event，而 pull --rebase 真实改写工作区文件；同步结束无补偿
 * 刷新 → 已加载且非 dirty 的 tab 保持旧内容，用户保存后磁盘/提交回退为旧版。
 *
 * 修复语义（遵循「冲突只能走冲突面板」约束）：
 * - pull 成功的仓库：非 dirty 普通 tab 强制重载磁盘最新内容；dirty tab 保留
 *   用户编辑（标外部变更，不覆盖）
 * - 冲突仓库的普通 tab：工作树含 <<<<<<< 标记，不得加载进编辑器——关闭该
 *   tab 并引导用户从冲突面板处理（不在此处打开面板，避免重复入口）
 */
import { useEditorStore } from '@/stores/editor'
import { useGitStore } from '@/stores/git'

/**
 * 同步完成后刷新已打开的普通 tab。
 * @param pulledRepoPaths 本次 pull 实际参与的仓库路径（成功 + 冲突）
 */
export async function refreshOpenTabsAfterSync(pulledRepoPaths: string[]): Promise<void> {
  // P2 修复：Windows 路径大小写不敏感（NTFS），tab.path 与仓库根路径大小写
  // 不一致（如 C:\Notes vs C:\notes）时前缀匹配恒失败 → tab 漏刷新，
  // 编辑器内容回退旧版。Windows 下统一小写比较；POSIX 大小写敏感保持原样。
  const normalizePath = (p: string) =>
    typeof process !== 'undefined' && process.platform === 'win32' ? p.toLowerCase() : p
  const repoPathSet = new Set(pulledRepoPaths.map(normalizePath))
  const editorStore = useEditorStore.getState()
  const gitStore = useGitStore.getState()

  // 冲突文件绝对路径集合：工作树含标记，不得加载进普通 tab
  const conflictFilePaths = new Set<string>()
  for (const files of Object.values(gitStore.conflictFilesMap)) {
    for (const f of files) conflictFilePaths.add(f)
  }

  for (const tab of editorStore.tabs) {
    // 仅处理普通文件 tab（conflict/diff/plugin tab 无磁盘文件内容可加载）
    if (tab.type === 'conflict' || tab.type === 'diff' || tab.type === 'plugin') continue
    // 仅处理属于本次 pull 仓库的 tab
    const tabPath = normalizePath(tab.path)
    if (!repoPathSet.has(tabPath) && ![...repoPathSet].some((p) => tabPath.startsWith(p + '/'))) continue

    // 冲突文件：工作树含标记，不得加载进普通 tab
    if (conflictFilePaths.has(tab.path)) {
      // P0-1 修复：此分支原先位于 dirty 保护之前且无条件 removeTab——dirty tab
      // 的未保存编辑随 tab 一起被静默丢弃（数据丢失）。
      // 按用户约束分流（冲突文件只标记、冲突只能在冲突面板处理）：
      // - dirty：保留 tab 与内存中未保存编辑（从未含冲突标记，不写任何冲突标识
      //   进文件），仅标记外部变更提示磁盘已是冲突态；文件仍是 unmerged 状态，
      //   冲突解决路径不变，仍只能走冲突面板。
      // - 非 dirty：保持现行为，关闭 tab 引导用户从冲突面板处理。
      if (tab.isDirty || tab.frontmatterDirty) {
        editorStore.markExternalChange(tab.id)
      } else {
        editorStore.removeTab(tab.id)
      }
      continue
    }

    // 非 dirty：强制重载磁盘最新内容（S-01 核心）
    if (!tab.isDirty && !tab.frontmatterDirty) {
      await editorStore.loadTabContent(tab.id, 0, true).catch(() => {})
      continue
    }

    // dirty：保留用户未保存编辑，标记外部变更让用户决定
    editorStore.markExternalChange(tab.id)
  }
}
