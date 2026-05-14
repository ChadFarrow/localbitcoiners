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
})()
