/**
 * shadcn/ui 组件的 React 18 兼容 shim。
 *
 * 主项目使用 React 19（含 bigint 类型的 ReactNode），插件使用 React 18。
 * 两者类型不互通（TS2786 "X cannot be used as a JSX component"）。
 *
 * 这里把插件用到的 shadcn/ui 组件重新声明为宽松类型，
 * 绕过跨主项目/插件的 React 类型差异。运行时仍由 vite 在打包阶段
 * 通过 `@ → ../../src` 别名解析到主项目真实组件。
 *
 * 注意：
 *  - 此文件必须是全局脚本（不能有顶层 import/export），否则
 *    `declare module` 不会生效。
 *  - 每次新增 shadcn/ui 引用都需要在这里补充对应 shim。
 */

declare module '@/components/ui/label' {
  import type { ComponentType, ReactNode } from 'react'
  export const Label: ComponentType<
    { className?: string; children?: ReactNode; htmlFor?: string } & Record<string, unknown>
  >
}

declare module '@/components/ui/input' {
  import type { ChangeEvent, ComponentType } from 'react'
  export const Input: ComponentType<{
    value?: string | number
    onChange?: (e: ChangeEvent<HTMLInputElement>) => void
    className?: string
    placeholder?: string
    type?: string
    disabled?: boolean
    [key: string]: unknown
  }>
}

declare module '@/components/ui/number-input' {
  import type { ComponentType } from 'react'
  export const NumberInput: ComponentType<{
    value: number
    onChange: (value: number) => void
    min?: number
    max?: number
    step?: number
    unit?: string
    className?: string
    disabled?: boolean
    compact?: boolean
  }>
}

declare module '@/components/ui/select' {
  import type { ComponentType, ReactNode } from 'react'
  export const Select: ComponentType<{
    value?: string
    onValueChange?: (value: string) => void
    disabled?: boolean
    children?: ReactNode
  }>
  export const SelectTrigger: ComponentType<{ className?: string; children?: ReactNode }>
  export const SelectValue: ComponentType<{ placeholder?: string }>
  export const SelectContent: ComponentType<{ children?: ReactNode }>
  export const SelectItem: ComponentType<{ value: string; children?: ReactNode }>
}

declare module '@/components/ui/radio-group' {
  import type { ComponentType, ReactNode } from 'react'
  export const RadioGroup: ComponentType<{
    value?: string
    onValueChange?: (value: string) => void
    disabled?: boolean
    className?: string
    children?: ReactNode
  }>
  export const RadioGroupItem: ComponentType<{ value: string; id?: string }>
}

declare module '@/lib/utils' {
  export function cn(...inputs: unknown[]): string
}
