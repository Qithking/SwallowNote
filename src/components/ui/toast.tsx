import * as ToastPrimitive from '@radix-ui/react-toast'
import { cn } from '@/lib/utils'

const ToastProvider = ToastPrimitive.Provider

const ToastViewport = ToastPrimitive.Viewport

const Toast = ToastPrimitive.Root

const ToastAction = ToastPrimitive.Action

const ToastClose = ToastPrimitive.Close

const ToastTitle = ToastPrimitive.Title

const ToastDescription = ToastPrimitive.Description

const toastVariants = cn(
  'group flex items-center gap-3 px-4 py-3 rounded-md border shadow-lg',
  'bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-primary)]',
  'data-[state=open]:animate-in slide-in-from-bottom-2 fade-in duration-200',
  'data-[state=closed]:animate-out slide-out-to-bottom-2 fade-out duration-200'
)

const toastViewportVariants = cn(
  'fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2'
)

const toastCloseVariants = cn(
  'absolute right-2 top-2 p-1 rounded-md opacity-70 hover:opacity-100',
  'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
  'focus:outline-none focus:ring-2 focus:ring-[var(--accent)]'
)

const toastDescriptionVariants = cn(
  'text-sm text-[var(--text-muted)]'
)

export {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastAction,
  ToastClose,
  ToastTitle,
  ToastDescription,
  toastVariants,
  toastViewportVariants,
  toastCloseVariants,
  toastDescriptionVariants,
}
