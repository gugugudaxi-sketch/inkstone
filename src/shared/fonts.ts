export interface CustomFontSettings {
  fonts: { id: string; name: string }[]
  activeId: string | null
  interface: boolean
  editor: boolean
  prose: boolean
}

export const MAX_CUSTOM_FONTS = 10
export const FONT_MIMES = new Set(['font/woff2', 'font/woff', 'font/ttf', 'font/otf'])
const FONT_ID = /^[0-9a-hjkmnp-tv-z]{26}$/

export function normalizeCustomFonts(value: unknown): CustomFontSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const fonts: CustomFontSettings['fonts'] = []
  for (const item of Array.isArray(raw.fonts) ? raw.fonts.slice(0, MAX_CUSTOM_FONTS) : []) {
    if (!item || typeof item !== 'object') continue
    if (typeof item.id !== 'string' || !FONT_ID.test(item.id) || fonts.some((f) => f.id === item.id)) continue
    if (typeof item.name !== 'string') continue
    const name = item.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120)
    if (name) fonts.push({ id: item.id, name })
  }
  return {
    fonts,
    activeId: typeof raw.activeId === 'string' && fonts.some((f) => f.id === raw.activeId) ? raw.activeId : null,
    interface: raw.interface === true,
    editor: raw.editor === true,
    prose: raw.prose !== false,
  }
}

// Identify binary font containers rather than trusting filenames or client MIME types.
export function detectFontMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const signature = view.getUint32(0)
  if (signature === 0x774f4646 || signature === 0x774f4632) {
    const header = signature === 0x774f4646 ? 44 : 48
    if (bytes.length < header || view.getUint32(8) !== bytes.length || !view.getUint16(12)) return null
    if (signature === 0x774f4646 && 44 + view.getUint16(12) * 20 > bytes.length) return null
    return signature === 0x774f4646 ? 'font/woff' : 'font/woff2'
  }
  if (signature !== 0x00010000 && signature !== 0x4f54544f) return null
  const count = view.getUint16(4)
  if (!count || 12 + count * 16 > bytes.length) return null
  for (let index = 0; index < count; index++) {
    const offset = view.getUint32(12 + index * 16 + 8)
    const length = view.getUint32(12 + index * 16 + 12)
    if (offset > bytes.length || length > bytes.length - offset) return null
  }
  return signature === 0x4f54544f ? 'font/otf' : 'font/ttf'
}

export interface CustomFontBackupSettings {
  fonts: { sha256: string; name: string }[]
  activeHash: string | null
  interface: boolean
  editor: boolean
  prose: boolean
}

export function fontMimeFromSignature(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null
  const signature = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
  return ({ [0x774f4646]: 'font/woff', [0x774f4632]: 'font/woff2', [0x00010000]: 'font/ttf', [0x4f54544f]: 'font/otf' } as Record<number, string>)[signature] ?? null
}
