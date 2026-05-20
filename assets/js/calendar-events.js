/* Shared NIP-52 calendar-event helpers.
 *
 * Parsing, timezone-aware formatting, relay fetch, sort helpers, and card
 * rendering for kind 31922 (date-based) and 31923 (time-based) calendar
 * events. Used by the boost-thread renderer (boosts-thread.js — calendar
 * events embedded inside boost notes) and the Meetups page (meetups.js).
 *
 * Vendored nostr-tools — same bundle the rest of the site uses.
 */
import { SimplePool, verifyEvent } from '/assets/widgets/nostr-tools.js'

export const KIND_DATE_EVENT = 31922
export const KIND_TIME_EVENT = 31923

// Time-based events with no explicit end stay "upcoming" for this long
// past their start, so a meetup in progress doesn't immediately drop
// into the past bucket.
const DEFAULT_EVENT_DURATION_MS = 3 * 60 * 60 * 1000

// ── Tag access + parsing ─────────────────────────────────────────────
function calendarTagValue(ev, name) {
  if (!Array.isArray(ev?.tags)) return ''
  for (const t of ev.tags) {
    if (Array.isArray(t) && t[0] === name && typeof t[1] === 'string') return t[1]
  }
  return ''
}

function sanitizeTzid(raw) {
  const tz = String(raw || '').trim()
  if (!tz) return ''
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz } catch { return '' }
}

export function parseCalendarEvent(ev) {
  if (!ev || (ev.kind !== KIND_DATE_EVENT && ev.kind !== KIND_TIME_EVENT)) return null
  const dTag = calendarTagValue(ev, 'd')
  if (!dTag) return null
  const title = calendarTagValue(ev, 'title')
  if (!title) return null
  const startRaw = calendarTagValue(ev, 'start')
  if (!startRaw) return null
  const isDateBased = ev.kind === KIND_DATE_EVENT
  const endRaw = calendarTagValue(ev, 'end')
  return {
    id: ev.id || '',
    pubkey: ev.pubkey || '',
    kind: ev.kind,
    dTag,
    title,
    summary:  calendarTagValue(ev, 'summary'),
    location: calendarTagValue(ev, 'location'),
    isDateBased,
    start: startRaw,
    end:   endRaw,
    startTzid: isDateBased ? '' : sanitizeTzid(calendarTagValue(ev, 'start_tzid')),
  }
}

// ── Timezone-aware formatting ────────────────────────────────────────
export function formatEventWhen(parsed) {
  if (!parsed) return ''
  if (parsed.isDateBased) {
    const startMs = ymdToMs(parsed.start)
    if (!Number.isFinite(startMs)) return parsed.start || ''
    const fmt = new Intl.DateTimeFormat(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      year: yearOpt(startMs),
      timeZone: 'UTC',
    })
    const startStr = fmt.format(new Date(startMs))
    if (parsed.end) {
      const endMs = ymdToMs(parsed.end)
      if (Number.isFinite(endMs) && endMs > startMs) {
        return `${startStr} – ${fmt.format(new Date(endMs))}`
      }
    }
    return startStr
  }
  const startSec = parseInt(parsed.start, 10)
  if (!Number.isFinite(startSec)) return parsed.start || ''
  const tz = parsed.startTzid || undefined
  const dtOpts = {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    timeZone: tz,
    timeZoneName: 'short',
    year: yearOpt(startSec * 1000),
  }
  const fmt = new Intl.DateTimeFormat(undefined, dtOpts)
  const startStr = fmt.format(new Date(startSec * 1000))
  if (parsed.end) {
    const endSec = parseInt(parsed.end, 10)
    if (Number.isFinite(endSec) && endSec > startSec) {
      const sameDay = sameYmdInTz(startSec * 1000, endSec * 1000, tz)
      const endFmt = sameDay
        ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short' })
        : fmt
      return `${startStr} – ${endFmt.format(new Date(endSec * 1000))}`
    }
  }
  return startStr
}

function ymdToMs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim())
  if (!m) return NaN
  return Date.UTC(+m[1], +m[2] - 1, +m[3])
}

function yearOpt(ms) {
  return new Date(ms).getUTCFullYear() === new Date().getUTCFullYear() ? undefined : 'numeric'
}

function sameYmdInTz(aMs, bMs, tz) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
    })
    return fmt.format(new Date(aMs)) === fmt.format(new Date(bMs))
  } catch { return false }
}

// ── Sort + bucket helpers ────────────────────────────────────────────
// Epoch ms for a parsed event's start — NaN if the start can't be read.
export function eventStartMs(parsed) {
  if (!parsed) return NaN
  if (parsed.isDateBased) return ymdToMs(parsed.start)
  const sec = parseInt(parsed.start, 10)
  return Number.isFinite(sec) ? sec * 1000 : NaN
}

