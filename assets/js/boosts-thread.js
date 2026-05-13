/* Shared boost-thread read renderer.
 *
 * Loads + renders the boost mega-thread (kind-1 root + descendants) for any
 * page that wants to display it: /boosts.html in full, or /ep### filtered to
 * a single episode's anchor boosts and their replies.
 *
 * This module is read-only on purpose. Mutation (reply, like, repost, zap) is
 * page-specific and stays in /boosts.html — it consumes this module's
 * `actionsBuilder` hook to inject per-card buttons.
 *
 * Vendored nostr-tools — same bundle the rest of the site uses. Module-level
 * caches (profile/embed/calendar/card) are intentionally process-global so a
 * follow-up reply on /boosts.html can rerender the tree without losing
 * already-fetched profile data, and so the same DOM nodes get reused across
 * mutating repaints.
 */
import { SimplePool, nip19, verifyEvent } from '/assets/widgets/nostr-tools.js'

// ── Config ───────────────────────────────────────────────────────────
export const ROOT_NEVENT = 'nevent1qvzqqqqqqypzpses3q0zsa5rs8wchh7jws6pmjsvtzpv9xuxgt4yhjp0w43jv3vjqyd8wumn8ghj7urewfsk66ty9enxjct5dfskvtnrdakj7qgwwaehxw309ahx7uewd3hkctcqyr3keved458q3n7x7839r86vj4dx0s4xh0p8j7fzvf4nq7824ulagy77tpj'

const PRIMAL_WS_URL = 'wss://cache1.primal.net/v1'
const PRIMAL_TIMEOUT_MS = 6000
const STATIC_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
  'wss://purplepag.es',
]
export { STATIC_RELAYS }

const KIND_DATE_EVENT = 31922
const KIND_TIME_EVENT = 31923

// ── Module state ─────────────────────────────────────────────────────
// Caches survive multiple `fetchBoostThread` calls so subsequent paints
// (e.g. after an optimistic reply insert) skip re-fetching profiles.
const profileCache  = new Map()  // pubkey hex → { pubkey, name, picture, nip05, lud16, lud06 }
const embedCache    = new Map()  // event id hex → kind-1 event (or null = not found)
const calendarCache = new Map()  // "<kind>:<pubkey>:<dTag>" → parsed event (or null = miss)
const cardCache     = new Map()  // event id (lowercased) → cached <article> node

// Page-supplied callback that returns a per-card action bar (Reply/Like/
// Repost/Zap on /boosts.html, null on /ep### read-only pages).
let actionsBuilder = null

export function configureBoostsThread({ actionsBuilder: builder = null } = {}) {
  actionsBuilder = typeof builder === 'function' ? builder : null
}

// ── Generic helpers ──────────────────────────────────────────────────
function isSafeUrl(url) {
  if (typeof url !== 'string') return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch { return false }
}

function relTime(ts) {
  const sec = Math.floor(Date.now() / 1000) - ts
  if (sec < 60)      return `${sec}s ago`
  if (sec < 3600)    return `${Math.floor(sec/60)}m ago`
  if (sec < 86400)   return `${Math.floor(sec/3600)}h ago`
  if (sec < 2592000) return `${Math.floor(sec/86400)}d ago`
  return new Date(ts * 1000).toLocaleDateString()
}

// ── Profile cache management ─────────────────────────────────────────
// Bidi-control chars get stripped from displayable text so a hostile profile
// can't visually impersonate another user via RLO/LRI tricks.
const PROFILE_BIDI = /[‪-‮⁦-⁩]/g
function cleanProfileText(s) {
  if (typeof s !== 'string' || !s) return s || ''
  return s.replace(PROFILE_BIDI, '')
}

export function setCachedProfile(pubkey, raw) {
  if (typeof pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(pubkey)) return
  const safe = {
    pubkey,
    name:    cleanProfileText(raw?.name)    || null,
    picture: isSafeUrl(raw?.picture) ? raw.picture : null,
    nip05:   cleanProfileText(raw?.nip05)   || null,
    lud16:   typeof raw?.lud16 === 'string' ? raw.lud16 : null,
    lud06:   typeof raw?.lud06 === 'string' ? raw.lud06 : null,
  }
  profileCache.set(pubkey, safe)
}

