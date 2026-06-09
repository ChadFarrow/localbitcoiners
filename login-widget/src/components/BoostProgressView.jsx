/**
 * In-modal live boost progress view.
 *
 * Replaces the old send-and-forget behavior (modal closed instantly on
 * Boost, leaving only a small top banner). Now the modal stays open and
 * shows what's happening leg by leg, so a donor — especially on a big
 * multi-leg boost — has an unmissable, central "stay here, this is still
 * working" surface instead of a banner they can scroll past.
 *
 * Phases:
 *   - 'sending' — header + progress bar + per-recipient rows, each row's
 *     status driven by payAllLegs's per-leg onStatus stream.
 *   - 'done'    — success / partial / failed summary. Each FAILED row gets
 *     its own small Retry button; retrying a leg updates that row in place
 *     (the partial state persists until every leg is paid). Confetti fires
 *     once when all legs are paid.
 *
 * Display is derived entirely from `legStates` (the live per-leg array), so
 * an in-place single-leg retry re-computes the summary with no extra wiring.
 *
 * The background queue keeps running regardless of this component, so if the
 * user force-closes mid-boost the legs still pay and the fallback banner
 * takes over — this view is the primary surface, not the only one.
 */

import { useEffect, useRef } from 'react'
import { fireConfetti } from '../lib/confetti.js'
import { isSafeUrl } from '../lib/utils.js'

// payAllLegs per-leg statuses that mean "this leg is actively working".
const WORKING = new Set(['resolving', 'requesting', 'publishing', 'paying'])

