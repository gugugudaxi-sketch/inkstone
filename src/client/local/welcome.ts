import content from './welcome.md?raw'
import { newDemoId, refreshNote, type DemoState } from '../demo/state'
import type { Note } from '@shared/types'

/** Install once, including upgrades; deleting the guide must remain permanent. */
export function installLocalWelcome(state: DemoState): boolean {
  if (state.localWelcomeInstalled) return false
  if (![...state.notes.values()].some((note) => note.title === '欢迎使用 Inkstone')) {
    const now = Date.now()
    const base: Note = {
      id: newDemoId(), title: '欢迎使用 Inkstone', content: '', excerpt: '',
      folderId: null, tags: [], isPinned: true, isStarred: false, isArchived: false,
      wordCount: 0, charCount: 0, rev: 1, position: now,
      createdAt: now, updatedAt: now, deletedAt: null,
    }
    const note = refreshNote(base, content)
    state.notes.set(note.id, note)
    for (const tag of note.tags) if (!state.tagIds.has(tag)) state.tagIds.set(tag, newDemoId())
    state.cursor += 1
  }
  state.localWelcomeInstalled = true
  return true
}
