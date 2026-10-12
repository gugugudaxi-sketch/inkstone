import { describe, expect, it } from 'vitest'
import { freshLocalState } from './storage'
import { installLocalWelcome } from './welcome'

describe('local welcome migration', () => {
  it('seeds a single local guide and never reinstalls after deletion', () => {
    const state = freshLocalState()
    expect(state.notes.size).toBe(1)
    const guide = [...state.notes.values()][0]!
    expect(guide.title).toBe('欢迎使用 Inkstone')
    expect(guide.content).not.toMatch(/OAuth|Workers AI|设置 → MCP|WebDAV|安装.*PWA/)
    state.notes.clear()
    expect(installLocalWelcome(state)).toBe(false)
    expect(state.notes.size).toBe(0)
  })
  it('adds the guide to an old vault without replacing existing notes or a matching imported guide', () => {
    const state = freshLocalState()
    delete state.localWelcomeInstalled
    const existing = [...state.notes.values()][0]!
    existing.title = '我的内容'
    existing.content = '不能覆盖'
    expect(installLocalWelcome(state)).toBe(true)
    expect(state.notes.size).toBe(2)
    expect(state.notes.get(existing.id)?.content).toBe('不能覆盖')
    delete state.localWelcomeInstalled
    expect(installLocalWelcome(state)).toBe(true)
    expect(state.notes.size).toBe(2)
  })
})
