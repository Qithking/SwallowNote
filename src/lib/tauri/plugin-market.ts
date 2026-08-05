import { invoke } from '@tauri-apps/api/core'

// 市场源管理
export interface MarketSourceView {
  name: string
  url: string
  is_active: boolean
}

export async function listMarketSources(): Promise<MarketSourceView[]> {
  return await invoke<MarketSourceView[]>('list_market_sources')
}

export async function addMarketSource(name: string, url: string): Promise<void> {
  await invoke('add_market_source', { name, url })
}

export async function removeMarketSource(url: string): Promise<void> {
  await invoke('remove_market_source', { url })
}

export async function setActiveMarketSource(url: string): Promise<void> {
  await invoke('set_active_market_source', { url })
}

export async function getActiveMarketSource(): Promise<MarketSourceView | null> {
  return await invoke<MarketSourceView | null>('get_active_market_source')
}
