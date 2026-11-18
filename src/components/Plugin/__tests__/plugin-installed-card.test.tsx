/**
 * 回归测试：插件启停开关的状态一致性与防重入（dev-code-review P1）。
 *
 * 缺陷：卡片无 in-flight 守卫，toggle 进行中连点并发两次反向 invoke；
 * handleToggleEnabled 吞错永不 reject → 失败时 UI 与真实状态不一致。
 *
 * 修复契约：
 * - 卡片：busy 守卫（进行中忽略点击）；resolve=成功保持、reject=失败回滚
 * - handleToggleEnabled：失败时 rethrow 把失败传给 caller
 *
 * 注意：卡片有 host 值 re-sync effect（plugin.enabled 为 source of truth），
 * 测试用 wrapper 持有 enabled 状态并在成功回调后翻转，模拟真实 caller。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useState } from 'react'

import { PluginInstalledCard } from '../PluginInstalledCard'

function makePlugin(enabled: boolean) {
  return {
    id: 'p1',
    name: 'Test Plugin',
    version: '1.0.0',
    description: '',
    author: '',
    enabled,
    permissions: [],
  } as any
}

/** 模拟真实 caller：成功时翻转 host 值，失败保持（触发卡片回滚路径） */
function ToggleHarness(props: { onToggle: (enabled: boolean) => Promise<void> }) {
  const [enabled, setEnabled] = useState(false)
  const plugin = makePlugin(enabled)
  return (
    <PluginInstalledCard
      plugin={plugin}
      index={1}
      onToggle={async (next) => {
        await props.onToggle(next)
        setEnabled(next)
      }}
    />
  )
}

describe('PluginInstalledCard 启停开关（状态一致性 + 防重入）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('onToggle reject：开关 UI 回滚到原状态（失败不误导用户）', async () => {
    render(
      <ToggleHarness onToggle={vi.fn().mockRejectedValue(new Error('backend failed'))} />
    )
    const sw = screen.getByRole('switch')
    expect(sw.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(sw)
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('false'))
  })

  it('toggle 进行中连点：onToggle 只被调用一次（busy 守卫）', async () => {
    let resolveFn!: () => void
    const onToggle = vi.fn(
      () => new Promise<void>((resolve) => { resolveFn = resolve })
    )
    render(<ToggleHarness onToggle={onToggle} />)
    const sw = screen.getByRole('switch')

    fireEvent.click(sw)
    fireEvent.click(sw)
    fireEvent.click(sw)
    expect(onToggle).toHaveBeenCalledTimes(1)

    await act(async () => { resolveFn() })
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'))

    // 结束后恢复可点
    fireEvent.click(sw)
    await waitFor(() => expect(onToggle).toHaveBeenCalledTimes(2))
  })

  it('onToggle resolve：开关保持新状态', async () => {
    render(
      <ToggleHarness onToggle={vi.fn().mockResolvedValue(undefined)} />
    )
    const sw = screen.getByRole('switch')
    fireEvent.click(sw)
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'))
  })
})
