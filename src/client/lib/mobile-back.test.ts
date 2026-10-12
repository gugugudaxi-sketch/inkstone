import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUi } from '../store/ui'

const overlays = vi.hoisted(() => ({ depth: 0, listeners: new Set<() => void>() }))
const flush = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../store/notes', () => ({ useNotes: { getState: () => ({ flush }) } }))
vi.mock('../components/overlay', () => ({
  getEscapeStackDepth: () => overlays.depth,
  dismissTopOverlay: () => {
    if (!overlays.depth) return false
    overlays.depth--
    for (const listener of overlays.listeners) listener()
    return true
  },
  subscribeEscapeStack: (listener: () => void) => {
    overlays.listeners.add(listener)
    return () => overlays.listeners.delete(listener)
  },
}))
import { installMobileBack } from './mobile-back'

let dispose: () => void
let rootState: unknown
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve))
function pop(state: unknown) {
  history.replaceState(state, '')
  window.dispatchEvent(new PopStateEvent('popstate', { state }))
}
function touch(target: Element, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true })
  const point = { clientX: x, clientY: y }
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [point] })
  Object.defineProperty(event, 'changedTouches', { value: [point] })
  target.dispatchEvent(event)
}

beforeEach(() => {
  overlays.depth = 0
  flush.mockClear()
  history.replaceState({ otherFeature: true }, '')
  useUi.setState({ mobilePane: 'list', panel: null })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 400 })
  dispose = installMobileBack()
  rootState = history.state
})
afterEach(() => { dispose(); vi.restoreAllMocks(); document.body.replaceChildren() })

describe('mobile back navigation', () => {
  it('returns from a note to the list and flushes without putting note content in history', async () => {
    useUi.getState().setMobilePane('preview')
    await settle()
    expect(history.state.inkstoneMobileBack.depth).toBe(1)
    expect(history.state.otherFeature).toBe(true)
    pop(rootState)
    await settle()
    expect(useUi.getState().mobilePane).toBe('list')
    expect(flush).toHaveBeenCalledWith({ immediate: true })
    expect(history.state.inkstoneMobileBack.depth).toBe(0)
  })

  it('closes nested overlays one at a time before returning from the account page', async () => {
    useUi.getState().setMobilePane('account')
    await settle()
    const accountState = history.state
    overlays.depth = 1
    for (const listener of overlays.listeners) listener()
    await settle()
    const firstOverlayState = history.state
    overlays.depth = 2
    for (const listener of overlays.listeners) listener()
    await settle()
    pop(firstOverlayState)
    await settle()
    expect(overlays.depth).toBe(1)
    expect(useUi.getState().mobilePane).toBe('account')
    pop(accountState)
    await settle()
    expect(overlays.depth).toBe(0)
    pop(rootState)
    await settle()
    expect(useUi.getState().mobilePane).toBe('list')
  })

  it('removes its guard after tapping the existing back button, without closing another layer', async () => {
    const go = vi.spyOn(history, 'go').mockImplementation(() => {})
    useUi.getState().setMobilePane('editor')
    await settle()
    useUi.getState().setMobilePane('list')
    await settle()
    expect(go).toHaveBeenCalledWith(-1)
    pop(rootState)
    await settle()
    expect(flush).not.toHaveBeenCalled()
    expect(useUi.getState().mobilePane).toBe('list')
  })

  it('does not add duplicate history entries on remount or autosave updates', async () => {
    useUi.getState().setMobilePane('preview')
    await settle()
    const push = vi.spyOn(history, 'pushState')
    useUi.setState({ fontScale: 17 })
    await settle()
    dispose()
    dispose = installMobileBack()
    expect(push).not.toHaveBeenCalled()
  })

  it('accepts inward swipes from either edge but preserves editing and vertical scrolling', async () => {
    useUi.getState().setMobilePane('preview')
    await settle()
    const back = vi.spyOn(history, 'back').mockImplementation(() => {})
    const body = document.createElement('div')
    document.body.append(body)
    touch(body, 'touchstart', 10, 100)
    touch(body, 'touchend', 110, 110)
    expect(back).toHaveBeenCalledTimes(1)
    // Native popstate cancels a pending touch so the same gesture cannot return twice.
    pop(rootState)
    touch(body, 'touchend', 110, 110)
    useUi.getState().setMobilePane('preview')
    await settle()
    const input = document.createElement('textarea')
    body.append(input)
    touch(input, 'touchstart', 10, 100)
    touch(input, 'touchend', 110, 110)
    touch(body, 'touchstart', 10, 100)
    touch(body, 'touchend', 100, 250)
    expect(back).toHaveBeenCalledTimes(1)
    touch(body, 'touchstart', 390, 100)
    touch(body, 'touchend', 290, 110)
    expect(back).toHaveBeenCalledTimes(2)
  })
})
