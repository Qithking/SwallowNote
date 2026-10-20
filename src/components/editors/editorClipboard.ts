/**
 * 编辑器剪贴板纯文本修正。
 *
 * 根因（fix/blocknote-copy-plain-text）：BlockNote 0.55 的 copyToClipboard 插件接管
 * 编辑器内 copy/cut 事件后，向剪贴板 text/plain 写入的是 markdown 序列化结果，
 * 粘贴到纯文本目标应用时会看到 **、[]() 等格式符号（违反 text/plain 语义约定）。
 *
 * 本模块在事件冒泡末尾重写 text/plain 为选区纯文本；
 * text/html 与 blocknote/html 保持 BlockNote 原值，编辑器内/富文本粘贴不回归。
 */

/** 判断事件是否由 BlockNote 编辑器内部复制触发（其插件会写入专有类型 blocknote/html） */
function isBlockNoteCopy(clipboardData: DataTransfer | null): boolean {
  if (!clipboardData) return false
  try {
    return Array.from(clipboardData.types).includes('blocknote/html')
  } catch {
    return false
  }
}

/**
 * copy/cut 事件冒泡到 document 时 BlockNote 已写完剪贴板，
 * 此处用 ProseMirror 选区纯文本重写 text/plain。
 * 空 selection / 非 BlockNote 触发 / 读取失败时保持原值不动。
 */
export function rewritePlainTextFromSelection(
  editor: unknown,
  event: { clipboardData: DataTransfer | null },
): void {
  const clipboardData = event.clipboardData
  if (!isBlockNoteCopy(clipboardData)) return
  try {
    // 与 MarkdownEditor.getSelectedText 相同的读取路径：经 _tiptapEditor 取 ProseMirror 选区
    const tiptapEditor = (editor as { _tiptapEditor?: { state: { selection: { from: number; to: number; empty: boolean }; doc: { textBetween: (from: number, to: number, blockSeparator?: string) => string } } } | null })._tiptapEditor
    if (!tiptapEditor) return
    const { from, to, empty } = tiptapEditor.state.selection
    // 空选区交由 BlockNote 原行为处理，不做重写
    if (empty || from === to) return
    // 块间用空行分隔，贴近 markdown 对多段落复制的语义
    const plainText = tiptapEditor.state.doc.textBetween(from, to, '\n\n')
    clipboardData?.setData('text/plain', plainText)
  } catch {
    // 选区读取失败时保持 BlockNote 原值，不破坏复制
  }
}

/**
 * 在 document 冒泡阶段挂载 copy/cut 监听，仅处理目标位于 container 内的事件。
 * 冒泡顺序保证晚于 BlockNote 在编辑器 DOM 上的处理，覆盖写入生效。
 * 返回清理函数。
 */
export function attachPlainTextCopyHandling(
  editor: unknown,
  getContainer: () => HTMLElement | null,
): () => void {
  const handler = (event: Event) => {
    const container = getContainer()
    if (!container) return
    const target = event.target
    if (!(target instanceof Node) || !container.contains(target)) return
    rewritePlainTextFromSelection(editor, event as ClipboardEvent)
  }
  document.addEventListener('copy', handler)
  document.addEventListener('cut', handler)
  return () => {
    document.removeEventListener('copy', handler)
    document.removeEventListener('cut', handler)
  }
}
