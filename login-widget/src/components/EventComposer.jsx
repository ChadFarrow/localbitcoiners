/**
 * EventComposer — single-shot meetup publisher for localbitcoiners.com/newevent.
 *
 * Slim adaptation of mynostr's EventComposer (779 lines → ~300):
 *   - no multi-draft store, no JSON import/export, no load-from-Nostr
 *   - no LocationAutocomplete (plain text input)
 *   - native <input type="date|time"> instead of a custom TimePicker
 *   - kept: Blossom image upload + URL paste, kind 31922/31923 split,
 *     tz dropdown, hashtag parsing, sign-in gate, success panel
 *
 * After a successful publish, two optional side-effects can fire:
 *   - share-to-nostr  → kind 1 announcement quoting the event
 *   - boost-the-show  → opens the existing show-boost modal with the
 *     announcement prefilled into its boostagram message field
 *
 * Both checkboxes are independent. Failures of either side-effect are
 * swallowed so the underlying event-publish stays the source of truth.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { isSafeUrl } from '../lib/utils.js'
import { uploadToBlossom } from '../lib/blossom.js'
import {
  emptyEventForm,
  getUserTimezone,
  COMMON_TZIDS,
  buildTzDropdownList,
  formToPublishShape,
} from '../lib/eventForm.js'
import { publishCalendarEvent } from '../lib/eventPublish.js'
import {
  DEFAULT_KIND1_TEMPLATE,
  DEFAULT_BOOST_TEMPLATE,
  buildEventAnnouncementTemplate,
  publishEventAnnouncement,
  interpolateNaddr,
} from '../lib/eventAnnouncement.js'
import PasswordManagerHoneypot from './PasswordManagerHoneypot.jsx'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const inputCls =
  'w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 ' +
  'focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30'

const labelCls = 'block text-xs font-medium text-neutral-400 mb-1'

// Suppress password-manager autofill across the whole composer. None
// of these fields should ever be picked up by LastPass / 1Password /
// Bitwarden / Dashlane / browser autofill. The load-bearing trick is
// `type="search"` on the text inputs — every major password manager
// explicitly skips search inputs, where the data-attr hints alone
// were getting bypassed by their label-heuristic fallbacks. The
// browser-rendered clear-X button on search inputs is hidden in
// styles.css so the field still reads as a plain text input.
//
// Spellcheck / autocorrect are intentionally NOT disabled — the
// description and announcement textareas want normal text editing.
const NO_AUTOFILL = {
  autoComplete: 'off',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
}

export default function EventComposer({
  sessionUser,
  onRequestSignIn,
  onOpenShowBoostWithMessage,
}) {
  const [form, setForm] = useState(emptyEventForm)
  const [shareToNostr, setShareToNostr] = useState(false)
  const [shareText, setShareText] = useState(DEFAULT_KIND1_TEMPLATE)
  const [boostShow, setBoostShow] = useState(false)
  const [boostText, setBoostText] = useState(DEFAULT_BOOST_TEMPLATE)

  const [imageUploading, setImageUploading] = useState(false)
  const [imageError, setImageError] = useState('')
  const [error, setError] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(null) // {naddr, eventId, dTag, kind, pubkey}

  const fileInputRef = useRef(null)

  const updateForm = useCallback((patch) => {
    setError('')
    setForm(prev => ({ ...prev, ...patch }))
  }, [])

  const handleImageFile = useCallback(async (file) => {
    if (!file || imageUploading) return
    if (!file.type.startsWith('image/')) {
      setImageError('Pick an image file.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(`Image too large — max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB.`)
      return
    }
    setImageUploading(true)
    setImageError('')
    try {
      const url = await uploadToBlossom(file)
      updateForm({ image: url })
    } catch (e) {
      setImageError(e?.message || 'Image upload failed')
    } finally {
      setImageUploading(false)
    }
  }, [imageUploading, updateForm])

  const handlePublish = useCallback(async () => {
    setError('')
    if (!sessionUser?.pubkey) {
      onRequestSignIn?.()
      return
    }
    let lowered
    try {
      lowered = formToPublishShape(form)
    } catch (e) {
      setError(e?.message || 'Form is incomplete.')
      return
    }
    setPublishing(true)
    try {
      const result = await publishCalendarEvent(lowered)
      setPublished(result)

      // Side-effect 1: kind 1 announcement. Best-effort.
      if (shareToNostr && result?.naddr) {
        try {
          const tmpl = buildEventAnnouncementTemplate({
            text: shareText,
            naddr: result.naddr,
            kind: result.kind,
            pubkey: result.pubkey,
            dTag: result.dTag,
          })
          // Fire-and-forget — a slow signer/relay shouldn't pin the UI.
          publishEventAnnouncement(tmpl).catch(() => {})
        } catch {}
      }

      // Side-effect 2: open the show-boost modal with the announcement
      // prefilled. The boost modal handles the wallet/login gates and
      // its own silent failure UX.
      if (boostShow && result?.naddr && onOpenShowBoostWithMessage) {
        const prefilled = interpolateNaddr(boostText, result.naddr)
        onOpenShowBoostWithMessage(prefilled)
      }
    } catch (e) {
      setError(e?.message || 'Publish failed.')
    } finally {
      setPublishing(false)
    }
  }, [form, sessionUser, shareToNostr, shareText, boostShow, boostText, onRequestSignIn, onOpenShowBoostWithMessage])

  const resetForNewEvent = useCallback(() => {
    setForm(emptyEventForm())
    setShareToNostr(false)
    setShareText(DEFAULT_KIND1_TEMPLATE)
    setBoostShow(false)
    setBoostText(DEFAULT_BOOST_TEMPLATE)
    setError('')
    setImageError('')
    setPublished(null)
  }, [])

  // ── Sign-in gate ─────────────────────────────────────────────────────
  if (!sessionUser?.pubkey) {
    return (
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6 text-center">
        <p className="text-sm text-neutral-300 mb-4">
          Sign in with Nostr to post your meetup.
        </p>
        <button
          onClick={() => onRequestSignIn?.()}
          className="inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded bg-orange-500 hover:bg-orange-600 text-sm font-medium text-white transition-colors"
        >
          Sign in
        </button>
      </div>
    )
  }

  // ── Success panel ────────────────────────────────────────────────────
  if (published) {
    const manageUrl = sessionUser?.npub ? `https://mynostr.app/${sessionUser.npub}/events` : null
    return (
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-neutral-100 mb-2">Meetup posted</h2>
        <p className="text-sm text-neutral-400 mb-4">
          Your meetup is live on Nostr. Anyone with a Nostr client can find and RSVP to it.
        </p>
        <div className="bg-neutral-950 border border-neutral-800 rounded p-3 mb-4">
          <div className="text-xs text-neutral-500 mb-1">Event address (naddr)</div>
          <code className="text-xs text-neutral-300 break-all">{published.naddr}</code>
        </div>
        <div className="flex flex-wrap gap-2">
          {manageUrl && (
            <a
              href={manageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 py-2 px-3 rounded bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-200 transition-colors"
            >
              Manage your events
            </a>
          )}
          <button
            onClick={resetForNewEvent}
            className="inline-flex items-center gap-2 py-2 px-3 rounded bg-orange-500 hover:bg-orange-600 text-sm text-white transition-colors"
          >
            Post another meetup
          </button>
        </div>
      </div>
    )
  }

  // ── Composer body ────────────────────────────────────────────────────
  const userTz = getUserTimezone()
  const tzList = buildTzDropdownList(userTz)
  const manageUrl = sessionUser?.npub ? `https://mynostr.app/${sessionUser.npub}/events` : null

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5 sm:p-6 space-y-5 relative">
      <PasswordManagerHoneypot />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-base font-semibold text-neutral-100">
          List your meetup on Nostr
        </h2>
        {manageUrl && (
          <a
            href={manageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-orange-400 hover:text-orange-300 underline-offset-2 hover:underline whitespace-nowrap"
          >
            Manage your events ↗
          </a>
        )}
      </div>
      {/* Title */}
      <div>
        <label className={labelCls}>Title</label>
        <input
          type="search"
          value={form.title}
          onChange={e => updateForm({ title: e.target.value })}
          placeholder="e.g. Western Mass Bitcoin Meetup"
          className={inputCls}
          maxLength={140}
          {...NO_AUTOFILL}
        />
      </div>

      {/* Description */}
      <div>
        <label className={labelCls}>Description</label>
        <textarea
          value={form.description}
          onChange={e => updateForm({ description: e.target.value })}
          placeholder="What is this meetup about? Markdown OK."
          className={inputCls + ' min-h-[120px] resize-y leading-relaxed'}
          {...NO_AUTOFILL}
        />
      </div>

      {/* All-day toggle */}
      <label className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer">
        <input
          type="checkbox"
          checked={form.allDay}
          onChange={e => updateForm({ allDay: e.target.checked })}
          className="accent-orange-500"
        />
        <span>All-day event (no specific time)</span>
      </label>

      {/* Date / time */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Start date</label>
          <input
            type="date"
            value={form.startDate}
            onChange={e => updateForm({ startDate: e.target.value })}
            className={inputCls}
            {...NO_AUTOFILL}
          />
        </div>
        {!form.allDay && (
          <div>
            <label className={labelCls}>Start time</label>
            <input
              type="time"
              value={form.startTime}
              onChange={e => updateForm({ startTime: e.target.value })}
              className={inputCls}
              {...NO_AUTOFILL}
            />
          </div>
        )}
        <div>
          <label className={labelCls}>End date <span className="text-neutral-600">(optional)</span></label>
          <input
            type="date"
            value={form.endDate}
            onChange={e => updateForm({ endDate: e.target.value })}
            className={inputCls}
            {...NO_AUTOFILL}
          />
        </div>
        {!form.allDay && (
          <div>
            <label className={labelCls}>End time <span className="text-neutral-600">(optional)</span></label>
            <input
              type="time"
              value={form.endTime}
              onChange={e => updateForm({ endTime: e.target.value })}
              className={inputCls}
              {...NO_AUTOFILL}
            />
          </div>
        )}
      </div>

      {/* Timezone (only shown for time-based events) */}
      {!form.allDay && (
        <div>
          <label className={labelCls}>Timezone</label>
          <select
            value={form.tzid}
            onChange={e => updateForm({ tzid: e.target.value })}
            className={inputCls}
            {...NO_AUTOFILL}
          >
            {tzList.map(tz => (
              <option key={tz} value={tz}>
                {tz}{tz === userTz ? ' (your local time)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Location */}
      <div>
        <label className={labelCls}>Location</label>
        <input
          type="search"
          value={form.location}
          onChange={e => updateForm({ location: e.target.value })}
          placeholder="Venue, city, or 'Online'"
          className={inputCls}
          {...NO_AUTOFILL}
        />
      </div>

      {/* Image */}
      <div>
        <label className={labelCls}>Image <span className="text-neutral-600">(optional)</span></label>
        <div className="space-y-2">
          <input
            type="search"
            inputMode="url"
            value={form.image}
            onChange={e => updateForm({ image: e.target.value })}
            placeholder="https://… (or upload below)"
            className={inputCls}
            {...NO_AUTOFILL}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={imageUploading}
              className="text-xs text-orange-400 hover:text-orange-300 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {imageUploading ? 'Uploading…' : 'Upload from device (Blossom)'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) handleImageFile(f)
              }}
            />
          </div>
          {imageError && <p className="text-xs text-red-400">{imageError}</p>}
          {form.image && isSafeUrl(form.image) && (
            <img src={form.image} alt="" className="max-h-40 rounded border border-neutral-800" />
          )}
        </div>
      </div>

      {/* Hashtags */}
      <div>
        <label className={labelCls}>Hashtags <span className="text-neutral-600">(space or comma separated)</span></label>
        <input
          type="search"
          value={form.hashtags}
          onChange={e => updateForm({ hashtags: e.target.value })}
          placeholder="#meetup #localbitcoiners"
          className={inputCls}
          {...NO_AUTOFILL}
        />
      </div>

      {/* Share-to-Nostr checkbox + editable textarea */}
      <div className="border-t border-neutral-800 pt-5 space-y-3">
        <label className="flex items-start gap-2 text-sm text-neutral-200 cursor-pointer">
          <input
            type="checkbox"
            checked={shareToNostr}
            onChange={e => setShareToNostr(e.target.checked)}
            className="accent-orange-500 mt-0.5"
          />
          <span>
            Also share an announcement note on Nostr
            <span className="block text-xs text-neutral-500 mt-0.5">
              Posts a kind 1 note from your npub - event {'{naddr}'} will be included with your boost message
            </span>
          </span>
        </label>
        {shareToNostr && (
          <textarea
            value={shareText}
            onChange={e => setShareText(e.target.value)}
            className={inputCls + ' min-h-[90px] resize-y leading-relaxed'}
            {...NO_AUTOFILL}
          />
        )}
      </div>

      {/* Boost-the-show checkbox + editable textarea */}
      <div className="space-y-3">
        <label className="flex items-start gap-2 text-sm text-neutral-200 cursor-pointer">
          <input
            type="checkbox"
            checked={boostShow}
            onChange={e => setBoostShow(e.target.checked)}
            className="accent-orange-500 mt-0.5"
          />
          <span>
            Announce your meetup with a boost to the show
            <span className="block text-xs text-neutral-500 mt-0.5">
              Event {'{naddr}'} will be included with your boost message
            </span>
          </span>
        </label>
        {boostShow && (
          <textarea
            value={boostText}
            onChange={e => setBoostText(e.target.value)}
            className={inputCls + ' min-h-[80px] resize-y leading-relaxed'}
            {...NO_AUTOFILL}
          />
        )}
      </div>

      {/* Error + publish */}
      {error && (
        <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 rounded px-3 py-2">
          {error}
        </div>
      )}
      <button
        onClick={handlePublish}
        disabled={publishing}
        className="w-full inline-flex items-center justify-center gap-2 py-3 rounded bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
      >
        {publishing ? (
          <>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" aria-hidden="true" />
            Publishing…
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
              <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
            </svg>
            Publish Meetup
          </>
        )}
      </button>
    </div>
  )
}
