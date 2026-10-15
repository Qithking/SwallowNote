/**
 * 自定义 slash menu hook。
 * 从 MarkdownEditor.tsx 抽出：默认菜单项 + Mermaid/KaTeX/Markmap 模板插入。
 */
import { useCallback } from 'react'
import type { BlockNoteEditor } from '@blocknote/core'
import { getDefaultReactSlashMenuItems } from '@blocknote/react'
import { Network, Sigma } from 'lucide-react'
import { MERMAID_BLOCK_TYPE } from './mermaidBlockSpec'
import { KATEX_BLOCK_TYPE } from './katexBlockSpec'
import { MARKMAP_BLOCK_TYPE } from './markmapBlockSpec'
import { mermaidTemplates, katexTemplates, markmapTemplates } from './editorSlashMenuData'

/**
 * 在当前位置插入自定义 block：当前 block 为空时替换，否则插入其后。
 */
function insertCustomBlock(editor: BlockNoteEditor<any, any, any>, type: string, props: Record<string, any>) {
  const newBlock = { type, props } as any
  const currentBlock = editor.getTextCursorPosition().block
  if (Array.isArray(currentBlock.content) && currentBlock.content.length === 0) {
    editor.updateBlock(currentBlock, newBlock)
  } else {
    editor.insertBlocks([newBlock], currentBlock.id, 'after')
  }
}

export function useCustomSlashMenu(editor: BlockNoteEditor<any, any, any>) {
  const getCustomSlashMenuItems = useCallback(async (query: string) => {
    const defaultItems = getDefaultReactSlashMenuItems(editor)

    const mermaidItems = mermaidTemplates.map(tpl => ({
      title: tpl.title,
      icon: <Network size={18} />,
      subtext: tpl.subtext,
      group: 'MerMaid',
      aliases: tpl.aliases,
      onItemClick: () => insertCustomBlock(editor, MERMAID_BLOCK_TYPE, {
        source: `\`\`\`mermaid\n${tpl.diagram}\`\`\``,
        diagram: tpl.diagram,
      }),
    }))

    const katexItems = katexTemplates.map(tpl => ({
      title: tpl.title,
      icon: <Sigma size={18} />,
      subtext: tpl.subtext,
      group: 'Katex',
      aliases: tpl.aliases,
      onItemClick: () => {
        const language = tpl.display ? 'math' : 'math-inline'
        insertCustomBlock(editor, KATEX_BLOCK_TYPE, {
          source: `\`\`\`${language}\n${tpl.formula}\n\`\`\``,
          formula: tpl.formula,
          display: tpl.display,
        })
      },
    }))

    const markmapItems = markmapTemplates.map(tpl => ({
      title: tpl.title,
      icon: <Network size={18} />,
      subtext: tpl.subtext,
      group: 'Markmap',
      aliases: tpl.aliases,
      onItemClick: () => insertCustomBlock(editor, MARKMAP_BLOCK_TYPE, {
        source: `\`\`\`markmap\n${tpl.diagram}\`\`\``,
        diagram: tpl.diagram,
      }),
    }))

    const allItems = [...defaultItems, ...mermaidItems, ...katexItems, ...markmapItems]

    // Filter items by query
    const lowerQuery = query.toLowerCase()
    return allItems.filter((item) => {
      const titleMatch = item.title.toLowerCase().includes(lowerQuery)
      const subtextMatch = item.subtext?.toLowerCase().includes(lowerQuery) ?? false
      const aliasMatch = item.aliases?.some((alias: string) => alias.toLowerCase().includes(lowerQuery)) ?? false
      return titleMatch || subtextMatch || aliasMatch
    })
  }, [editor])

  return getCustomSlashMenuItems
}
