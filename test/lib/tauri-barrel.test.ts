/**
 * tauri.ts barrel 拆分验证测试
 * 验证子模块存在且导出正确,以及 barrel re-export 保持兼容
 */
import { describe, it, expect } from 'vitest'

describe('tauri.ts barrel split', () => {
  it('file-dialogs module exports dialog functions', async () => {
    const mod = await import('@/lib/tauri/file-dialogs')
    expect(typeof mod.openFolderDialog).toBe('function')
    expect(typeof mod.openFileDialog).toBe('function')
    expect(typeof mod.saveFileDialog).toBe('function')
    expect(typeof mod.saveWorkspaceFileDialog).toBe('function')
    expect(typeof mod.savePluginConfigsDialog).toBe('function')
    expect(typeof mod.openPluginConfigsDialog).toBe('function')
  })

  it('file-ops module exports file operation functions', async () => {
    const mod = await import('@/lib/tauri/file-ops')
    expect(typeof mod.pathExists).toBe('function')
    expect(typeof mod.readFile).toBe('function')
    expect(typeof mod.writeFile).toBe('function')
    expect(typeof mod.createFile).toBe('function')
    expect(typeof mod.deleteFile).toBe('function')
    expect(typeof mod.renameFile).toBe('function')
  })

  it('git module exports git functions', async () => {
    const mod = await import('@/lib/tauri/git')
    expect(typeof mod.gitInit).toBe('function')
    expect(typeof mod.gitStatus).toBe('function')
    expect(typeof mod.gitCommit).toBe('function')
    expect(typeof mod.gitPush).toBe('function')
    expect(typeof mod.gitPull).toBe('function')
  })

  it('conflict module exports conflict functions', async () => {
    const mod = await import('@/lib/tauri/conflict')
    expect(typeof mod.gitAbortConflict).toBe('function')
    expect(typeof mod.getConflictRepoRecords).toBe('function')
    expect(typeof mod.computeWordDiff).toBe('function')
  })

  it('plugin-storage module exports plugin storage functions', async () => {
    const mod = await import('@/lib/tauri/plugin-storage')
    expect(typeof mod.getPluginStoragePath).toBe('function')
    expect(typeof mod.readPluginSettings).toBe('function')
    expect(typeof mod.getAllPluginStorageSizes).toBe('function')
  })

  it('plugin-market module exports market functions', async () => {
    const mod = await import('@/lib/tauri/plugin-market')
    expect(typeof mod.listMarketSources).toBe('function')
    expect(typeof mod.addMarketSource).toBe('function')
  })

  it('system module exports system functions', async () => {
    const mod = await import('@/lib/tauri/system')
    expect(typeof mod.getPlatform).toBe('function')
    expect(typeof mod.saveFolderHistory).toBe('function')
    expect(typeof mod.setAppLocale).toBe('function')
  })

  it('barrel re-exports all symbols from @/lib/tauri', async () => {
    const tauri = await import('@/lib/tauri')
    // 从每个子模块各抽一个验证 barrel 兼容
    expect(typeof tauri.openFolderDialog).toBe('function')
    expect(typeof tauri.pathExists).toBe('function')
    expect(typeof tauri.gitInit).toBe('function')
    expect(typeof tauri.gitAbortConflict).toBe('function')
    expect(typeof tauri.getPluginStoragePath).toBe('function')
    expect(typeof tauri.listMarketSources).toBe('function')
    expect(typeof tauri.getPlatform).toBe('function')
    // getHomeDir 在 file-ops 模块
    expect(typeof tauri.getHomeDir).toBe('function')
  })
})
