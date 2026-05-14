/* Stats page — podcast-wide sats-over-time chart.
 *
 * Fetches the full sats ledger (/data/sats.json) and the episode feed
 * (/api/rss), then renders an inline-SVG line chart of sats received
 * across the show's entire history. A radio toggle switches between a
 * cumulative running total and per-day totals; thin vertical markers
 * show when each episode was published (hover for the title + date).
 *
 * Counts EVERY row in the ledger — episode boosts, show-level boosts,
 * lb_donations, streams, all of it — using total_sats (what listeners
 * sent, not the show's split). Zero dependencies; fails silently to an
 * error message if the data can't be loaded.
 */
(function () {
  'use strict';

  var SATS_URL = '/data/sats.json';
  var RSS_URL = '/api/rss';
  var DAY_MS = 86400000;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var canvas = document.querySelector('[data-stats-canvas]');
  var subEl = document.querySelector('[data-stats-sub]');
  if (!canvas) return;

  Promise.all([
    fetch(SATS_URL).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; }),
    fetch(RSS_URL).then(function (r) { return r.ok ? r.text() : null; })
      .catch(function () { return null; }),
  ]).then(function (results) {
    var doc = results[0];
    var rssXml = results[1];
    if (!doc || !Array.isArray(doc.rows)) { showError(); return; }
    var rows = doc.rows.filter(function (row) {
      return typeof row.total_sats === 'number' && row.total_sats > 0 &&
        isFinite(Date.parse(row.settled_at));
    });
    if (!rows.length) { showError(); return; }
    render(rows, rssXml ? parseEpisodes(rssXml) : []);
  });

  function showError() {
    canvas.innerHTML =
      '<p class="stats-error">Couldn\'t load sats data right now — try again later.</p>';
  }

  // ── RSS parsing — episode number + publish date for the markers ────
  function parseEpisodes(xml) {
    var episodes = [];
    var itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
    var m;
    while ((m = itemRe.exec(xml)) !== null) {
      var item = m[1];
      var num = episodeNumber(item);
      var pubMs = Date.parse(tagText(item, 'pubDate'));
      if (num != null && isFinite(pubMs)) {
        episodes.push({
          num: num,
          pubMs: pubMs,
          title: tagText(item, 'title') || ('Episode ' + num),
        });
      }
    }
    return episodes;
  }

  // Episode number: <itunes:episode> wins; otherwise parse the title.
  // Covers both "… | Ep. NNN" and episode 1's "001. …" leading form.
  function episodeNumber(item) {
    var tag = tagText(item, 'itunes:episode') || tagText(item, 'episode');
    if (tag) {
      var n = parseInt(tag, 10);
      if (isFinite(n) && n > 0) return n;
    }
    var title = tagText(item, 'title') || '';
    var t = title.match(/\bEp(?:isode)?\.?\s*0*(\d+)/i) ||
            title.match(/(?:^|\s|•\s)0*(\d+)\.\s/);
    if (t) {
      var tn = parseInt(t[1], 10);
      if (isFinite(tn) && tn > 0) return tn;
    }
    return null;
  }

  function tagText(xml, tag) {
    var re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>');
    var mm = xml.match(re);
    if (!mm) return '';
    return mm[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
      .trim();
  }

  // ── Render ─────────────────────────────────────────────────────────
  function render(rows, episodes) {
    // Bucket every row's total_sats by UTC calendar day.
    var byDay = Object.create(null);
    var minMs = Infinity, maxMs = -Infinity;
    for (var i = 0; i < rows.length; i++) {
      var dayMs = Math.floor(Date.parse(rows[i].settled_at) / DAY_MS) * DAY_MS;
      byDay[dayMs] = (byDay[dayMs] || 0) + rows[i].total_sats;
      if (dayMs < minMs) minMs = dayMs;
      if (dayMs > maxMs) maxMs = dayMs;
    }
    // Stretch the axis to cover every episode release too — episode 1
    // published a day before its first boost, so without this its
    // marker would fall off the left edge of the chart.
    for (var ei = 0; ei < episodes.length; ei++) {
      var epDay = Math.floor(episodes[ei].pubMs / DAY_MS) * DAY_MS;
      if (epDay < minMs) minMs = epDay;
      if (epDay > maxMs) maxMs = epDay;
    }
    // Extend the axis to today so the timeline reads as current.
    var todayMs = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    if (todayMs > maxMs) maxMs = todayMs;

    // Daily + cumulative series across every day in [minMs, maxMs].
    var days = [];
    var run = 0;
    for (var d = minMs; d <= maxMs; d += DAY_MS) {
      var v = byDay[d] || 0;
      run += v;
      days.push({ ms: d, daily: v, cumulative: run });
    }
    var grandTotal = run;

    if (subEl) {
      subEl.textContent = fmtSats(grandTotal) + ' sats received' +
        (episodes.length ? ' across ' + episodes.length + ' episodes' : '') +
        ' since ' + fmtDate(minMs);
    }

    function draw(view) {
      canvas.innerHTML = buildSvg(days, episodes, view, minMs, maxMs);
    }
    draw('cumulative');

    var radios = document.querySelectorAll('input[name="stats-chart-view"]');
    for (var r = 0; r < radios.length; r++) {
      radios[r].addEventListener('change', function (e) {
        if (e.target.checked) draw(e.target.value);
      });
    }
  }

  // ── Inline-SVG chart renderer ──────────────────────────────────────
  function buildSvg(days, episodes, view, minMs, maxMs) {
    var W = 960, H = 360;
    var mL = 64, mR = 20, mT = 30, mB = 44;
    var pw = W - mL - mR, ph = H - mT - mB;
    var spanMs = Math.max(maxMs - minMs, DAY_MS);
    var key = view === 'daily' ? 'daily' : 'cumulative';

    var yMax = 0;
    for (var i = 0; i < days.length; i++) if (days[i][key] > yMax) yMax = days[i][key];
    yMax = niceCeil(yMax > 0 ? yMax : 1);

    function x(ms) { return mL + ((ms - minMs) / spanMs) * pw; }
    function y(val) { return mT + ph - (val / yMax) * ph; }

    var parts = [];

    // Horizontal gridlines + Y labels at 0 / 25 / 50 / 75 / 100%.
    var ySteps = [0, 0.25, 0.5, 0.75, 1];
    for (var s = 0; s < ySteps.length; s++) {
      var yv = yMax * ySteps[s];
      var yy = y(yv);
      parts.push('<line class="stats-chart-grid" x1="' + mL + '" y1="' + yy +
        '" x2="' + (W - mR) + '" y2="' + yy + '"/>');
      parts.push('<text class="stats-chart-ylabel" x="' + (mL - 8) + '" y="' +
        (yy + 4) + '">' + fmtSats(Math.round(yv)) + '</text>');
    }

    // X axis: month boundaries.
    var months = monthTicks(minMs, maxMs);
    for (var mi = 0; mi < months.length; mi++) {
      var mx = x(months[mi].ms);
      parts.push('<line class="stats-chart-grid" x1="' + mx + '" y1="' + mT +
        '" x2="' + mx + '" y2="' + (mT + ph) + '"/>');
      parts.push('<text class="stats-chart-xlabel" x="' + mx + '" y="' +
        (H - mB + 20) + '">' + months[mi].label + '</text>');
    }

    // Data line + area fill.
    var pts = [];
    for (var dd = 0; dd < days.length; dd++) {
      pts.push(x(days[dd].ms) + ',' + y(days[dd][key]));
    }
    var areaD = 'M' + x(days[0].ms) + ',' + y(0) + ' L' + pts.join(' L') +
      ' L' + x(days[days.length - 1].ms) + ',' + y(0) + ' Z';
    parts.push('<path class="stats-chart-area" d="' + areaD + '"/>');
    parts.push('<polyline class="stats-chart-line" points="' + pts.join(' ') + '"/>');

    // Episode publish markers — a bright vertical line with an "Ep N"
    // label across the top. Drawn over the data line so they stand out;
    // labels may crowd once there are many episodes (revisit then).
    for (var e = 0; e < episodes.length; e++) {
      var ep = episodes[e];
      // Snap the marker to the same UTC day-bucket the sats data uses,
      // so a release lines up with that day's dot/step instead of
      // sitting hours to its right.
      var epDayMs = Math.floor(ep.pubMs / DAY_MS) * DAY_MS;
      if (epDayMs < minMs || epDayMs > maxMs) continue;
      var ex = x(epDayMs);
      parts.push('<line class="stats-chart-epline" x1="' + ex + '" y1="' + mT +
        '" x2="' + ex + '" y2="' + (mT + ph) + '"/>');
      parts.push('<text class="stats-chart-eplabel" x="' + ex + '" y="' +
        (mT - 9) + '">Ep ' + ep.num + '</text>');
    }

    // Daily view: mark every day that actually received sats with a
    // dot, tooltipped with its date + amount.
    if (view === 'daily') {
      for (var di = 0; di < days.length; di++) {
        if (days[di].daily <= 0) continue;
        parts.push('<circle class="stats-chart-dot" cx="' + x(days[di].ms) +
          '" cy="' + y(days[di].daily) + '" r="3.5"><title>' +
          fmtDate(days[di].ms) + ': ' + fmtSats(days[di].daily) +
          ' sats</title></circle>');
      }
    }

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="stats-chart-svg" ' +
      'role="img" preserveAspectRatio="xMidYMid meet" ' +
      'aria-label="Sats received over time across the podcast">' +
      parts.join('') + '</svg>';
  }

  // First-of-month timestamps within [minMs, maxMs], for X-axis ticks.
  function monthTicks(minMs, maxMs) {
    var ticks = [];
    var start = new Date(minMs);
    var cur = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
    while (cur <= maxMs) {
      var cd = new Date(cur);
      ticks.push({ ms: cur, label: MONTHS[cd.getUTCMonth()] });
      cur = Date.UTC(cd.getUTCFullYear(), cd.getUTCMonth() + 1, 1);
    }
    // Short ranges may straddle no month boundary — anchor with the start.
    if (!ticks.length) {
      ticks.push({ ms: minMs, label: MONTHS[start.getUTCMonth()] });
    }
    return ticks;
  }

  // ── Helpers ────────────────────────────────────────────────────────
  function fmtDate(ms) {
    try {
      return new Date(ms).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      });
    } catch (e) {
      return new Date(ms).toISOString().slice(0, 10);
    }
  }

  // Round up to a clean axis bound (1/2/5 * 10^n).
  function niceCeil(n) {
    if (n <= 10) return Math.ceil(n);
    var mag = Math.pow(10, Math.floor(Math.log(n) / Math.LN10));
    var norm = n / mag;
    var step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  function fmtSats(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
})();
