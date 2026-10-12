import { describe, expect, it } from 'vitest'
import { detectFontMime, normalizeCustomFonts } from '../src/shared/fonts'
import { safeAttachmentMime } from '../src/worker/lib/image'

describe('font upload validation', () => {
  it.each([[0x774f4646, 'font/woff', 64], [0x774f4632, 'font/woff2', 48], [0x00010000, 'font/ttf', 28], [0x4f54544f, 'font/otf', 28]] as const)
    ('recognizes binary container %s even with a missing MIME', (signature, mime, size) => {
      const bytes = new Uint8Array(size)
      const view = new DataView(bytes.buffer)
      view.setUint32(0, signature)
      if (mime.includes('woff')) { view.setUint32(8, size); view.setUint16(12, 1) }
      else view.setUint16(4, 1)
      expect(detectFontMime(bytes)).toBe(mime)
      expect(safeAttachmentMime(bytes, '')).toBe(mime)
      expect(detectFontMime(bytes.subarray(0, size - 1))).toBeNull()
    })
  it('does not trust a font extension or reported MIME for HTML or truncated headers', () => {
    expect(detectFontMime(new TextEncoder().encode('<script>alert(1)</script>'))).toBeNull()
    expect(safeAttachmentMime(new TextEncoder().encode('<script>alert(1)</script>'), 'font/woff2')).toBe('application/octet-stream')
    expect(detectFontMime(new Uint8Array([0, 1, 0, 0]))).toBeNull()
  })
  it('rejects an OpenType table whose byte range is outside the uploaded file', () => {
    const bytes = new Uint8Array(28)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 0x00010000); view.setUint16(4, 1); view.setUint32(20, 1000)
    expect(detectFontMime(bytes)).toBeNull()
  })
  it('drops arbitrary URLs, duplicate IDs and active selections outside the library', () => {
    const id = '00000000000000000000000001'
    const result = normalizeCustomFonts({ fonts: [{ id, name: 'My font' }, { id, name: 'duplicate' }, { id: 'https://other.example/font', name: 'external' }], activeId: 'other' })
    expect(result.fonts).toEqual([{ id, name: 'My font' }])
    expect(result.activeId).toBeNull()
  })
})
