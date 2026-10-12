import { createDemoState, type DemoState } from '../demo/state'

export const LOCAL_DB_NAME = 'inkstone-local-vault'
const STORE = 'vault'
const KEY = 'state'
interface Snapshot {
  schema: 1
  metadata: Omit<DemoState, 'attachments'>
  attachments: Array<{ id: string; meta: DemoState['attachments'] extends Map<string, infer T> ? T extends { meta: infer M } ? M : never : never; blob: Blob }>
}

export function freshLocalState(): DemoState {
  const state = createDemoState()
  state.authenticated = true
  state.password = ''
  state.user = { ...state.user, name: '我的本地笔记', login: 'local', username: 'local' }
  state.notes.clear()
  state.tagIds.clear()
  state.tagColors.clear()
  state.shares.clear()
  state.settings.sync.realtime = false
  return state
}

function openVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onblocked = () => reject(new Error('本地数据库被旧窗口占用，请关闭旧窗口后重新打开'))
  })
}

export async function saveLocalState(state: DemoState): Promise<void> {
  const { attachments, ...metadata } = state
  const snapshot: Snapshot = {
    schema: 1,
    metadata,
    attachments: [...attachments].map(([id, item]) => ({ id, meta: item.meta, blob: item.file })),
  }
  await persistNativeAttachments(state)
  const db = await openVault()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite', { durability: 'strict' })
      tx.objectStore(STORE).put(snapshot, KEY)
      // A write is acknowledged only after the transaction commits.
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? new Error('本地存储事务失败'))
      tx.onerror = () => reject(tx.error)
    })
  } finally { db.close() }
  window.InkstoneNative?.pruneAttachments(JSON.stringify([...state.attachments.keys()]))
}

export async function loadLocalState(): Promise<DemoState> {
  const db = await openVault()
  let snapshot: Snapshot | undefined
  try {
    snapshot = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const request = tx.objectStore(STORE).get(KEY)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
  if (!snapshot) {
    const state = freshLocalState()
    await saveLocalState(state)
    return state
  }
  // Never silently reset an unreadable vault.
  if (snapshot.schema !== 1 || !(snapshot.metadata.notes instanceof Map)) {
    throw new Error('无法读取此版本的本地数据库，请使用兼容版本恢复，数据未被删除。')
  }
  const state: DemoState = { ...snapshot.metadata, authenticated: true, attachments: new Map() }
  for (const { id, meta, blob } of snapshot.attachments) {
    const file = new File([blob], meta.filename, { type: meta.mime })
    const url = `/api/files/${id}`
    state.attachments.set(id, { meta: { ...meta, url }, file })
    // Blob URLs belong to one WebView lifetime; rebuild them without altering stable IDs.
    for (const note of state.notes.values()) note.content = note.content.replaceAll(meta.url, url)
    for (const versions of state.versions.values()) {
      for (const version of versions) version.content = version.content.replaceAll(meta.url, url)
    }
  }
  return state
}

async function persistNativeAttachments(state: DemoState): Promise<void> {
  const bridge = window.InkstoneNative
  if (!bridge) return
  for (const [id, { file, meta }] of state.attachments) {
    if (bridge.hasAttachment(id, file.size)) continue
    if (!bridge.beginAttachment(id, meta.mime)) throw new Error('附件存储不可用')
    const bytes = new Uint8Array(await file.arrayBuffer())
    for (let offset = 0; offset < bytes.length; offset += 48 * 1024) {
      let binary = ''
      for (const byte of bytes.subarray(offset, offset + 48 * 1024)) binary += String.fromCharCode(byte)
      if (!bridge.appendAttachment(btoa(binary))) throw new Error('附件写入失败')
    }
    if (!bridge.finishAttachment()) throw new Error('附件写入失败')
  }
}
