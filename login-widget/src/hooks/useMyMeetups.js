/**
 * useMyMeetups — fetch the logged-in user's published NIP-52 calendar
 * events (31922/31923) from relays, keeping the newest revision per
 * coordinate.
 *
 * `enabled` gates the relay round-trip so callers can fetch lazily — e.g.
 * the meetup composer only loads the user's events once its "Import /
 * Export Options" disclosure is expanded. Each returned row carries the
 * raw event under `.raw`, so a caller can re-seed a composer form (via
 * eventToForm) without a second fetch.
 *
 * Returns { events, error } where events is:
 *   null = loading, [] = none, [{ ...parsed, raw }, …] = loaded.
 */
import { useEffect, useState } from 'react'
import { getNDK, connectAndWait } from '../lib/ndk.js'
import {
  KIND_DATE_EVENT,
  KIND_TIME_EVENT,
  parseCalendarEvent,
} from '../lib/eventTypes.js'

export function useMyMeetups(pubkey, enabled = true) {
  const [events, setEvents] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!enabled) return
    if (!pubkey) { setEvents([]); return }
    let cancelled = false
    setError('')
    setEvents(null)
    ;(async () => {
      try {
        const ndk = getNDK()
        await connectAndWait(ndk, 3000).catch(() => {})
        const set = await ndk.fetchEvents({
          kinds: [KIND_DATE_EVENT, KIND_TIME_EVENT],
          authors: [pubkey],
          limit: 200,
        })
        if (cancelled) return
        // The same (kind, pubkey, d) coordinate may arrive from multiple
        // relays as separate revisions — keep the newest per coordinate.
        const byCoord = new Map()
        for (const ev of set || []) {
          const d = ev.tags?.find(t => t[0] === 'd')?.[1]
          if (!d) continue
          const key = `${ev.kind}:${ev.pubkey}:${d}`
          const prev = byCoord.get(key)
          if (!prev || (ev.created_at || 0) > (prev.created_at || 0)) byCoord.set(key, ev)
        }
        const parsed = []
        for (const ev of byCoord.values()) {
          const raw = {
            id: ev.id, pubkey: ev.pubkey, kind: ev.kind,
            tags: ev.tags || [], content: ev.content || '', created_at: ev.created_at,
          }
          const p = parseCalendarEvent(raw)
          if (p) parsed.push({ ...p, raw })
        }
        setEvents(parsed)
      } catch (e) {
        if (cancelled) return
        console.warn('[useMyMeetups] fetch failed', e)
        setError('Couldn’t load your meetups. Please try again.')
        setEvents([])
      }
    })()
    return () => { cancelled = true }
  }, [pubkey, enabled])

  return { events, error }
}

/**
 * Format a parsed calendar event's start as a short, human "when" label.
 * Shared by the My Meetups boost list and the composer's copy list.
 */
export function formatMeetupWhen(p) {
  if (!p || !Number.isFinite(p.startUnix)) return ''
  const ms = p.startUnix * 1000
  const sameYear = new Date(ms).getFullYear() === new Date().getFullYear()
  if (p.isDateBased) {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      year: sameYear ? undefined : 'numeric',
      timeZone: 'UTC',
    }).format(new Date(ms))
  }
  const tz = p.startTzid || undefined
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    year: sameYear ? undefined : 'numeric',
    timeZone: tz,
    timeZoneName: 'short',
  }).format(new Date(ms))
}
