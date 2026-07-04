/**
 * 密盘插件入口。
 *
 * 静态元数据（id/name/version/...）从 manifest.json 导入，Vite 在构建时内联。
 * 运行时字段（icon/panel/settings）在此文件组装。
 */
/* eslint-disable react-refresh/only-export-components */
import type { PluginManifest } from '@swallow-note/plugin-sdk'
export { setHost } from '@swallow-note/plugin-sdk'
import manifestJson from '../manifest.json'
import { SecretDiskIcon } from './icons'
import { SecretDiskPanel } from './SecretDiskPanel'
import { SecretDiskSettings } from './SecretDiskSettings'

const manifest = {
  ...manifestJson,
  icon: SecretDiskIcon,
  panel: SecretDiskPanel,
  settings: SecretDiskSettings,
} as PluginManifest

export default manifest
