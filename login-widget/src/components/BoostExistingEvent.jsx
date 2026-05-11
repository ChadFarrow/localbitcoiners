/**
 * BoostExistingEvent — secondary card on /newevent.
 *
 * For organizers whose meetup is already published on Nostr (e.g. via
 * Flockstr): paste the naddr, optionally tweak the boost message, and
 * the existing show-boost modal opens with the assembled boostagram
 * message prefilled. The naddr is substituted in (or appended) via the
 * shared interpolateNaddr helper.
 *
 * Visually styled with the LB cream-card design system; see styles.css.
 */
import { useState } from 'react'
import { nip19 } from 'nostr-tools'
import { interpolateNaddr } from '../lib/eventAnnouncement.js'
import PasswordManagerHoneypot from './PasswordManagerHoneypot.jsx'

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
    <div className="lb-card relative space-y-3">
      <PasswordManagerHoneypot />
      <h2 className="lb-card-heading">
        Is your meetup already on Nostr? Boost it here!
      </h2>
      <div>
        <label className="lb-label" style={{ textTransform: 'none', letterSpacing: 0 }}>
          Calendar addressable event ID (naddr1) on nostr
        </label>
        <input
          type="search"
          value={input}
          onChange={e => { setError(''); setInput(e.target.value) }}
          placeholder="naddr1… (or nostr:naddr1…)"
          spellCheck="false"
          autoCapitalize="off"
          autoCorrect="off"
          {...NO_AUTOFILL}
          className="lb-input"
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.78rem' }}
        />
      </div>
      <div>
        <label className="lb-label">
          Boost message <span style={{ color: 'var(--muted)', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>(editable)</span>
        </label>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          className="lb-input"
          style={{ minHeight: '90px', resize: 'vertical', lineHeight: 1.55 }}
          {...NO_AUTOFILL}
        />
        <p style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '0.35rem' }}>
          Event{' '}
          <code style={{ background: 'var(--white)', padding: '0.05rem 0.3rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
            {'{naddr}'}
          </code>{' '}
          will be included with your boost message
        </p>
      </div>
      {error && <div className="lb-error">{error}</div>}
      <button onClick={handleBoost} className="lb-btn lb-btn-primary" style={{ width: '100%', padding: '0.85rem 1.15rem', fontSize: '1rem' }}>
        <svg viewBox="0 0 24 24" fill="currentColor" className="lb-btn-publish-bolt" aria-hidden="true">
          <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
        </svg>
        Boost this meetup
      </button>
    </div>
  )
}
