import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/inter.css'
import './styles/app.css'
import { LOCALE_STORAGE_KEY, UI_STORAGE_KEY } from './lib/runtime'
import { installViewportSizing } from './lib/viewport'

installViewportSizing()

async function start(): Promise<void> {
  if (import.meta.env.MODE === 'demo') {
    localStorage.removeItem(UI_STORAGE_KEY)
    localStorage.removeItem(LOCALE_STORAGE_KEY)
    const { installDemoRuntime } = await import('./demo/runtime')
    await installDemoRuntime()
  }

  if (import.meta.env.MODE === 'offline') {
    const { installLocalRuntime } = await import('./local/runtime')
    await installLocalRuntime()
  }

  const [{ App }, i18n] = await Promise.all([import('./App'), import('./lib/i18n')])
  await i18n.initI18n()
  const container = document.getElementById('root')
  if (!container) throw new Error(i18n.t("app.missing_root_mount_point"))
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start().catch((error) => {
  const root = document.getElementById('root')
  if (root) {
    root.replaceChildren()
    const message = document.createElement('p')
    message.style.cssText = 'padding:32px;white-space:pre-wrap'
    message.textContent = `启动失败，已有数据未被删除。\n${error instanceof Error ? error.message : String(error)}\n请关闭应用后重试，不要清除应用数据。`
    root.append(message)
  }
  document.getElementById('boot-screen')?.remove()
})
