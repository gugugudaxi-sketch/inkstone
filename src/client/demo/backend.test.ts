import { describe, expect, it } from 'vitest'
import { createDemoBackend, cloneBackendState } from './backend'
import { freshLocalState } from '../local/storage'
import type { DemoState } from './state'

const url = (path: string) => `https://appassets.androidplatform.net/api/${path}`
const request = (path: string, method = 'GET', body?: unknown) => new Request(url(path), {
  method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
})
function local() {
  const state = freshLocalState()
  state.notes.clear() // Backend tests use an empty vault; onboarding is tested separately.
  let saved: DemoState | undefined
  const backend = createDemoBackend({ state, local: true, persist: async (value) => { saved = cloneBackendState(value) } })
  return { state, backend, saved: () => saved! }
}

describe('durable local notebook', () => {
  it('opens without a login and stores settings across backend restart', async () => {
    const { backend, saved } = local()
    expect((await (await backend.fetch(request('auth/session'))).json()).user.username).toBe('local')
    const response = await backend.fetch(request('settings', 'PUT', { appearance: { theme: 'dark' } }))
    expect(response.ok).toBe(true)
    const reopened = createDemoBackend({ state: saved(), local: true })
    expect((await (await reopened.fetch(request('settings'))).json()).appearance.theme).toBe('dark')
  })
  it('does not create duplicates when a create request is retried', async () => {
    const { backend, saved } = local()
    const id = '01j00000000000000000000001'
    for (let i = 0; i < 3; i++) expect((await backend.fetch(request('notes', 'POST', { id, title: '一次创建', content: '你好' }))).ok).toBe(true)
    expect(saved().notes.size).toBe(1)
  })
  it('acknowledges a save only after persistence and rolls back on failure', async () => {
    const state = freshLocalState()
  state.notes.clear() // Backend tests use an empty vault; onboarding is tested separately.
    const backend = createDemoBackend({ state, local: true, persist: async () => { throw new Error('disk full') } })
    expect((await backend.fetch(request('notes', 'POST', { title: '不能假装保存' }))).status).toBe(507)
    expect(state.notes.size).toBe(0)
  })
  it('serializes parallel writes and preserves both notes', async () => {
    const { backend, saved } = local()
    await Promise.all([backend.fetch(request('notes', 'POST', { title: '甲' })), backend.fetch(request('notes', 'POST', { title: '乙' }))])
    expect(saved().notes.size).toBe(2)
  })
  it('keeps history and trash state across restart', async () => {
    const { backend, saved } = local()
    const note = await (await backend.fetch(request('notes', 'POST', { content: '原文' }))).json()
    await backend.fetch(request(`notes/${note.id}`, 'PATCH', { rev: note.rev, content: '修改' }))
    await backend.fetch(request(`notes/${note.id}`, 'DELETE'))
    const reopened = createDemoBackend({ state: saved(), local: true })
    expect((await (await reopened.fetch(request(`notes/${note.id}/versions`))).json()).versions).toHaveLength(1)
    expect((await (await reopened.fetch(request('notes?view=trash'))).json()).notes).toHaveLength(1)
  })
  it('round trips ZIP with attachment, fonts, flags, tags, settings and history', async () => {
    const { backend } = local()
    const form = new FormData()
    form.append('file', new File(['binary'], 'example.woff2', { type: 'font/woff2' }))
    const attachment = await (await backend.fetch(new Request(url('files'), { method: 'POST', body: form }))).json()
    expect(attachment.url).toBe(`/api/files/${attachment.id}`)
    const note = await (await backend.fetch(request('notes', 'POST', { title: '测试', content: `![附件](${attachment.url}) #测试`, isStarred: true }))).json()
    await backend.fetch(request(`notes/${note.id}`, 'PATCH', { rev: note.rev, content: `![附件](${attachment.url}) #测试\n修改`, isPinned: true }))
    await backend.fetch(request('settings', 'PUT', { appearance: { theme: 'dark', customFont: { fonts: [{ id: attachment.id, name: '字体' }], activeId: attachment.id, interface: true, prose: true, editor: true } } }))
    expect((await backend.fetch(request(`files/${attachment.id}`, 'DELETE'))).status).toBe(409)
    const archive = await (await backend.fetch(request('export?format=zip'))).blob()
    const restored = local()
    const restore = async () => {
      const form = new FormData(); form.append('file', new File([archive], 'backup.zip', { type: 'application/zip' }))
      const response = await restored.backend.fetch(new Request(url('import'), { method: 'POST', body: form }))
      const result = await response.json(); expect(result.warnings).toEqual([])
    }
    await restore()
    const state = restored.saved()
    expect(state.notes.size).toBe(1)
    expect(state.notes.get(note.id)?.isStarred).toBe(true)
    expect(state.notes.get(note.id)?.isPinned).toBe(true)
    expect(state.settings.appearance.theme).toBe('dark')
    expect(state.settings.appearance.customFont.activeId).toBe(attachment.id)
    expect(state.versions.get(note.id)).toHaveLength(1)
    expect(await state.attachments.get(attachment.id)!.file.text()).toBe('binary')
    await restore()
    expect(restored.saved().notes.size).toBe(1)
    expect(restored.saved().attachments.size).toBe(1)
  })
  it('refuses remote-only features rather than simulating success', async () => {
    const { backend } = local()
    for (const path of ['mcp', 'backup/targets', 'share', 'auth/logout']) expect((await backend.fetch(request(path))).status).toBe(403)
  })
})

it('imports the current web Markdown ZIP, including folders and font references', async () => {
  const { createZip } = await import('@shared/zip')
  const { backupCompleteBody } = await import('@shared/backup-format')
  const hash = async (data: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data.slice().buffer))].map((b) => b.toString(16).padStart(2, '0')).join('')
  const bytes = new TextEncoder().encode('font bytes')
  const digest = await hash(bytes)
  const path = `attachments/${digest}--my.woff2`
  const noteBytes = new TextEncoder().encode(`![字体](../../${path})\n#测试`)
  const manifest = {
    format: 'inkstone-markdown-backup', version: 3, appVersion: '0.8.0', createdAt: new Date().toISOString(), snapshot: '20261012-070000-000',
    notes: [{ id: '01j00000000000000000000007', path: 'notes/目录/笔记.md', title: '笔记', folder: ['目录'], attachmentHashes: [digest], state: 'notes', archived: false, bytes: noteBytes.length, sha256: await hash(noteBytes), createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null }],
    attachments: [{ path, filename: 'my.woff2', mime: 'font/woff2', size: bytes.length, sha256: digest, createdAt: Date.now() }],
    customFont: { fonts: [{ sha256: digest, name: '我的字体' }], activeHash: digest, interface: true, editor: true, prose: true },
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
  const archive = createZip([{ path: 'manifest.json', data: manifestBytes }, { path: 'COMPLETE', data: new TextEncoder().encode(backupCompleteBody(await hash(manifestBytes))) }, { path: 'notes/目录/笔记.md', data: noteBytes }, { path, data: bytes }])
  const { backend, saved } = local()
  const form = new FormData(); form.append('file', new File([archive.slice().buffer], 'web.zip'))
  const result = await (await backend.fetch(new Request(url('import'), { method: 'POST', body: form }))).json()
  expect(result.warnings).toEqual([])
  expect(saved().notes.size).toBe(1)
  expect(saved().folders.size).toBe(1)
  expect(saved().settings.appearance.customFont.activeId).toBe(digest.slice(0, 26))
  expect([...saved().notes.values()][0]!.content).toContain(`/api/files/${digest.slice(0, 26)}`)
})
