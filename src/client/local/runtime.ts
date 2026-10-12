import { createDemoBackend } from '../demo/backend'
import { loadLocalState, saveLocalState } from './storage'
import { useNotes } from '../store/notes'

interface NativeBridge {
  hasAttachment(id: string, size: number): boolean
  beginAttachment(id: string, mime: string): boolean
  appendAttachment(base64: string): boolean
  finishAttachment(): boolean
  beginDownload(name: string, mime: string): boolean
  appendDownload(base64: string): boolean
  finishDownload(): void
  pruneAttachments(ids: string): void
  printDocument(): void
  background(): void
}
declare global {
  interface Window {
    InkstoneNative?: NativeBridge
    inkstoneNativeBack?: () => void
    inkstoneDownloadResult?: (error: string | null) => void
  }
}
let downloadActive = false
export async function saveNativeBlob(blob: Blob, filename: string): Promise<void> {
  const bridge = window.InkstoneNative
  if (!bridge) throw new Error('此功能需要 Android 本地应用')
  if (downloadActive) throw new Error('请先完成当前文件保存')
  downloadActive = true
  try {
    if (!bridge.beginDownload(filename, blob.type || 'application/octet-stream')) throw new Error('无法准备备份文件')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    for (let offset = 0; offset < bytes.length; offset += 48 * 1024) {
      let binary = ''
      for (const byte of bytes.subarray(offset, offset + 48 * 1024)) binary += String.fromCharCode(byte)
      if (!bridge.appendDownload(btoa(binary))) throw new Error('备份文件写入失败，请检查剩余空间')
    }
    await new Promise<void>((resolve, reject) => {
      window.inkstoneDownloadResult = (error) => {
        delete window.inkstoneDownloadResult
        error ? reject(new Error(error)) : resolve()
      }
      bridge.finishDownload()
    })
  } finally { downloadActive = false }
}

export async function installLocalRuntime(): Promise<void> {
  const state = await loadLocalState()
  const backend = createDemoBackend({ state, local: true, persist: saveLocalState })
  const originalFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = (input, init) => {
    const request = input instanceof Request ? new Request(input, init) : new Request(new URL(String(input), location.href), init)
    const url = new URL(request.url)
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) return backend.fetch(request)
    if (url.origin === location.origin || ['blob:', 'data:'].includes(url.protocol)) return originalFetch(input, init)
    return Promise.reject(new Error('本地版不连接远程服务器'))
  }
  if (window.InkstoneNative) window.print = () => window.InkstoneNative!.printDocument()
  window.inkstoneNativeBack = () => {
    const depth = history.state?.inkstoneMobileBack?.depth ?? 0
    if (depth > 0) history.back()
    else void useNotes.getState().flush({ immediate: true }).then(() => window.InkstoneNative?.background())
  }
  window.addEventListener('inkstone-local-pause', () => { void useNotes.getState().flush({ immediate: true }) })
  document.addEventListener('click', (event) => {
    const anchor = (event.target as Element | null)?.closest('a[download]') as HTMLAnchorElement | null
    if (!anchor || !window.InkstoneNative) return
    event.preventDefault()
    void fetch(anchor.href).then((response) => response.blob()).then((blob) => saveNativeBlob(blob, anchor.download || 'inkstone-export')).catch((error) => {
      useNotes.getState() // Keep failure visible, never silently claim a successful export.
      alert(error instanceof Error ? error.message : String(error))
    })
  }, true)
  await navigator.storage?.persist?.().catch(() => false)
}
