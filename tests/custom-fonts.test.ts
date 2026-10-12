// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { beforeEach, afterEach, expect, it } from 'vitest'
import { SCHEMA_STATEMENTS } from '../src/worker/db/schema'
import { settingsRoutes } from '../src/worker/routes/settings'
import { transferRoutes } from '../src/worker/routes/transfer'
import { buildSnapshot } from '../src/worker/backup/snapshot'
import { errorResponse } from '../src/worker/lib/errors'
import { sha256Hex } from '../src/worker/lib/encoding'
import { mergeSettings } from '../src/shared/constants'
import { parseMarkdownBackupManifest } from '../src/shared/backup-format'
import type { AppBindings, Env } from '../src/worker/env'

let sqlite: DatabaseSync
let env: Env
let app: Hono<AppBindings>
const fontId = '00000000000000000000000004'
let bytes: Uint8Array

beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:')
  for (const sql of SCHEMA_STATEMENTS) sqlite.exec(sql)
  sqlite.prepare('INSERT INTO users (id,username,password_hash,login,created_at,last_seen_at) VALUES (?,?,?,?,?,?)')
    .run('user', 'alice', 'unused', 'alice', 1, 1)
  const prepare = (sql: string, values: unknown[] = []) => {
    const args = Object.fromEntries(values.map((value, index) => [String(index + 1), value]))
    return {
      bind: (...bound: unknown[]) => prepare(sql, bound),
      first: async () => sqlite.prepare(sql).get(args as never) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(args as never) }),
      run: async () => { const result = sqlite.prepare(sql).run(args as never); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) }, success: true } },
    }
  }
  const objects = new Map<string, ArrayBuffer>()
  env = {
    DB: { prepare, batch: async (statements: { run: () => Promise<unknown> }[]) => Promise.all(statements.map((statement) => statement.run())) },
    FILES_KV: {
      get: async (key: string) => objects.get(key) ?? null,
      put: async (key: string, value: Uint8Array) => { objects.set(key, value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer) },
      delete: async (key: string) => { objects.delete(key) },
    },
  } as unknown as Env
  bytes = new Uint8Array(48)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x774f4632); view.setUint32(8, 48); view.setUint16(12, 1)
  sqlite.prepare('INSERT INTO attachments (id,user_id,filename,mime,size,sha256,storage,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(fontId, 'user', 'Example.woff2', 'font/woff2', bytes.length, await sha256Hex(bytes), 'kv', 1)
  app = new Hono<AppBindings>()
  app.onError((error, c) => errorResponse(c, error))
  app.use('*', async (c, next) => {
    const row = sqlite.prepare('SELECT * FROM users WHERE id = ?').get('user') as { settings: string }
    c.set('userId', 'user')
    c.set('user', { id: 'user', role: 'owner', settingsRaw: row.settings } as AppBindings['Variables']['user'])
    c.set('database', { ftsEnabled: false } as AppBindings['Variables']['database'])
    await next()
  })
  app.route('/settings', settingsRoutes)
  app.route('/transfer', transferRoutes)
})
afterEach(() => sqlite.close())

function request(path: string, init: RequestInit) {
  return app.request(`https://inkstone.test${path}`, init, env, { waitUntil: () => {}, passThroughOnException: () => {} })
}

it('rejects another user’s font and accepts an owned font in saved settings', async () => {
  const preferences = { fonts: [{ id: fontId, name: 'Example.woff2' }], activeId: fontId, prose: true }
  sqlite.prepare('UPDATE attachments SET user_id = ? WHERE id = ?').run('other', fontId)
  const init = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appearance: { customFont: preferences } }) }
  expect((await request('/settings', init)).status).toBe(400)
  sqlite.prepare('UPDATE attachments SET user_id = ? WHERE id = ?').run('user', fontId)
  const response = await request('/settings', init)
  expect(response.status).toBe(200)
  expect((await response.json() as { appearance: { customFont: { activeId: string } } }).appearance.customFont.activeId).toBe(fontId)
})

it('backs up an unreferenced font and restores its settings against a new attachment ID', async () => {
  const settings = mergeSettings({ appearance: { customFont: { fonts: [{ id: fontId, name: 'Example.woff2' }], activeId: fontId, interface: true, editor: false, prose: true } } })
  sqlite.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(settings), 'user')
  const snapshot = await buildSnapshot(env, 'user')
  const raw = await new Response(await snapshot.manifestFile.open()).json()
  const manifest = parseMarkdownBackupManifest(raw)!
  expect(manifest.customFont?.activeHash).toBe(await sha256Hex(bytes))
  expect(manifest.attachments).toHaveLength(1)
  expect(snapshot.attachmentCount).toBe(1)
  expect(parseMarkdownBackupManifest({ ...raw, customFont: { ...manifest.customFont, activeHash: 'f'.repeat(64) } })).toBeNull()
  sqlite.prepare('UPDATE users SET settings = ? WHERE id = ?').run('{}', 'user')
  sqlite.exec('DELETE FROM attachments')
  const form = new FormData()
  form.append('backupManifest', JSON.stringify(manifest))
  form.append('backupPaths', JSON.stringify([manifest.attachments[0]!.path]))
  form.append('file', new File([bytes as Uint8Array<ArrayBuffer>], 'Example.woff2'))
  const response = await request('/transfer/import', { method: 'POST', body: form })
  expect(response.status, await response.clone().text()).toBe(200)
  const restored = sqlite.prepare('SELECT settings FROM users WHERE id = ?').get('user') as { settings: string }
  const preferences = mergeSettings(JSON.parse(restored.settings)).appearance.customFont
  expect(preferences.fonts).toHaveLength(1)
  expect(preferences.activeId).not.toBe(fontId)
  expect(preferences.activeId).toBe(preferences.fonts[0]!.id)
  expect(preferences.interface).toBe(true)
  expect(preferences.editor).toBe(false)
})
