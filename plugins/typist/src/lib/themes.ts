/**
 * Theme metadata for the typist plugin frontend.
 *
 * The CSS itself lives in the Rust backend (`themes.rs`) so the
 * frontend can never drift from the source of truth. This module
 * just hard-codes the same id/label/platform tuples so the picker
 * can render labels in a stable order without a round-trip to the
 * backend on every render.
 *
 * The backend is also queried on mount (via `themes_list`) so any
 * mismatch surfaces as a console warning during development.
 */
export interface ThemeMeta {
  id: string
  name: string
  platform: string
}

export const STATIC_THEMES: ThemeMeta[] = [
  { id: 'wechat-default', name: '公众号默认', platform: 'wechat' },
  { id: 'wechat-rose', name: '蔷薇紫', platform: 'wechat' },
  { id: 'wechat-geek', name: '极客黑', platform: 'wechat' },
  { id: 'wechat-tech', name: '科技蓝', platform: 'wechat' },
  { id: 'wechat-minimal', name: '简约白', platform: 'wechat' },
]

export const DEFAULT_THEME_ID = 'wechat-default'
export const DEFAULT_PLATFORM = 'wechat'