function Spinner() {
  return (
    <svg
      className="animate-spin w-3.5 h-3.5 text-orange-400"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function StatusIcon({ status }) {
  if (status === 'paid') {
    return (
      <svg className="w-4 h-4 text-green-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.5 7.6a1 1 0 0 1-1.42.006l-3.5-3.5a1 1 0 1 1 1.414-1.414l2.79 2.79 6.796-6.886a1 1 0 0 1 1.414-.006Z" clipRule="evenodd" />
      </svg>
    )
  }
  if (status === 'failed') {
    return (
      <svg className="w-4 h-4 text-red-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M10 8.586 6.707 5.293a1 1 0 0 0-1.414 1.414L8.586 10l-3.293 3.293a1 1 0 1 0 1.414 1.414L10 11.414l3.293 3.293a1 1 0 0 0 1.414-1.414L11.414 10l3.293-3.293a1 1 0 0 0-1.414-1.414L10 8.586Z" clipRule="evenodd" />
      </svg>
    )
  }
  if (WORKING.has(status)) return <Spinner />
  // pending / unknown — dim dot
  return <span className="inline-block w-2 h-2 rounded-full bg-neutral-600" aria-hidden="true" />
}

function statusWord(status) {
  switch (status) {
    case 'paid': return 'Sent'
    case 'failed': return 'Failed'
    case 'paying': return 'Paying…'
    case 'publishing': return 'Publishing…'
    case 'requesting': return 'Invoice…'
    case 'resolving': return 'Resolving…'
    default: return 'Waiting'
  }
}

export default function BoostProgressView({
  recipients = [],
  totalSats = 0,
  legStates = [],
  phase,          // 'sending' | 'done'
  onDone,
  onRetryLeg,     // (legIndex) => retry just that leg, in place
}) {
  const totalWeight = recipients.reduce((acc, r) => acc + (r?.splitWeight || 0), 0) || 1
  const total = recipients.length

  // Everything below is derived from the live leg array, so an in-place
  // single-leg retry re-computes the summary automatically.
  const paidCount = legStates.filter((l) => l?.status === 'paid').length
  const failedCount = legStates.filter((l) => l?.status === 'failed').length
  const settledCount = paidCount + failedCount
  const pct = total > 0 ? Math.round((settledCount / total) * 100) : 0

  const done = phase === 'done'
  const allOk = done && total > 0 && paidCount === total
  const failedAll = done && total > 0 && paidCount === 0 && failedCount === total
  const partial = done && !allOk && !failedAll

  // Confetti once, when every leg is paid (including reaching all-paid via a
  // retry). Guarded so re-renders can't re-fire it.
  const firedRef = useRef(false)
  useEffect(() => {
    if (allOk && !firedRef.current) {
      firedRef.current = true
      fireConfetti()
    }
  }, [allOk])

  return (
    <div className="flex flex-col gap-4 min-h-[360px]" role="status" aria-live="polite">
      {/* Header / summary (shrink-0 so the rows area owns the flex space) */}
      <div className="shrink-0 space-y-2">
        {!done && (
          <>
            <div className="flex items-center gap-2">
              <Spinner />
              <p className="text-base font-semibold text-orange-300">
                Sending your boost — keep this window open
              </p>
            </div>
            <p className="text-xs leading-relaxed text-neutral-400">
              A boost is split across {total} {total === 1 ? 'recipient' : 'recipients'},
              and each one is paid as a separate Lightning payment — one at a
              time, which takes a few seconds. This is normal.
            </p>
            <p className="text-xs leading-relaxed text-neutral-500">
              Please don't close this or leave the page until it finishes —
              anything that hasn't been sent yet{' '}
              <span className="text-neutral-300">won't go through</span> if you
              leave early. We'll let you know the moment it's done.
            </p>
            <p className="text-xs font-medium text-neutral-300 pt-0.5">
              {settledCount} of {total} sent so far…
            </p>
          </>
        )}

        {allOk && (
          <>
            <p className="text-base font-semibold text-green-400">⚡ Boost delivered!</p>
            <p className="text-xs text-neutral-400">
              All {total} {total === 1 ? 'recipient' : 'recipients'} paid
              ({totalSats.toLocaleString()} sats). Thanks for the support.
            </p>
          </>
        )}
        {partial && (
          <>
            <p className="text-base font-semibold text-amber-400">Boost partly delivered</p>
            <p className="text-xs leading-relaxed text-neutral-400">
              {paidCount} of {total} sent.{' '}
              {failedCount > 0
                ? 'A failed leg is usually a problem on the recipient’s end, not yours — your wallet wasn’t charged for it. Hit Retry next to any that failed.'
                : 'Finishing up…'}
            </p>
          </>
        )}
        {failedAll && (
          <>
            <p className="text-base font-semibold text-red-400">Boost didn't go through</p>
            <p className="text-xs leading-relaxed text-neutral-400">
              None of the payments went through — when every leg fails it's
              almost always your wallet (disconnected, not enough balance, or
              it declined). Your wallet wasn't charged. Check it, then retry.
            </p>
          </>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden shrink-0">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            failedAll ? 'bg-red-500' : partial ? 'bg-amber-500' : 'bg-orange-500'
          }`}
          style={{ width: `${done && !partial ? 100 : pct}%` }}
        />
      </div>

      {/* Per-recipient rows. flex-1 so the list fills the modal's height and
          pushes the Done button to the bottom; overflow-x-hidden so a long
          recipient address can never produce a horizontal scrollbar. */}
      <ul className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-1 -mr-1 pr-1">
        {recipients.map((r, i) => {
          const st = legStates[i] || {}
          const status = st.status || 'pending'
          const sats = st.msats != null
            ? Math.round(st.msats / 1000)
            : Math.floor((totalSats * (r?.splitWeight || 0)) / totalWeight)
          return (
            <li
              key={`${r?.address || 'r'}-${i}`}
              className="flex items-center justify-between gap-3 text-sm py-1.5 min-w-0"
            >
              {/* min-w-0 on BOTH the container and the name is what lets the
                  name actually truncate instead of overflowing the row. */}
              <span className="flex items-center gap-2 min-w-0 flex-1">
                {r?.image && isSafeUrl(r.image) && (
                  <img
                    src={r.image}
                    alt=""
                    className="w-4 h-4 rounded-full object-cover flex-shrink-0"
                    onError={(e) => { e.target.style.display = 'none' }}
                  />
                )}
                <span className="text-neutral-300 truncate min-w-0">
                  {r?.name || r?.address || `Recipient ${i + 1}`}
                </span>
                <span className="text-neutral-500 flex-shrink-0 text-xs">
                  {sats.toLocaleString()} sats
                </span>
              </span>

              <span className="flex items-center gap-2 flex-shrink-0">
                {status === 'failed' && onRetryLeg && (
                  <button
                    onClick={() => onRetryLeg(i)}
                    className="text-[11px] font-medium px-2 py-0.5 rounded bg-orange-500 hover:bg-orange-600 text-white transition-colors"
                  >
                    Retry
                  </button>
                )}
                <span className={`text-right ${
                  status === 'paid' ? 'text-green-400'
                    : status === 'failed' ? 'text-red-400'
                      : WORKING.has(status) ? 'text-orange-300'
                        : 'text-neutral-500'
                }`}>
                  {statusWord(status)}
                </span>
                <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                  <StatusIcon status={status} />
                </span>
              </span>
            </li>
          )
        })}
      </ul>

      {done && (
        <button
          onClick={onDone}
          className="shrink-0 w-full py-3 rounded bg-orange-500 hover:bg-orange-600 text-sm font-medium text-white transition-colors"
        >
          Done
        </button>
      )}
    </div>
  )
}
