/**
 * 回归测试: debug session `conflict-panel-blank`
 * 症状: 文件 tab 激活时打开冲突 tab → EditorToolbar 的 early return
 * 跳过其后方的 useEffect → "Rendered fewer hooks than expected"
 * → React 卸载整棵树 → 应用不显示(白屏)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { invoke } from '@tauri-apps/api/core'
import { EditorToolbar } from '../EditorToolbar'
import { useEditorStore } from '@/stores/editor'
import { useGitStore } from '@/stores/git'

const REPO_PATH = 'D:/Workdoc'

function seedFileTab() {
  useEditorStore.setState({
    tabs: [{
      id: 'file-1',
      path: 'D:/Workdoc/202608.md',
      name: '202608.md',
      content: '# hello',
      isDirty: false,
      isEdited: false,
      viewMode: 'preview',
    }],
    activeTabId: 'file-1',
  })
}

describe('EditorToolbar: tab type switch must not change hook count', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    seedFileTab()
    useGitStore.setState({
      repositories: [{
        name: 'Workdoc', path: REPO_PATH, remoteUrl: null,
        hasUncommittedChanges: false, uncommittedCount: 0,
        currentBranch: 'main', isSubmodule: false, parentPath: null,
        status: 'conflict',
      }],
    })
  })

  it('survives activeTab switch file → conflict (hooks stable)', () => {
    // 第一轮: 文件 tab, 渲染完整 hook 链
    render(<TooltipProvider><EditorToolbar /></TooltipProvider>)

    // 第二轮: GitView 点击仓库 → openConflictTab → activeTab 变 conflict 类型
    // 修复前: early return 跳过后置 useEffect → React 抛
    // "Rendered fewer hooks than expected" 并卸载整棵树
    expect(() => {
      act(() => {
        useEditorStore.getState().openConflictTab(REPO_PATH, 'Workdoc')
      })
    }).not.toThrow()
  })
})
