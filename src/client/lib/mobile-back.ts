import { useEffect } from 'react'
import { dismissTopOverlay, getEscapeStackDepth, subscribeEscapeStack } from '../components/overlay'
import { useUi } from '../store/ui'
import { useNotes } from '../store/notes'

const HISTORY_KEY = 'inkstoneMobileBack'

type Marker = { session: string; depth: number }

function marker(state: unknown): Marker | null {
  const value = (state as Record<string, unknown> | null)?.[HISTORY_KEY] as Marker | undefined
  return value && typeof value.session === 'string' && Number.isInteger(value.depth) && value.depth >= 0
    ? value : null
}

function navigationDepth(): number {
  return (useUi.getState().mobilePane === 'list' ? 0 : 1) + getEscapeStackDepth()
}

// The history entries contain only navigation depth, never note text or credentials.
export function installMobileBack(): () => void {
  const existing = marker(history.state)
  const session = existing?.session ?? crypto.randomUUID()
  let depth = existing?.depth ?? 0
  let moving = false
  let disposed = false
  let queued = false
  let gesturePending = false
  const write = (nextDepth: number, push: boolean) => {
    const state = { ...history.state, [HISTORY_KEY]: { session, depth: nextDepth } }
    if (push) history.pushState(state, '')
    else history.replaceState(state, '')
  }
  if (!existing) write(0, false)

  const sync = () => {
    queued = false
    if (disposed || moving || gesturePending) return
    const wanted = navigationDepth()
    if (wanted < depth) {
      moving = true
      history.go(wanted - depth)
    } else {
      while (depth < wanted) write(++depth, true)
    }
  }
  const schedule = () => {
    if (queued || disposed) return
    queued = true
    queueMicrotask(sync)
  }
  const onPop = (event: PopStateEvent) => {
    const target = marker(event.state)
    if (!target || target.session !== session) return
    gesturePending = false
    touch = null
    depth = target.depth
    if (moving) {
      moving = false
      schedule()
      return
    }
    if (navigationDepth() > depth) {
      if (!dismissTopOverlay()) {
        // Existing autosave retains its offline queue; request a prompt flush as well.
        void useNotes.getState().flush({ immediate: true })
        useUi.getState().setMobilePane('list')
      }
    }
    schedule()
  }
  const unsubscribeUi = useUi.subscribe(schedule)
  const unsubscribeOverlays = subscribeEscapeStack(schedule)
  window.addEventListener('popstate', onPop)
  sync()

  // A short edge swipe works in standalone browsers without their own back gesture.
  // Editable content, selections and horizontal scrollers retain their native gestures.
  let touch: { x: number; y: number; time: number; direction: number } | null = null
  const onStart = (event: TouchEvent) => {
    touch = null
    if (event.touches.length !== 1 || depth === 0 || moving || gesturePending) return
    const target = event.target instanceof Element ? event.target : null
    if (!target || target.closest('input, textarea, select, [contenteditable], .cm-editor')) return
    if (window.getSelection()?.toString()) return
    for (let node: Element | null = target; node; node = node.parentElement) {
      if (node.scrollWidth > node.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(node).overflowX)) return
    }
    const first = event.touches[0]!
    const width = document.documentElement.clientWidth
    const direction = first.clientX <= 24 ? 1 : first.clientX >= width - 24 ? -1 : 0
    if (direction) touch = { x: first.clientX, y: first.clientY, time: performance.now(), direction }
  }
  const onMove = (event: TouchEvent) => {
    if (event.touches.length !== 1) touch = null
  }
  const onEnd = (event: TouchEvent) => {
    const start = touch
    touch = null
    const end = event.changedTouches[0]
    if (!start || !end || moving || gesturePending || depth === 0) return
    const dx = (end.clientX - start.x) * start.direction
    const dy = Math.abs(end.clientY - start.y)
    if (dx >= 72 && dy <= 40 && dx > dy * 2 && performance.now() - start.time <= 700) {
      gesturePending = true
      history.back()
    }
  }
  const cancel = () => { touch = null }
  document.addEventListener('touchstart', onStart, { passive: true })
  document.addEventListener('touchmove', onMove, { passive: true })
  document.addEventListener('touchend', onEnd, { passive: true })
  document.addEventListener('touchcancel', cancel, { passive: true })

  return () => {
    disposed = true
    unsubscribeUi()
    unsubscribeOverlays()
    window.removeEventListener('popstate', onPop)
    document.removeEventListener('touchstart', onStart)
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
    document.removeEventListener('touchcancel', cancel)
  }
}

export function useMobileBack(): void {
  useEffect(installMobileBack, [])
}
