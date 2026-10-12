import { backupCompletePath, completeManifestHash, parseMarkdownBackupManifest } from '@shared/backup-format'
import type { ExportBundle, Folder, Note } from '@shared/types'

async function hash(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

// Convert the web edition's verified Markdown ZIP into the local restore format.
export async function convertMarkdownBackup(entries: Array<{ path: string; data: Uint8Array }>): Promise<{ bundle: ExportBundle; files: Map<string, Uint8Array> }> {
  const source = new Map(entries.map((entry) => [entry.path.toLowerCase(), entry.data]))
  const manifests = entries.filter((entry) => entry.path.endsWith('manifest.json'))
  if (manifests.length !== 1) throw new Error('备份必须包含唯一的 manifest.json')
  const raw = manifests[0]!
  const manifest = parseMarkdownBackupManifest(JSON.parse(new TextDecoder().decode(raw.data)))
  if (!manifest) throw new Error('备份清单格式不正确')
  const complete = source.get(backupCompletePath(manifest.snapshot, manifest.version).toLowerCase())
  if (!complete || completeManifestHash(new TextDecoder().decode(complete)) !== await hash(raw.data)) throw new Error('备份缺少完成标记或清单校验失败')
  const files = new Map<string, Uint8Array>()
  const folders: Folder[] = []
  const folderIds = new Map<string, string>()
  const attachmentIds = new Map<string, string>()
  const attachmentByPath = new Map<string, string>()
  const attachments: ExportBundle['attachments'] = []
  for (const entry of manifest.attachments) {
    const data = source.get(entry.path.toLowerCase())
    if (!data || data.length !== entry.size || await hash(data) !== entry.sha256) throw new Error(`附件校验失败：${entry.filename}`)
    const id = entry.sha256.slice(0, 26)
    attachmentIds.set(entry.sha256, id)
    attachmentByPath.set(entry.path.toLowerCase(), id)
    const path = `attachments/${id}/${entry.filename.replace(/[\\/\u0000-\u001f]/g, '_')}`
    files.set(path.toLowerCase(), data)
    attachments.push({ id, noteId: null, filename: entry.filename, mime: entry.mime, size: entry.size, width: null, height: null, createdAt: entry.createdAt, sha256: entry.sha256, path })
  }
  const notes: Note[] = []
  for (const entry of manifest.notes) {
    const data = source.get(entry.path.toLowerCase())
    if (!data || data.length !== entry.bytes || await hash(data) !== entry.sha256) throw new Error(`笔记校验失败：${entry.title}`)
    let folderId: string | null = null
    let folderPath = ''
    for (const name of entry.folder) {
      folderPath += `/${name}`
      let id = folderIds.get(folderPath)
      if (!id) {
        id = (await hash(new TextEncoder().encode(folderPath))).slice(0, 26)
        folders.push({ id, name, parentId: folderId, icon: null, color: null, position: folders.length, createdAt: entry.createdAt, updatedAt: entry.updatedAt })
        folderIds.set(folderPath, id)
      }
      folderId = id
    }
    const resolve = (href: string): string => {
      try {
        const target = new URL(href, `https://backup.invalid/${entry.path}`)
        if (target.origin !== 'https://backup.invalid') return href
        const id = attachmentByPath.get(decodeURIComponent(target.pathname).slice(1).toLowerCase())
        return id ? `/api/files/${id}` : href
      } catch { return href }
    }
    const content = new TextDecoder().decode(data)
      .replace(/(\]\(\s*<?)([^\s)>]+)(>?[^)]*\))/g, (_full, before, href, after) => `${before}${resolve(href)}${after}`)
      .replace(/((?:src|href)=["'])([^"']+)(["'])/g, (_full, before, href, after) => `${before}${resolve(href)}${after}`)
    notes.push({ id: entry.id, title: entry.title, content, folderId, excerpt: '', tags: [], isPinned: false, isStarred: false, isArchived: entry.archived, deletedAt: entry.deletedAt, wordCount: 0, charCount: 0, rev: 1, position: entry.updatedAt, createdAt: entry.createdAt, updatedAt: entry.updatedAt })
  }
  const font = manifest.customFont
  const extra = font ? { settings: { customFont: { fonts: font.fonts.flatMap((item) => attachmentIds.has(item.sha256) ? [{ id: attachmentIds.get(item.sha256)!, name: item.name }] : []), activeId: font.activeHash ? attachmentIds.get(font.activeHash) ?? null : null, interface: font.interface, editor: font.editor, prose: font.prose } } } : {}
  return { bundle: { format: 'inkstone-export', version: 1, exportedAt: Date.now(), user: { login: 'local', name: '本地笔记' }, notes, folders, tags: [], attachments, ...extra }, files }
}
