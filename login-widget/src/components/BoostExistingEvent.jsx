/**
 * BoostExistingEvent — secondary card on /newevent.
 *
 * For organizers whose meetup is already published on Nostr (e.g. via
 * Flockstr): paste the naddr, click Boost, and the existing show-boost
 * modal opens with `nostr:<naddr>` prefilled into the boostagram
 * message. No other text — the user can add their own commentary on
 * top in the modal's textarea before sending.
 */
import { useState } from 'react'
import { nip19 } from 'nostr-tools'
import { interpolateNaddr } from '../lib/eventAnnouncement.js'
import PasswordManagerHoneypot from './PasswordManagerHoneypot.jsx'

const inputCls =
  'w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 ' +
  'focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30'

const labelCls = 'block text-xs font-medium text-neutral-400 mb-1'

const NO_AUTOFILL = {
  autoComplete: 'off',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
}

export default function BoostExistingEvent({
  sessionUser,
  onRequestSignIn,
  onOpenShowBoostWithMessage,
}) {
  const [input, setInput] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const handleBoost = () => {
    setError('')
    const trimmed = String(input || '').trim().replace(/^nostr:/i, '')
    if (!trimmed) {
      setError('Paste your event’s naddr to boost.')
      return
    }
    try {
      const decoded = nip19.decode(trimmed)
      if (decoded.type !== 'naddr') {
        setError('That doesn’t look like an event address (naddr1…).')
        return
      }
    } catch {
      setError('Couldn’t decode that — paste an naddr1… string.')
      return
    }
    if (!sessionUser?.pubkey) {
      onRequestSignIn?.()
      return
    }
    // Substitute {naddr} placeholders in the (possibly edited) message
    // with the real naddr. Same helper the new-event composer uses for
    // its boost option, so the two flows have consistent behaviour.
    const prefilled = interpolateNaddr(message, trimmed)
    onOpenShowBoostWithMessage?.(prefilled)
  }

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5 sm:p-6 space-y-3 relative">
      <PasswordManagerHoneypot />
      <h2 className="text-base font-semibold text-neutral-100">
        Is your meetup already on Nostr? Boost it here!
      </h2>
      <div>
        <label className={labelCls}>Event address</label>
        <input
          type="search"
          value={input}
          onChange={e => { setError(''); setInput(e.target.value) }}
          placeholder="naddr1… (or nostr:naddr1…)"
          spellCheck="false"
          autoCapitalize="off"
          autoCorrect="off"
          {...NO_AUTOFILL}
          className={inputCls + ' font-mono text-xs'}
        />
      </div>
      <div>
        <label className={labelCls}>Boost message <span className="text-neutral-600">(editable)</span></label>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          className={inputCls + ' min-h-[90px] resize-y leading-relaxed'}
          {...NO_AUTOFILL}
        />
        <p className="text-xs text-neutral-500 mt-1">
          Event <code className="bg-neutral-800 px-1 py-0.5 rounded">{'{naddr}'}</code> will be included with your boost message
        </p>
      </div>
      {error && (
        <p className="text-sm text-red-400 bg-red-950/30 border border-red-900 rounded px-3 py-2">
          {error}
        </p>
      )}
      <button
        onClick={handleBoost}
        className="w-full inline-flex items-center justify-center gap-2 py-3 rounded bg-orange-500 hover:bg-orange-600 text-sm font-medium text-white transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
          <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
        </svg>
        Boost this meetup
      </button>
    </div>
  )
}
