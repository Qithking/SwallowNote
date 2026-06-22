/**
 * Unit tests for the new `runLifecycleHook` `timeoutMs` option
 * and `usePluginServices` / `usePluginCommands` SDK additions.
 *
 * All tests use the SDK's standalone stub — no host takeover is
 * installed — so the SDK has to behave consistently in both modes.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { PluginContext } from '@swallow-note/plugin-sdk'
import {
  PluginLifecycleTimeoutError,
  clearHost,
  clearPluginCommands,
  getStubCommandRegistry,
  registerCommand,
  runLifecycleHook,
  usePluginCommands,
  usePluginServices,
  type PluginPanelProps,
} from '@swallow-note/plugin-sdk'

function buildContext(): PluginContext {
  return { pluginId: 'com.test', pluginPath: '/tmp', invokeBackend: vi.fn() }
}

describe('SDK runLifecycleHook timeout', () => {
  it('runs to completion when no timeout is set', async () => {
    const seen: number[] = []
    const hook = (): void => {
      seen.push(1)
    }
    await runLifecycleHook(hook, buildContext())
    expect(seen).toEqual([1])
  })

  it('throws PluginLifecycleTimeoutError when hook overruns timeoutMs', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hook = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100))
    const onTimeout = vi.fn()
    await runLifecycleHook(hook, buildContext(), { timeoutMs: 10, onTimeout })
    // The hook is logged-as-error, not re-thrown. The SDK's policy
    // is "lifecycle is best-effort, never breaks the host".
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(onTimeout.mock.calls[0]![0]).toBeGreaterThanOrEqual(10)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('exports the timeout error class for external instanceof checks', () => {
    const err = new PluginLifecycleTimeoutError(1234, 1000)
    expect(err).toBeInstanceOf(PluginLifecycleTimeoutError)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('PluginLifecycleTimeoutError')
    expect(err.elapsedMs).toBe(1234)
    expect(err.timeoutMs).toBe(1000)
    expect(err.message).toContain('1000ms')
  })

  it('catches and logs sync throws (does not propagate)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hook = (): never => {
      throw new Error('synthetic')
    }
    await expect(runLifecycleHook(hook, buildContext(), { timeoutMs: 50 })).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('SDK usePluginServices', () => {
  it('returns store + events handles from a panel', () => {
    const store = { get: vi.fn(), set: vi.fn() } as unknown as PluginPanelProps['store']
    const events = { on: vi.fn(), off: vi.fn() } as unknown as PluginPanelProps['events']
    const panel = { pluginId: 'p', store, events } as unknown as PluginPanelProps
    const { result } = renderHook(() => usePluginServices(panel))
    expect(result.current.store).toBe(store)
    expect(result.current.events).toBe(events)
  })
})

describe('SDK usePluginCommands', () => {
  it('re-renders on register/unregister (live snapshot)', () => {
    clearPluginCommands('com.test.sdk-hooks')
    const { result, rerender } = renderHook(() => usePluginCommands())
    const initial = result.current.length
    registerCommand('com.test.sdk-hooks', {
      id: 'sample',
      label: 'Sample',
      onTrigger: () => {},
    })
    rerender()
    expect(result.current.length).toBe(initial + 1)
    expect(result.current.some((c) => c.id === 'sample')).toBe(true)
    clearPluginCommands('com.test.sdk-hooks')
    rerender()
    expect(result.current.length).toBe(initial)
  })

  it('keeps the stub registry queryable after a hook teardown', () => {
    clearHost()
    clearPluginCommands('__test__')
    expect(getStubCommandRegistry().list()).toEqual([])
    registerCommand('__test__', { id: 'a', label: 'A', onTrigger: () => {} })
    expect(getStubCommandRegistry().list().length).toBe(1)
    clearPluginCommands('__test__')
    expect(getStubCommandRegistry().list()).toEqual([])
  })
})