export function getCachedProfile(pubkey) {
  return profileCache.get(pubkey) || null
}

// ── Event + card cache management ────────────────────────────────────
export function registerEvent(ev) {
  if (ev && typeof ev.id === 'string') embedCache.set(ev.id, ev)
}

export function evictCard(id) {
  if (typeof id === 'string') cardCache.delete(id.toLowerCase())
}

// ── Content parsing ──────────────────────────────────────────────────
const NOSTR_URI_RE = /nostr:(npub1[a-z0-9]+|nprofile1[a-z0-9]+|note1[a-z0-9]+|nevent1[a-z0-9]+|naddr1[a-z0-9]+)/gi
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g

function parseSegments(content) {
  if (!content) return [{ type: 'text', value: '' }]
  const tokens = []

  // Nostr URIs first — npub/nprofile become 'mention', note/nevent/naddr
  // become 'note_embed'. Decoding failures degrade to a plain text token.
  for (const m of content.matchAll(NOSTR_URI_RE)) {
    const raw = m[1]
    const tok = { start: m.index, end: m.index + m[0].length, value: m[0], data: { bech32: raw } }
    try {
      const decoded = nip19.decode(raw)
      tok.data.decoded = decoded
      if (decoded.type === 'npub') {
        tok.type = 'mention'
        tok.data.pubkey = decoded.data
      } else if (decoded.type === 'nprofile') {
        tok.type = 'mention'
        tok.data.pubkey = decoded.data.pubkey
      } else if (decoded.type === 'note') {
        tok.type = 'note_embed'
        tok.data.eventId = decoded.data
      } else if (decoded.type === 'nevent') {
        tok.type = 'note_embed'
        tok.data.eventId = decoded.data.id
        tok.data.author  = decoded.data.author || null
      } else if (decoded.type === 'naddr') {
        tok.type = 'note_embed'
        tok.data.addressable = true
        tok.data.naddr = decoded.data
      } else {
        tok.type = 'text'
      }
    } catch {
      tok.type = 'text'
    }
    tokens.push(tok)
  }

  // URLs that don't overlap a nostr URI.
  for (const m of content.matchAll(URL_RE)) {
    if (tokens.some(t => m.index >= t.start && m.index < t.end)) continue
    tokens.push({
      type: 'link',
      start: m.index, end: m.index + m[0].length,
      value: m[0], data: { url: m[0] },
    })
  }

  tokens.sort((a, b) => a.start - b.start)

  const segments = []
  let cursor = 0
  for (const tok of tokens) {
    if (tok.start > cursor) segments.push({ type: 'text', value: content.slice(cursor, tok.start) })
    segments.push({ type: tok.type, value: tok.value, data: tok.data })
    cursor = tok.end
  }
  if (cursor < content.length) segments.push({ type: 'text', value: content.slice(cursor) })

  return segments.length ? segments : [{ type: 'text', value: content }]
}

function renderSegmentsInto(el, segments, opts = {}) {
  for (const seg of segments) {
    if (seg.type === 'text') {
      el.appendChild(document.createTextNode(seg.value))
    } else if (seg.type === 'link') {
      const url = seg.data?.url || seg.value
      if (isSafeUrl(url)) {
        const a = document.createElement('a')
        a.href = url
        a.textContent = url
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        el.appendChild(a)
      } else {
        el.appendChild(document.createTextNode(url))
      }
    } else if (seg.type === 'mention') {
      el.appendChild(buildMentionEl(seg))
    } else if (seg.type === 'note_embed') {
      if (opts.inEmbed) {
        // No nested embeds — degrade to a chip that links to njump.
        el.appendChild(buildEmbedChip(seg))
      } else {
        el.appendChild(buildEmbedNoteEl(seg))
      }
    } else {
      el.appendChild(document.createTextNode(seg.value || ''))
    }
  }
}

