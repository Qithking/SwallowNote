/**
 * BUG: 插件裸 console.log 不经任何捕获，只进 webview console —— 应用日志查看器看不到。
 *
 * 行为契约: 插件源码改写阶段把插件代码中的裸 console.* 调用改写到统一日志通道
 * （__snPluginLog = createPluginLogger(pluginId)，source=plugin:<id>），
 * 插件后端子进程日志也同源展示，应用日志查看器即可看到全部插件日志。
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/i18n', () => ({
  default: { t: (k: string) => k, language: 'en', on: vi.fn(), off: vi.fn() },
}))

import { applyPluginCodeRewrites } from '@/lib/plugin-loader'

const PLUGIN_ID = 'com.test.app'

describe('BUG: 插件裸 console.* 必须改写到统一日志通道', () => {
  it('console.log/warn/error 被改写为 __snPluginLog.* 并注入专属 logger 定义', () => {
    const code = [
      'export function boot() {',
      "  console.log('hello from plugin');",
      "  console.warn('careful');",
      "  console.error(new Error('boom'));",
      '}',
    ].join('\n')

    const out = applyPluginCodeRewrites(code, PLUGIN_ID)

    expect(out).toContain('__snPluginLog.log(')
    expect(out).toContain('__snPluginLog.warn(')
    expect(out).toContain('__snPluginLog.error(')
    expect(out).not.toContain('console.log(')
    // 注入的定义行绑定插件 id（source=plugin:<id>）
    expect(out).toContain(`plugin:${PLUGIN_ID}`)
  })

  it('console.debug/info/trace 同样改写；模块级调用（非函数体内）也覆盖', () => {
    const code = "console.debug('dbg');\nconsole.info('nfo');\nconsole.trace('trc');"
    const out = applyPluginCodeRewrites(code, PLUGIN_ID)
    expect(out).toContain('__snPluginLog.debug(')
    expect(out).toContain('__snPluginLog.info(')
    expect(out).toContain('__snPluginLog.trace(')
  })

  it('既有 import 重写行为不回归（react externals）', () => {
    const code = 'import { useState } from "react";\nexport const s = useState;'
    const out = applyPluginCodeRewrites(code, PLUGIN_ID)
    expect(out).toContain('const useState = window.React.useState;')
  })
})
