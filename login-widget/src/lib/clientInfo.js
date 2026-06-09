/**
 * Best-effort client fingerprint for boost-receipt telemetry.
 *
 * Deliberately COARSE: the goal is reliability buckets (Brave vs Firefox,
 * Alby vs Mutiny), not a tracking-grade fingerprint. Two rules:
 *   - browser is a readable bucket + major version, never the raw UA.
 *   - wallet provider is a NORMALIZED label, never the raw node alias —
 *     an alias can contain a username, which would deanonymize an anon
 *     boost. We match the alias against known backends and emit only the
 *     label (or 'unknown').
 */

/** Coarse "Browser N / OS" label from the UA + a couple of feature checks. */
export function detectBrowser() {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent || ''

  let os = ''
  if (/Android/i.test(ua)) os = 'Android'
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS'
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS'
  else if (/Windows/i.test(ua)) os = 'Windows'
  else if (/Linux/i.test(ua)) os = 'Linux'

  const major = (re) => {
    const m = ua.match(re)
    return m ? m[1].split('.')[0] : ''
  }

  // Order matters: Brave/Edge/Opera all carry "Chrome/..." in the UA, so
  // they must be ruled out before the generic Chrome branch. Brave's UA is
  // identical to Chrome's — the only tell is the injected navigator.brave.
  let name = 'unknown'
  let ver = ''
  if (navigator.brave) { name = 'Brave'; ver = major(/Chrome\/(\d+)/) }
  else if (/Edg\//.test(ua)) { name = 'Edge'; ver = major(/Edg\/(\d+)/) }
  else if (/OPR\//.test(ua)) { name = 'Opera'; ver = major(/OPR\/(\d+)/) }
  else if (/Firefox\//.test(ua)) { name = 'Firefox'; ver = major(/Firefox\/(\d+)/) }
  else if (/Chrome\//.test(ua)) { name = 'Chrome'; ver = major(/Chrome\/(\d+)/) }
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) { name = 'Safari'; ver = major(/Version\/(\d+)/) }

  const label = ver ? `${name} ${ver}` : name
  return os ? `${label} / ${os}` : label
}

// Known backends, matched against the node alias (and, for WebLN, a few
// injected globals). Add rows as new wallets show up in the 'unknown' tail.
const ALIAS_PROVIDERS = [
  [/getalby|alby/i, 'alby'],
  [/mutiny/i, 'mutiny'],
  [/coinos/i, 'coinos'],
  [/zeus/i, 'zeus'],
  [/wallet ?of ?satoshi|wos/i, 'walletofsatoshi'],
  [/strike/i, 'strike'],
  [/primal/i, 'primal'],
  [/minibits/i, 'minibits'],
  [/phoenix/i, 'phoenix'],
  [/lnbits/i, 'lnbits'],
  [/voltage/i, 'voltage'],
  [/blink/i, 'blink'],
  [/cashu/i, 'cashu'],
]

function fromAlias(alias) {
  if (!alias || typeof alias !== 'string') return null
  for (const [re, label] of ALIAS_PROVIDERS) {
    if (re.test(alias)) return label
  }
  return null
}

/**
 * Normalized wallet-provider label. Best-effort; returns 'unknown' when
 * we can't tell. Never returns the raw alias.
 *
 * @param {{kind?:string, alias?:string}} status  From wallet.getStatus().
 */
export function detectWalletProvider({ kind, alias } = {}) {
  // WebLN: try the injected extension globals first (most direct signal
  // for *which extension*), then fall back to the node alias.
  if (kind === 'webln' && typeof window !== 'undefined') {
    const w = window
    if (w.alby || w.webln?.isAlby) return 'alby'
    const ctor = w.webln?.constructor?.name || ''
    if (/alby/i.test(ctor)) return 'alby'
    if (/mutiny/i.test(ctor)) return 'mutiny'
    return fromAlias(alias) || 'unknown'
  }
  // NWC (or anything else): the node alias is the only hint we have.
  return fromAlias(alias) || 'unknown'
}