function buildMentionEl(seg) {
  const a = document.createElement('a')
  a.className = 'nostr-mention'
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.href = `https://njump.me/${seg.data.bech32 || seg.value.replace(/^nostr:/i, '')}`

  const profile = seg.data.pubkey ? profileCache.get(seg.data.pubkey) : null
  if (profile?.name) {
    a.textContent = '@' + profile.name
    if (profile.nip05) a.title = profile.nip05
  } else {
    let npub = seg.data.bech32 || seg.value.replace(/^nostr:/i, '')
    if (seg.data.pubkey) {
      try { npub = nip19.npubEncode(seg.data.pubkey) } catch {}
    }
    a.textContent = '@' + npub.slice(0, 14) + '…'
  }
  return a
}

function buildEmbedChip(seg) {
  const a = document.createElement('a')
  a.className = 'nostr-mention'
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.href = `https://njump.me/${seg.data.bech32 || seg.value.replace(/^nostr:/i, '')}`
  a.textContent = '@' + (seg.data.bech32 || seg.value).slice(0, 14) + '…'
  return a
}

function buildEmbedNoteEl(seg) {
  const card = document.createElement('div')
  card.className = 'embed-note'

  // naddr (long-form, calendar event, etc.) — NIP-52 calendar events
  // get a rich inline card; every other addressable kind falls back to
  // a chip linking out.
  if (seg.data.addressable) {
    const naddrKind = seg.data.naddr?.kind
    const isCalendar = naddrKind === KIND_DATE_EVENT || naddrKind === KIND_TIME_EVENT
    const coord = isCalendar
      ? `${naddrKind}:${seg.data.naddr.pubkey}:${seg.data.naddr.identifier}`
      : null
    const parsedEvent = coord ? calendarCache.get(coord) : null

    if (parsedEvent) {
      card.classList.add('is-event')

      const authorRow = document.createElement('div')
      authorRow.className = 'embed-author'
      const profile = profileCache.get(parsedEvent.pubkey)

      const img = document.createElement('img')
      img.src = profile?.picture || '/assets/LocalBitcoiners.png'
      img.alt = ''
      img.referrerPolicy = 'no-referrer'
      img.onerror = () => { img.src = '/assets/LocalBitcoiners.png' }
      authorRow.appendChild(img)

      const nameEl = document.createElement('span')
      nameEl.className = 'author-name'
      nameEl.textContent = profile?.name || (parsedEvent.pubkey.slice(0, 8) + '…')
      authorRow.appendChild(nameEl)
      card.appendChild(authorRow)

      const titleEl = document.createElement('div')
      titleEl.className = 'event-title'
      titleEl.textContent = parsedEvent.title
      card.appendChild(titleEl)

      const whenStr = formatEventWhen(parsedEvent)
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

      if (parsedEvent.location) {
        const whereEl = document.createElement('div')
        whereEl.className = 'event-meta'
        const icon = document.createElement('span')
        icon.className = 'event-icon'
        icon.setAttribute('aria-hidden', 'true')
        icon.textContent = '📍'
        whereEl.appendChild(icon)
        whereEl.appendChild(document.createTextNode(parsedEvent.location))
        card.appendChild(whereEl)
      }

      const footer = document.createElement('div')
      footer.className = 'embed-footer'
      const link = document.createElement('a')
      link.href = `https://mynostr.app/${seg.data.bech32}`
      link.textContent = 'View on Nostr →'
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      footer.appendChild(link)
      card.appendChild(footer)
      return card
    }

    card.classList.add('is-naddr')
    const link = document.createElement('a')
    if (isCalendar) {
      link.href = `https://mynostr.app/${seg.data.bech32}`
      link.textContent = '📅 Linked event on Nostr →'
    } else {
      link.href = `https://njump.me/${seg.data.bech32}`
      link.textContent = '📄 Linked article on Nostr →'
    }
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    card.appendChild(link)
    return card
  }

  const ev = seg.data.eventId ? embedCache.get(seg.data.eventId) : null
  if (!ev) {
    card.classList.add('is-missing')
    card.appendChild(document.createTextNode('Quoted note not available'))
    const link = document.createElement('a')
    link.href = `https://njump.me/${seg.data.bech32}`
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = 'View on Nostr →'
    card.appendChild(link)
    return card
  }

  const authorRow = document.createElement('div')
  authorRow.className = 'embed-author'
  const profile = profileCache.get(ev.pubkey)

  const img = document.createElement('img')
  img.src = profile?.picture || '/assets/LocalBitcoiners.png'
  img.alt = ''
  img.referrerPolicy = 'no-referrer'
  img.onerror = () => { img.src = '/assets/LocalBitcoiners.png' }
  authorRow.appendChild(img)

  const nameEl = document.createElement('span')
  nameEl.className = 'author-name'
  nameEl.textContent = profile?.name || (ev.pubkey.slice(0, 8) + '…')
  authorRow.appendChild(nameEl)

  const time = document.createElement('time')
  time.dateTime = new Date(ev.created_at * 1000).toISOString()
  time.textContent = relTime(ev.created_at)
  time.title = new Date(ev.created_at * 1000).toLocaleString()
  authorRow.appendChild(time)

  card.appendChild(authorRow)

  const body = document.createElement('div')
  body.className = 'embed-body'
  const text = ev.content || ''
  const snippet = text.length > 600 ? text.slice(0, 600) + '…' : text
  renderSegmentsInto(body, parseSegments(snippet), { inEmbed: true })
  card.appendChild(body)

  const footer = document.createElement('div')
  footer.className = 'embed-footer'
  let nevent = ''
  try { nevent = nip19.neventEncode({ id: ev.id, author: ev.pubkey }) } catch {}
  if (nevent) {
    const link = document.createElement('a')
    link.href = `https://njump.me/${nevent}`
    link.textContent = 'View on Nostr →'
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    footer.appendChild(link)
  }
  card.appendChild(footer)

  return card
}

