import { useEffect } from 'react'
import { get, set } from 'idb-keyval'
import { create } from 'zustand'
import { useSession } from '../store/session'

export const useCustomFontStatus = create<{ status: 'idle' | 'loading' | 'ready' | 'error' }>(() => ({ status: 'idle' }))

export function CustomFontLoader() {
  const userId = useSession((state) => state.user?.id)
  const preferences = useSession((state) => state.settings.appearance.customFont)
  useEffect(() => {
    const root = document.documentElement
    let cancelled = false
    let face: FontFace | null = null
    const reset = () => {
      root.style.removeProperty('--custom-font')
      root.style.removeProperty('--font-ui')
      delete root.dataset.customFontLoaded
      delete root.dataset.customFontEditor
      delete root.dataset.customFontProse
    }
    reset()
    const id = preferences.activeId
    if (!userId || !id || typeof FontFace === 'undefined') {
      useCustomFontStatus.setState({ status: id ? 'error' : 'idle' })
      return reset
    }
    useCustomFontStatus.setState({ status: 'loading' })
    const controller = new AbortController()
    void (async () => {
      const cacheKey = `inkstone:font:${userId}:${id}`
      let bytes = await get<ArrayBuffer>(cacheKey).catch(() => undefined)
      if (!bytes) {
        const response = await fetch(`/api/files/${id}`, { credentials: 'same-origin', signal: controller.signal })
        if (!response.ok) throw new Error('Font unavailable')
        bytes = await response.arrayBuffer()
      }
      const loaded = await new FontFace(`InkstoneFont_${id}`, bytes).load()
      if (cancelled) return
      face = loaded
      document.fonts.add(loaded)
      void set(cacheKey, bytes).catch(() => {})
      const family = `"InkstoneFont_${id}"`
      root.style.setProperty('--custom-font', family)
      root.dataset.customFontLoaded = 'true'
      if (preferences.interface) root.style.setProperty('--font-ui', `${family}, var(--font-ui-default)`)
      if (preferences.editor) root.dataset.customFontEditor = 'true'
      if (preferences.prose) root.dataset.customFontProse = 'true'
      useCustomFontStatus.setState({ status: 'ready' })
    })().catch(() => {
      if (!cancelled) useCustomFontStatus.setState({ status: 'error' })
    })
    return () => {
      cancelled = true
      controller.abort()
      if (face) document.fonts.delete(face)
      reset()
    }
  }, [userId, preferences])
  return null
}
