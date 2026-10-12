import { useRef, useState } from 'react'
import { detectFontMime, MAX_CUSTOM_FONTS, type CustomFontSettings as Preferences } from '@shared/fonts'
import { LIMITS } from '@shared/constants'
import { Button } from '../../components/primitives'
import { useSession } from '../../store/session'
import { useCustomFontStatus } from '../../lib/custom-font'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'

export function CustomFontSettings() {
  const preferences = useSession((state) => state.settings.appearance.customFont)
  const update = useSession((state) => state.updateSettings)
  const status = useCustomFontStatus((state) => state.status)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const change = (patch: Partial<Preferences>) => {
    const current = useSession.getState().settings.appearance.customFont
    update({ appearance: { customFont: { ...current, ...patch } } })
  }
  async function upload(file: File) {
    setBusy(true)
    setError('')
    const userId = useSession.getState().user?.id
    try {
      if (!/\.(woff2?|ttf|otf)$/i.test(file.name) || file.size > LIMITS.attachmentMaxBytes) throw new Error(t('fonts.invalid_file'))
      const bytes = await file.arrayBuffer()
      if (!detectFontMime(new Uint8Array(bytes))) throw new Error(t('fonts.invalid_file'))
      if (typeof FontFace === 'undefined') throw new Error(t('fonts.unsupported'))
      try { await new FontFace('InkstoneUploadCheck', bytes).load() }
      catch { throw new Error(t('fonts.invalid_file')) }
      const current = useSession.getState().settings.appearance.customFont
      if (current.fonts.length >= MAX_CUSTOM_FONTS) throw new Error(t('fonts.limit'))
      const attachment = await api.files.upload(file)
      if (useSession.getState().user?.id !== userId) return
      const latest = useSession.getState().settings.appearance.customFont
      change({ fonts: [...latest.fonts, { id: attachment.id, name: file.name }], activeId: attachment.id })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('fonts.upload_failed'))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return <section className="space-y-3">
    <h3 className="text-[12px] font-semibold">{t('fonts.title')}</h3>
    <p className="text-[12px] text-[var(--text-secondary)]">{t('fonts.hint')}</p>
    <input ref={input} type="file" accept=".woff2,.woff,.ttf,.otf" className="hidden" aria-label={t('fonts.upload')}
      onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void upload(file) }} />
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || preferences.fonts.length >= MAX_CUSTOM_FONTS} onClick={() => input.current?.click()}>
        {busy ? t('fonts.uploading') : t('fonts.upload')}
      </Button>
      <Button disabled={busy || !preferences.activeId} onClick={() => change({ activeId: null })}>{t('fonts.reset')}</Button>
    </div>
    <label className="block text-[12px]">
      <span className="mb-1 block">{t('fonts.choose')}</span>
      <select className="w-full min-w-0 rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-2 text-[14px]"
        value={preferences.activeId ?? ''} disabled={busy} onChange={(event) => change({ activeId: event.currentTarget.value || null })}>
        <option value="">{t('fonts.default')}</option>
        {preferences.fonts.map((font) => <option key={font.id} value={font.id}>{font.name}</option>)}
      </select>
    </label>
    <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-[12px]">
      <legend className="mb-2">{t('fonts.apply_to')}</legend>
      {(['interface', 'editor', 'prose'] as const).map((scope) => <label key={scope} className="flex items-center gap-2">
        <input type="checkbox" checked={preferences[scope]} disabled={busy} onChange={(event) => change({ [scope]: event.currentTarget.checked })} />
        {t(`fonts.${scope}`)}
      </label>)}
    </fieldset>
    {preferences.activeId && <>
      <p className="text-[12px] text-[var(--text-secondary)]" role="status">
        {status === 'loading' ? t('fonts.loading') : status === 'error' ? t('fonts.load_failed') : status === 'ready' ? t('fonts.ready') : ''}
      </p>
      <p className="rounded-lg bg-[var(--bg-base)] p-3 text-[18px]" style={{ fontFamily: 'var(--custom-font, var(--font-ui))' }}>
        {t('fonts.sample')}
      </p>
      <Button disabled={busy} onClick={() => change({ fonts: preferences.fonts.filter((font) => font.id !== preferences.activeId), activeId: null })}>
        {t('fonts.remove')}
      </Button>
    </>}
    {error && <p role="alert" className="break-words text-[12px] text-[var(--danger)]">{error}</p>}
  </section>
}
