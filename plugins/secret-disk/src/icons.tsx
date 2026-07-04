/**
 * 密盘插件图标组件。
 *
 * 侧边栏图标使用 Lock 图标，传达"加密私有空间"的语义。
 */
import { Lock } from 'lucide-react'

export function SecretDiskIcon({ size = 20 }: { size?: number }) {
  return <Lock size={size} strokeWidth={1.8} />
}