function renderContentInto(el, text) {
  renderSegmentsInto(el, parseSegments(text))
}

// ── Profile parsing ──────────────────────────────────────────────────
function parseProfileEvent(ev) {
  try {
    const meta = JSON.parse(ev.content)
    return {
      pubkey:  ev.pubkey,
      name:    meta.display_name || meta.name || '',
      picture: isSafeUrl(meta.picture) ? meta.picture : null,
      nip05:   meta.nip05 || '',
      lud16:   typeof meta.lud16 === 'string' ? meta.lud16.trim() : '',
      lud06:   typeof meta.lud06 === 'string' ? meta.lud06.trim() : '',
    }
  } catch {
    return { pubkey: ev.pubkey }
  }
}

// ── Primal cache: low-level query ────────────────────────────────────
function primalQuery(op, params, timeoutMs = PRIMAL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false
    const events = []
    const finish = (val, err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch {}
      if (err) reject(err); else resolve(val)
    }
    const ws = new WebSocket(PRIMAL_WS_URL)
    const subId = `lb_${op}_${Date.now()}`
    const timer = setTimeout(
      () => finish(null, new Error(`Primal "${op}" timed out`)),
      timeoutMs,
    )
    ws.onopen = () => {
      ws.send(JSON.stringify(['REQ', subId, { cache: [op, params] }]))
    }
    ws.onerror = () => finish(null, new Error(`Primal WS error (${op})`))
    // If close fires before EOSE, treat whatever we have as the result.
    ws.onclose = () => { if (!settled) finish(events) }
    ws.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data) } catch { return }
      const [type, , payload] = msg
      if (type === 'EVENT' && payload) events.push(payload)
      else if (type === 'EOSE') finish(events)
    }
  })
}

async function fetchThreadFromPrimal(rootId) {
  const events = await primalQuery('thread_view', { event_id: rootId, limit: 400 })
  const notes = []
  const profiles = new Map()
  for (const ev of events) {
    if (ev.kind === 1) notes.push(ev)
    else if (ev.kind === 0) profiles.set(ev.pubkey, parseProfileEvent(ev))
  }
  return { notes, profiles }
}

async function fetchProfilesFromPrimal(pubkeys) {
  if (!pubkeys.length) return new Map()
  try {
    const evs = await primalQuery('user_infos', { pubkeys })
    const out = new Map()
    for (const ev of evs) if (ev.kind === 0) out.set(ev.pubkey, parseProfileEvent(ev))
    return out
  } catch { return new Map() }
}

