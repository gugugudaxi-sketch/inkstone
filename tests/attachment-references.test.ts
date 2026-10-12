// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { collectAttachmentReferences } from '../src/worker/attachments/references'

const currentId = '00000000000000000000000001'
const historicalId = '00000000000000000000000002'
const otherUserId = '00000000000000000000000003'
let sqlite: DatabaseSync
let db: D1Database

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, settings TEXT);
    CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT, content TEXT);
    CREATE TABLE note_versions (id TEXT PRIMARY KEY, user_id TEXT, content TEXT);
  `)
  sqlite.prepare('INSERT INTO notes VALUES (?, ?, ?)')
    .run('note', 'user', `![current](/api/files/${currentId})`)
  sqlite.prepare('INSERT INTO note_versions VALUES (?, ?, ?)')
    .run('version', 'user', `![old](/api/files/${historicalId})`)
  sqlite.prepare('INSERT INTO note_versions VALUES (?, ?, ?)')
    .run('other-version', 'other-user', `![other](/api/files/${otherUserId})`)
  db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              const args = Object.fromEntries(values.map((value, i) => [String(i + 1), value]))
              return sqlite.prepare(sql).get(args as never) ?? null
            },
            async all() {
              const args = Object.fromEntries(values.map((value, i) => [String(i + 1), value]))
              return { results: sqlite.prepare(sql).all(args as never) }
            },
          }
        },
      }
    },
  } as unknown as D1Database
})

afterEach(() => sqlite.close())

it('protects attachments referenced only by retained versions and isolates users', async () => {
  const references = await collectAttachmentReferences(db, 'user')
  expect([...references.keys()].sort()).toEqual([currentId, historicalId])
  expect(references.has(otherUserId)).toBe(false)
})

it('finds historical references beyond the first page and filters candidate IDs', async () => {
  const insert = sqlite.prepare('INSERT INTO note_versions VALUES (?, ?, ?)')
  for (let i = 0; i < 25; i++) insert.run(`a${String(i).padStart(2, '0')}`, 'user', 'plain text')
  const references = await collectAttachmentReferences(db, 'user', new Set([historicalId, otherUserId]))
  expect([...references.keys()]).toEqual([historicalId])
  sqlite.prepare('DELETE FROM note_versions WHERE user_id = ?').run('user')
  expect((await collectAttachmentReferences(db, 'user')).has(historicalId)).toBe(false)
})

it('protects registered fonts even without note references and releases them when removed', async () => {
  const fontId = '00000000000000000000000004'
  sqlite.prepare('INSERT INTO users VALUES (?, ?)').run('user', JSON.stringify({
    appearance: { customFont: { fonts: [{ id: fontId, name: 'Private font' }], activeId: null } },
  }))
  expect((await collectAttachmentReferences(db, 'user')).get(fontId)).toBe(1)
  expect((await collectAttachmentReferences(db, 'other-user')).has(fontId)).toBe(false)
  sqlite.prepare('UPDATE users SET settings = ? WHERE id = ?').run('{}', 'user')
  expect((await collectAttachmentReferences(db, 'user')).has(fontId)).toBe(false)
})
