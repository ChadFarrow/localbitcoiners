/**
 * PasswordManagerHoneypot — invisible username/password pair placed
 * BEFORE the real form fields.
 *
 * Why this exists: LastPass / 1Password / Bitwarden / Dashlane are
 * heuristic-driven, and they routinely ignore `autocomplete="off"`
 * and the various `data-*-ignore` opt-outs. The trick that actually
 * works is to give them a fake login form first — they fill those
 * honeypot fields and skip the real composer inputs that follow.
 *
 * The honeypots are positioned off-screen rather than `display:none`
 * because some fillers explicitly skip hidden fields. `tabIndex={-1}`
 * keeps them out of keyboard navigation, `aria-hidden` keeps them
 * out of screen readers, and `readOnly` prevents the user from
 * typing into them in the rare case the layout glitches.
 */
export default function PasswordManagerHoneypot() {
  const offscreen = {
    position: 'absolute',
    left: '-9999px',
    top: '-9999px',
    width: '1px',
    height: '1px',
    opacity: 0,
    pointerEvents: 'none',
  }
  return (
    <div aria-hidden="true">
      <input
        type="text"
        name="username"
        autoComplete="username"
        tabIndex={-1}
        readOnly
        defaultValue=""
        style={offscreen}
      />
      <input
        type="password"
        name="password"
        autoComplete="current-password"
        tabIndex={-1}
        readOnly
        defaultValue=""
        style={offscreen}
      />
    </div>
  )
}
