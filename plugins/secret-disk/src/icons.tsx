/** 密盘插件图标组件：使用 Lock 图标 */
import { Lock } from 'lucide-react'

export function SecretDiskIcon({ size = 20 }: { size?: number }) {
  return <Lock size={size} strokeWidth={1.8} />
}