// Epoch ms for when a parsed event is over — used to bucket upcoming vs
// past. Date-based events run through the end of their final day (UTC);
// time-based events without an end get a default duration.
export function eventEndMs(parsed) {
  if (!parsed) return NaN
  if (parsed.isDateBased) {
    const ms = ymdToMs(parsed.end || parsed.start)
    return Number.isFinite(ms) ? ms + 86400000 : NaN
  }
  const startSec = parseInt(parsed.start, 10)
  if (!Number.isFinite(startSec)) return NaN
  const endSec = parsed.end ? parseInt(parsed.end, 10) : NaN
  if (Number.isFinite(endSec) && endSec > startSec) return endSec * 1000
  return startSec * 1000 + DEFAULT_EVENT_DURATION_MS
}

// ── Relay fetch (untrusted source — verify everything) ───────────────
export async function fetchCalendarEventsFromRelays(coords, relays) {
  if (!coords.length) return new Map()
  const out = new Map()
  const byKind = new Map()
  for (const coord of coords) {
    const [k, pk, d] = String(coord).split(':')
    const kindNum = parseInt(k, 10)
    if ((kindNum !== KIND_DATE_EVENT && kindNum !== KIND_TIME_EVENT) || !/^[0-9a-f]{64}$/i.test(pk || '') || !d) continue
    if (!byKind.has(kindNum)) byKind.set(kindNum, { authors: new Set(), dTags: new Set() })
    const bucket = byKind.get(kindNum)
    bucket.authors.add(pk)
    bucket.dTags.add(d)
  }
  if (!byKind.size) return out

  const pool = new SimplePool()
  try {
    const queries = []
    for (const [kindNum, { authors, dTags }] of byKind) {
      queries.push(
        pool.querySync(relays, {
          kinds:   [kindNum],
          authors: [...authors],
          '#d':    [...dTags],
          limit:   200,
        }).catch(() => [])
      )
    }
    const results = await Promise.all(queries)
    const wanted = new Set(coords.map(String))
    for (const evs of results) {
      for (const ev of evs) {
        if (!ev || !verifyEvent(ev)) continue
        const parsed = parseCalendarEvent(ev)
        if (!parsed) continue
        const coord = `${parsed.kind}:${parsed.pubkey}:${parsed.dTag}`
        if (!wanted.has(coord)) continue
        const prev = out.get(coord)
        if (!prev || (ev.created_at || 0) > (prev.createdAt || -1)) {
          parsed.createdAt = ev.created_at || 0
          out.set(coord, parsed)
        }
      }
    }
  } finally {
    try { pool.close(relays) } catch {}
  }
  return out
}

// ── Card renderer ────────────────────────────────────────────────────
// Builds the `.embed-note.is-event` card: organizer avatar + name, title,
// 📅 when, 📍 where, and a "View on Nostr →" link to mynostr.app. `profile`
// is the organizer's parsed kind-0 ({ name, picture }) or null; `bech32`
// is the event's naddr for the outbound link.
export function renderCalendarCard(parsed, { bech32 = '', profile = null } = {}) {
  const card = document.createElement('div')
  card.className = 'embed-note is-event'

  const authorRow = document.createElement('div')
  authorRow.className = 'embed-author'

  const img = document.createElement('img')
  img.src = profile?.picture || '/assets/LocalBitcoiners.png'
  img.alt = ''
  img.referrerPolicy = 'no-referrer'
  img.onerror = () => { img.src = '/assets/LocalBitcoiners.png' }
  authorRow.appendChild(img)

  const nameEl = document.createElement('span')
  nameEl.className = 'author-name'
  nameEl.textContent = profile?.name || ((parsed.pubkey || '').slice(0, 8) + '…')
  authorRow.appendChild(nameEl)
  card.appendChild(authorRow)

  const titleEl = document.createElement('div')
  titleEl.className = 'event-title'
  titleEl.textContent = parsed.title
  card.appendChild(titleEl)

  const whenStr = formatEventWhen(parsed)
  if (whenStr) {
    const whenEl = document.createElement('div')
    whenEl.className = 'event-meta'
    const icon = document.createElement('span')
    icon.className = 'event-icon'
    icon.setAttribute('aria-hidden', 'true')
    icon.textContent = '📅'
    whenEl.appendChild(icon)
    whenEl.appendChild(document.createTextNode(whenStr))
    card.appendChild(whenEl)
  }

  if (parsed.location) {
    const whereEl = document.createElement('div')
    whereEl.className = 'event-meta'
    const icon = document.createElement('span')
    icon.className = 'event-icon'
    icon.setAttribute('aria-hidden', 'true')
    icon.textContent = '📍'
    whereEl.appendChild(icon)
    whereEl.appendChild(document.createTextNode(parsed.location))
    card.appendChild(whereEl)
  }

  const footer = document.createElement('div')
  footer.className = 'embed-footer'
  if (bech32) {
    const link = document.createElement('a')
    link.href = `https://mynostr.app/${bech32}`
    link.textContent = 'View on Nostr →'
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    footer.appendChild(link)
  }
  card.appendChild(footer)

  return card
}
