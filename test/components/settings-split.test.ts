/**
 * SettingsView 拆分验证测试
 * 验证子面板模块存在且导出 React 组件
 */
import { describe, it, expect } from 'vitest'

describe('SettingsView split', () => {
  it('SettingRow shared component exists', async () => {
    const mod = await import('@/components/Settings/SettingRow')
    expect(mod.SettingRow).toBeDefined()
    expect(typeof mod.SettingRow).toBe('function')
  })

  it('GeneralSettings panel exists', async () => {
    const mod = await import('@/components/Settings/panels/GeneralSettings')
    expect(mod.GeneralSettings).toBeDefined()
    expect(typeof mod.GeneralSettings).toBe('function')
  })

  it('SyncSettings panel exists', async () => {
    const mod = await import('@/components/Settings/panels/SyncSettings')
    expect(mod.SyncSettings).toBeDefined()
    expect(typeof mod.SyncSettings).toBe('function')
  })

  it('AppearanceSettings panel exists', async () => {
    const mod = await import('@/components/Settings/panels/AppearanceSettings')
    expect(mod.AppearanceSettings).toBeDefined()
    expect(typeof mod.AppearanceSettings).toBe('function')
  })

  it('AiSettings panel exists', async () => {
    const mod = await import('@/components/Settings/panels/AiSettings')
    expect(mod.AiSettings).toBeDefined()
    expect(typeof mod.AiSettings).toBe('function')
  })

  it('ShortcutsSettings panel exists', async () => {
    const mod = await import('@/components/Settings/panels/ShortcutsSettings')
    expect(mod.ShortcutsSettings).toBeDefined()
    expect(typeof mod.ShortcutsSettings).toBe('function')
  })

  it('PluginSettings panel exists', async () => {
    const mod = await import('@/components/Settings/panels/PluginSettings')
    expect(mod.PluginSettings).toBeDefined()
    expect(typeof mod.PluginSettings).toBe('function')
  })

  it('DevelopmentSettings panel exists', async () => {
    const mod = await import('@/components/Settings/panels/DevelopmentSettings')
    expect(mod.DevelopmentSettings).toBeDefined()
    expect(typeof mod.DevelopmentSettings).toBe('function')
  })
})
