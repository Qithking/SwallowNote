/**
 * ImagePreviewEditor 组件测试
 * Source: spec/image-preview AC-1, AC-7
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ImagePreviewEditor } from '@/components/editors/ImagePreviewEditor'
import type { EditorTab } from '@/stores/editor'

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}))

function makeTab(overrides: Partial<EditorTab> = {}): EditorTab {
  return {
    id: 'tab-1',
    path: '/test/image.png',
    name: 'image.png',
    content: '',
    isDirty: false,
    isEdited: false,
    viewMode: 'preview',
    ...overrides,
  } as EditorTab
}

describe('ImagePreviewEditor', () => {
  it('渲染 <img> 元素并用 convertFileSrc 转换路径', () => {
    const tab = makeTab({ path: '/notes/photo.png', name: 'photo.png' })
    const { container } = render(<ImagePreviewEditor tab={tab} onChange={() => {}} />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('asset:///notes/photo.png')
  })

  it('加载失败时显示错误提示(含文件名)', async () => {
    const tab = makeTab({ name: 'broken.png' })
    const { container } = render(<ImagePreviewEditor tab={tab} onChange={() => {}} />)
    const img = container.querySelector('img')!
    fireEvent.error(img)
    // img 消失,错误提示显示文件名
    expect(await screen.findByText(/broken\.png/)).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
  })

  it('加载成功时不显示错误提示', () => {
    const tab = makeTab({ name: 'ok.png' })
    const { container } = render(<ImagePreviewEditor tab={tab} onChange={() => {}} />)
    const img = container.querySelector('img')!
    fireEvent.load(img)
    expect(screen.queryByText(/无法加载/)).toBeNull()
  })

  it('根容器使用 w-full h-full 占满父容器', () => {
    const tab = makeTab()
    const { container } = render(<ImagePreviewEditor tab={tab} onChange={() => {}} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('w-full')
    expect(root.className).toContain('h-full')
  })

  it('图片默认最大宽度为容器的 80%', () => {
    const tab = makeTab()
    const { container } = render(<ImagePreviewEditor tab={tab} onChange={() => {}} />)
    const img = container.querySelector('img')!
    expect(img.className).toContain('max-w-[80%]')
  })

  it('根容器使用 flex items-center justify-center 实现居中', () => {
    const tab = makeTab()
    const { container } = render(<ImagePreviewEditor tab={tab} onChange={() => {}} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('items-center')
    expect(root.className).toContain('justify-center')
  })
})