async function fetchEventsFromPrimal(eventIds) {
  if (!eventIds.length) return { notes: new Map(), profiles: new Map() }
  try {
    const evs = await primalQuery('events', { event_ids: eventIds }, 8000)
    const notes = new Map()
    const profiles = new Map()
    for (const ev of evs) {
      if (ev.kind === 1) notes.set(ev.id, ev)
      else if (ev.kind === 0) profiles.set(ev.pubkey, parseProfileEvent(ev))
    }
    return { notes, profiles }
  } catch { return { notes: new Map(), profiles: new Map() } }
}

// Expose Primal lookups for page-level handlers (e.g. /boosts.html zap flow
// needs to fetch a recipient's lud16 on demand if not cached).
export { fetchProfilesFromPrimal }

// ── NIP-52 calendar events ──────────────────────────────────────────
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

function parseCalendarEvent(ev) {
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

function formatEventWhen(parsed) {
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

async function fetchCalendarEventsFromRelays(coords, relays) {
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

// ── Direct-relay fallback (untrusted source — verify everything) ─────
function eventReferencesRoot(ev, rootId) {
  if (!Array.isArray(ev?.tags)) return false
  for (const t of ev.tags) {
    if (Array.isArray(t) && t[0] === 'e' && t[1] === rootId) return true
  }
  return false
}

async function fetchThreadFromRelays(rootId, relays) {
  const pool = new SimplePool()
  try {
    const [root, replies] = await Promise.all([
      pool.get(relays, { kinds: [1], ids: [rootId] }).catch(() => null),
      pool.querySync(relays, { kinds: [1], '#e': [rootId], limit: 500 }).catch(() => []),
    ])
    const notes = []
    if (root && root.id === rootId && verifyEvent(root)) notes.push(root)
    for (const ev of replies) {
      if (!ev?.id || ev.id === rootId) continue
      if (!eventReferencesRoot(ev, rootId)) continue
      if (!verifyEvent(ev)) continue
      notes.push(ev)
    }
    const pubkeys = [...new Set(notes.map(n => n.pubkey))]
    const profiles = new Map()
    await Promise.all(pubkeys.map(async (pk) => {
      const ev = await pool.get(relays, { kinds: [0], authors: [pk] }).catch(() => null)
      if (ev && ev.pubkey === pk && verifyEvent(ev)) {
        profiles.set(pk, parseProfileEvent(ev))
      }
    }))
    return { notes, profiles }
  } finally {
    pool.close(relays)
  }
}

// ── Card renderer ────────────────────────────────────────────────────
export function renderNoteCard(ev, { isRoot = false } = {}) {
  const profile = profileCache.get(ev.pubkey)
  const card = document.createElement('article')
  card.className = 'note-card' + (isRoot ? ' is-root' : '')

  const authorRow = document.createElement('div')
  authorRow.className = 'note-author'

  const img = document.createElement('img')
  img.src = profile?.picture || '/assets/LocalBitcoiners.png'
  img.alt = ''
  img.referrerPolicy = 'no-referrer'
  img.onerror = () => { img.src = '/assets/LocalBitcoiners.png' }
  authorRow.appendChild(img)

  const nameWrap = document.createElement('div')
  nameWrap.style.display = 'flex'
  nameWrap.style.flexDirection = 'column'
  nameWrap.style.minWidth = '0'

  const nameEl = document.createElement('span')
  nameEl.className = 'author-name'
  nameEl.textContent = profile?.name || (ev.pubkey.slice(0, 8) + '…')
  nameWrap.appendChild(nameEl)

  if (profile?.nip05) {
    const handle = document.createElement('span')
    handle.className = 'author-handle'
    handle.textContent = profile.nip05
    nameWrap.appendChild(handle)
  }
  authorRow.appendChild(nameWrap)

  const time = document.createElement('time')
  time.dateTime = new Date(ev.created_at * 1000).toISOString()
  time.textContent = relTime(ev.created_at)
  time.title = new Date(ev.created_at * 1000).toLocaleString()
  authorRow.appendChild(time)

  card.appendChild(authorRow)

  const body = document.createElement('div')
  body.className = 'note-body'
  renderContentInto(body, ev.content)
  card.appendChild(body)

  const footer = document.createElement('div')
  footer.className = 'note-footer'
  let nevent = ''
  try { nevent = nip19.neventEncode({ id: ev.id, author: ev.pubkey }) } catch {}
  if (nevent) {
    const link = document.createElement('a')
    link.href = `https://njump.me/${nevent}`
    link.textContent = 'View on Nostr →'
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    footer.appendChild(link)
  }
  card.appendChild(footer)

  // Per-card actions (Reply/Like/Repost/Zap) injected by the host page.
  // Skipped on the root card and skipped entirely on read-only pages.
  if (!isRoot && typeof actionsBuilder === 'function') {
    const bar = actionsBuilder(ev, card)
    if (bar) card.appendChild(bar)
  }

  return card
}

function getOrRenderCard(ev, opts) {
  const key = ev.id.toLowerCase()
  let card = cardCache.get(key)
  if (!card) {
    card = renderNoteCard(ev, opts)
    cardCache.set(key, card)
  }
  return card
}

// ── Recursive descendant tree ────────────────────────────────────────
export function renderRepliesTree(parentId, childrenOf, container) {
  const kids = childrenOf.get(parentId) || []
  if (!kids.length) return
  const ul = document.createElement('ul')
  ul.className = 'reply-children'
  for (const ev of kids) {
    const li = document.createElement('li')
    li.appendChild(getOrRenderCard(ev))
    renderRepliesTree(ev.id, childrenOf, li)
    ul.appendChild(li)
  }
  container.appendChild(ul)
}

// ── Thread building + descendant counting ────────────────────────────
export function buildThread(rootId, allNotes) {
  const root = allNotes.find(n => n.id === rootId)
  const childrenOf = new Map()
  for (const ev of allNotes) {
    if (!ev?.id || ev.id === rootId) continue
    const eTags = (ev.tags || []).filter(t => t[0] === 'e')
    if (!eTags.length) continue
    const replyTag = eTags.find(t => t[3] === 'reply') || eTags[eTags.length - 1]
    const parentId = replyTag?.[1]
    if (!parentId) continue
    if (!childrenOf.has(parentId)) childrenOf.set(parentId, [])
    childrenOf.get(parentId).push(ev)
  }
  for (const arr of childrenOf.values()) {
    arr.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
  }
  return { root, childrenOf }
}

export function countDescendants(rootId, childrenOf) {
  let n = 0
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()
    const kids = childrenOf.get(id) || []
    n += kids.length
    for (const k of kids) stack.push(k.id)
  }
  return n
}

function isWsUrl(u) {
  if (typeof u !== 'string') return false
  return u.startsWith('wss://') || u.startsWith('ws://')
}

// ── Public: one-shot thread fetch ────────────────────────────────────
// Wraps Primal-first + relay-fallback fetch, resolves cross-references
// (mentioned npubs, quoted notes, NIP-52 calendar events), and populates
// the module-level caches. Returns the parsed thread structure for the
// caller to render.
export async function fetchBoostThread({ rootNevent = ROOT_NEVENT } = {}) {
  let rootId, hintRelays = []
  try {
    const decoded = nip19.decode(rootNevent)
    if (decoded.type !== 'nevent') throw new Error('not an nevent')
    rootId     = decoded.data.id
    hintRelays = Array.isArray(decoded.data.relays) ? decoded.data.relays.filter(isWsUrl) : []
  } catch {
    return { rootEvent: null, childrenOf: new Map(), totalReplies: 0, error: 'invalid-root' }
  }

  let result = null
  try {
    result = await fetchThreadFromPrimal(rootId)
  } catch (e) {
    console.warn('[boosts-thread] Primal failed, falling back to relays', e)
  }

  let { notes, profiles } = result || { notes: [], profiles: new Map() }
  let { root, childrenOf } = buildThread(rootId, notes)

  if (!root) {
    const relays = Array.from(new Set([...STATIC_RELAYS, ...hintRelays]))
    try {
      const fallback = await fetchThreadFromRelays(rootId, relays)
      notes = fallback.notes
      profiles = fallback.profiles
      ;({ root, childrenOf } = buildThread(rootId, notes))
    } catch (e) {
      console.error('[boosts-thread] relay fallback failed', e)
    }
  }

  if (!root) {
    return { rootEvent: null, childrenOf: new Map(), totalReplies: 0, error: 'no-root' }
  }

  for (const [pk, p] of profiles) setCachedProfile(pk, p)
  for (const ev of notes) embedCache.set(ev.id, ev)

  // Resolve mention/quote/calendar cross-references so cards render rich.
  const wantedPubkeys     = new Set()
  const wantedEventIds    = new Set()
  const wantedCalendarCoords = new Set()
  for (const ev of notes) {
    for (const m of (ev.content || '').matchAll(NOSTR_URI_RE)) {
      try {
        const decoded = nip19.decode(m[1])
        if (decoded.type === 'npub') wantedPubkeys.add(decoded.data)
        else if (decoded.type === 'nprofile') wantedPubkeys.add(decoded.data.pubkey)
        else if (decoded.type === 'note') wantedEventIds.add(decoded.data)
        else if (decoded.type === 'nevent') wantedEventIds.add(decoded.data.id)
        else if (decoded.type === 'naddr') {
          const { kind, pubkey, identifier } = decoded.data
          if ((kind === KIND_DATE_EVENT || kind === KIND_TIME_EVENT) && pubkey && identifier) {
            wantedCalendarCoords.add(`${kind}:${pubkey}:${identifier}`)
          }
        }
      } catch {}
    }
  }
  const missingPubkeys     = [...wantedPubkeys].filter(pk => !profileCache.has(pk))
  const missingEventIds    = [...wantedEventIds].filter(id => !embedCache.has(id))
  const missingCalendar    = [...wantedCalendarCoords].filter(c => !calendarCache.has(c))
  const calendarFetchRelays = Array.from(new Set([...STATIC_RELAYS, ...hintRelays]))

  if (missingPubkeys.length || missingEventIds.length || missingCalendar.length) {
    const [extraProfiles, extraEvents, extraCalendar] = await Promise.all([
      fetchProfilesFromPrimal(missingPubkeys),
      fetchEventsFromPrimal(missingEventIds),
      fetchCalendarEventsFromRelays(missingCalendar, calendarFetchRelays),
    ])
    for (const [pk, p] of extraProfiles) setCachedProfile(pk, p)
    for (const [id, ev] of extraEvents.notes) embedCache.set(id, ev)
    for (const [pk, p] of extraEvents.profiles) setCachedProfile(pk, p)
    for (const [coord, parsed] of extraCalendar) calendarCache.set(coord, parsed)
    // Mark unresolvable ids so the renderer shows the "not available"
    // fallback instead of a perpetual skeleton.
    for (const id of missingEventIds) {
      if (!embedCache.has(id)) embedCache.set(id, null)
    }
    for (const coord of missingCalendar) {
      if (!calendarCache.has(coord)) calendarCache.set(coord, null)
    }

    // Quoted-event authors + calendar-event organisers come back without
    // their kind-0; do a follow-up profile fetch so embed cards render
    // @displayName instead of a truncated npub.
    const embedAuthorPubkeys = new Set()
    for (const [, ev] of extraEvents.notes) {
      if (ev?.pubkey && !profileCache.has(ev.pubkey)) embedAuthorPubkeys.add(ev.pubkey)
    }
    for (const [, parsed] of extraCalendar) {
      if (parsed?.pubkey && !profileCache.has(parsed.pubkey)) embedAuthorPubkeys.add(parsed.pubkey)
    }
    if (embedAuthorPubkeys.size) {
      const more = await fetchProfilesFromPrimal([...embedAuthorPubkeys])
      for (const [pk, p] of more) setCachedProfile(pk, p)
    }
  }

  const totalReplies = notes.filter(n => n.id !== rootId).length
  return { rootEvent: root, childrenOf, totalReplies, error: null }
}
