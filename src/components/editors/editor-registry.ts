/**
 * EditorRegistry — 编辑器注册中心
 * 统一管理内置 + 插件编辑器的注册与路由
 */
import type { ComponentType, LazyExoticComponent } from 'react'
import type { EditorTab } from '@/stores/editor'
import type { FileType } from '@/lib/utils/fileTypeUtils'

/** 统一的编辑器 Props 契约 */
export interface EditorProps {
  tab: EditorTab
  onChange: (content: string) => void
  onFlush?: () => Promise<void>
}

/** match 函数可访问的上下文 */
export interface EditorMatchContext {
  tab: EditorTab
  fileType: FileType
  pluginExtensions: Set<string>
}

/** adapter 接收的上下文:调用方传入 tab + 默认 onChange,adapter 转换为编辑器所需 props */
export interface EditorAdapterContext {
  tab: EditorTab
  onChange: (content: string) => void
}

/** 编辑器描述符 — 注册到 registry 的单元 */
export interface EditorDescriptor {
  /** 唯一 ID */
  id: string
  /** 匹配器:给定上下文,返回是否用这个编辑器 */
  match: (ctx: EditorMatchContext) => boolean
  /** lazy 加载的组件 */
  component: LazyExoticComponent<ComponentType<EditorProps>> | ComponentType<EditorProps>
  /** Props 适配器:从 ctx 提取编辑器需要的 props(可做 content 转换、onChange 包装) */
  adapter: (ctx: EditorAdapterContext) => EditorProps
  /** 优先级:数字越大越优先(插件=100, 内置=10, shim=1) */
  priority: number
}

/** Registry 实例接口 */
export interface EditorRegistry {
  register(descriptor: EditorDescriptor): void
  unregister(id: string): void
  resolve(ctx: EditorMatchContext): EditorDescriptor | null
  listDescriptors(): readonly EditorDescriptor[]
}

function createEditorRegistry(): EditorRegistry {
  const descriptors = new Map<string, EditorDescriptor>()

  return {
    register(descriptor) {
      descriptors.set(descriptor.id, descriptor)
    },

    unregister(id) {
      descriptors.delete(id)
    },

    resolve(ctx) {
      let best: EditorDescriptor | null = null
      for (const desc of descriptors.values()) {
        if (desc.match(ctx) && (!best || desc.priority > best.priority)) {
          best = desc
        }
      }
      return best
    },

    listDescriptors() {
      return Array.from(descriptors.values())
    },
  }
}

export { createEditorRegistry }
