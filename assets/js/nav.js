/* Shared nav helpers. Currently just the outside-click closer for the
   "More ▾" details dropdown — clicking anywhere outside an open
   dropdown collapses it, matching the affordance users expect from
   a top-of-page menu. */
(function () {
  'use strict'
  document.addEventListener('click', function (e) {
    var open = document.querySelectorAll('details.nav-more[open]')
    for (var i = 0; i < open.length; i++) {
      if (!open[i].contains(e.target)) open[i].removeAttribute('open')
    }
  })
  // Also collapse when the user picks an item — anchor clicks inside
  // the menu would otherwise leave the dropdown stuck open during
  // the same-page hash-jump.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('.nav-more-menu a')
    if (!a) return
    var d = a.closest('details.nav-more')
    if (d) d.removeAttribute('open')
  })

  // ── "Report a bug" trigger (More ▾ dropdown item, sitewide) ──────────
  // Lazy-loads the login-widget bundle on demand and opens the bug-report
  // modal (which gates login itself). The bundle has an internal
  // double-load guard, so injecting it here is safe even when a page also
  // lazy-loads it for boosts/identity.
  function ensureWidget() {
    if (window.LBLogin) return Promise.resolve()
    if (window.__lbWidgetLoad) return window.__lbWidgetLoad
    window.__lbWidgetLoad = new Promise(function (resolve, reject) {
      // If a page loader already injected the bundle, just wait for it.
      var existing = document.querySelector('script[src*="login-widget.js"]')
      if (existing && !window.LBLogin) {
        var iv = setInterval(function () { if (window.LBLogin) { clearInterval(iv); resolve() } }, 60)
        setTimeout(function () { clearInterval(iv); window.LBLogin ? resolve() : reject(new Error('widget load timeout')) }, 15000)
        return
      }
      var s = document.createElement('script')
      s.src = '/assets/widgets/login-widget.js'
      s.async = true
      s.onload = function () { Promise.resolve().then(resolve) }
      s.onerror = function () { window.__lbWidgetLoad = null; reject(new Error('widget load failed')) }
      document.head.appendChild(s)
    })
    return window.__lbWidgetLoad
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-lb-bug-trigger]')
    if (!t) return
    e.preventDefault()
    ensureWidget().then(function () {
      if (window.LBLogin && window.LBLogin.openBugReport) window.LBLogin.openBugReport()
    }).catch(function (err) { console.error('[lb] bug-report widget load failed', err) })
  })
})()
