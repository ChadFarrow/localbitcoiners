/* Episode page progressive enhancement.
 *
 * The page lands with each guest rendered as a truncated npub. This
 * script connects to a handful of Nostr relays, fetches kind-0 profile
 * metadata for the listed npubs, and upgrades the DOM in place with
 * display name + avatar.
 *
 * Zero dependencies — bech32 decode + WebSocket are inlined. ~4KB.
 * Failure is silent: if relays don't respond, the page stays on the
 * truncated-npub fallback.
 */
(function () {
  'use strict';

  // ── bech32 decode (just enough for npub → 32-byte pubkey hex) ──
  // Skips checksum verification — the npubs we decode here come from
  // our own server-rendered HTML, not user input.
  var BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  var BECH32_REV = {};
  for (var i = 0; i < BECH32.length; i++) BECH32_REV[BECH32[i]] = i;

  function bech32Data(bech) {
    bech = String(bech).toLowerCase();
    var sep = bech.lastIndexOf('1');
    if (sep < 1) return null;
    var hrp = bech.slice(0, sep);
    var dataStr = bech.slice(sep + 1);
    var out = [];
    for (var i = 0; i < dataStr.length; i++) {
      var v = BECH32_REV[dataStr[i]];
      if (v === undefined) return null;
      out.push(v);
    }
    if (out.length < 6) return null;
    return { hrp: hrp, data: out.slice(0, -6) };
  }

  function convertBits(data, fromBits, toBits, pad) {
    var acc = 0, bits = 0, ret = [];
    var maxv = (1 << toBits) - 1;
    for (var i = 0; i < data.length; i++) {
      acc = (acc << fromBits) | data[i];
      bits += fromBits;
      while (bits >= toBits) {
        bits -= toBits;
        ret.push((acc >> bits) & maxv);
      }
    }
    if (pad && bits > 0) ret.push((acc << (toBits - bits)) & maxv);
    else if (!pad && (bits >= fromBits || ((acc << (toBits - bits)) & maxv))) return null;
    return ret;
  }

  function npubToHex(npub) {
    var dec = bech32Data(npub);
    if (!dec || dec.hrp !== 'npub') return null;
    var bytes = convertBits(dec.data, 5, 8, false);
    if (!bytes || bytes.length !== 32) return null;
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      hex += h.length === 1 ? '0' + h : h;
    }
    return hex;
  }

  // ── Relay query (kind-0 profile metadata) ──────────────────────
  var RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
  ];
  var OVERALL_TIMEOUT_MS = 4500;
  var PER_RELAY_TIMEOUT_MS = 3500;

  function queryRelay(url, pubkeyHexes, onProfile) {
    return new Promise(function (resolve) {
      var settled = false;
      var ws;
      var subId = 'lb' + Math.random().toString(36).slice(2, 10);
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        try { ws && ws.close(); } catch (e) {}
        resolve();
      }, PER_RELAY_TIMEOUT_MS);
      try { ws = new WebSocket(url); } catch (e) { clearTimeout(timer); resolve(); return; }

      ws.onopen = function () {
        try {
          ws.send(JSON.stringify(['REQ', subId, {
            authors: pubkeyHexes,
            kinds: [0],
            limit: pubkeyHexes.length * 3,
          }]));
        } catch (e) {}
      };
      ws.onmessage = function (evt) {
        var msg;
        try { msg = JSON.parse(evt.data); } catch (e) { return; }
        if (!Array.isArray(msg)) return;
        if (msg[0] === 'EVENT' && msg[1] === subId) {
          var event = msg[2];
          if (event && event.kind === 0 && pubkeyHexes.indexOf(event.pubkey) !== -1) {
            var meta;
            try { meta = JSON.parse(event.content); } catch (e) { return; }
            onProfile(event.pubkey, event.created_at | 0, meta);
          }
        } else if (msg[0] === 'EOSE' && msg[1] === subId) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try { ws.close(); } catch (e) {}
          resolve();
        }
      };
      ws.onerror = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      ws.onclose = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
    });
  }

  function fetchProfiles(pubkeyHexes) {
    // Keep the newest event per pubkey across all relays.
    var best = Object.create(null);
    var onProfile = function (hex, createdAt, meta) {
      var prev = best[hex];
      if (!prev || createdAt > prev.created_at) {
        best[hex] = { created_at: createdAt, meta: meta };
      }
    };
    var queries = RELAYS.map(function (u) { return queryRelay(u, pubkeyHexes, onProfile); });
    var overall = new Promise(function (resolve) { setTimeout(resolve, OVERALL_TIMEOUT_MS); });
    return Promise.race([Promise.all(queries), overall]).then(function () { return best; });
  }

  // ── DOM upgrade ─────────────────────────────────────────────────
  function safeImageUrl(s) {
    if (typeof s !== 'string') return null;
    if (!/^https:\/\//.test(s)) return null;
    if (s.length > 2000) return null;
    return s;
  }

  function pickName(meta) {
    if (!meta || typeof meta !== 'object') return null;
    var candidates = [meta.display_name, meta.displayName, meta.name];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 80);
    }
    return null;
  }

  function upgrade() {
    // Any .person with a data-npub gets enhanced. For guests the name
    // is upgraded from the truncated npub; for hosts the static name
    // stays and only the avatar is set. The name-replace path below is
    // a no-op when no .person-npub element exists (i.e. hosts).
    var els = document.querySelectorAll('.person[data-npub]');
    if (!els.length) return;

    var npubByHex = Object.create(null);
    var elByNpub = Object.create(null);
    var hexes = [];

    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var npub = el.getAttribute('data-npub');
      if (!npub || elByNpub[npub]) continue;
      elByNpub[npub] = el;
      var hex = npubToHex(npub);
      if (hex) {
        npubByHex[hex] = npub;
        hexes.push(hex);
      }
    }
    if (!hexes.length) return;

    fetchProfiles(hexes).then(function (best) {
      for (var hex in best) {
        var npub = npubByHex[hex];
        var el = npub && elByNpub[npub];
        if (!el) continue;
        var meta = best[hex].meta;
        var name = pickName(meta);
        if (name) {
          var codeEl = el.querySelector('.person-npub');
          if (codeEl) {
            var span = document.createElement('span');
            span.className = 'person-name';
            span.textContent = name;
            codeEl.replaceWith(span);
          }
        }
        var pic = safeImageUrl(meta && meta.picture);
        if (pic) {
          var av = el.querySelector('.person-avatar');
          if (av) {
            // background-image URL: image loads under img-src CSP. Quote
            // the URL and let the browser handle it as a CSS string —
            // safeImageUrl already enforces https + length cap.
            av.style.backgroundImage = 'url("' + pic.replace(/"/g, '%22') + '")';
          }
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', upgrade);
  } else {
    upgrade();
  }

  // ── Lazy widget loader (mirrors index.html's ensureWidgetLoaded) ──
  // The login-widget bundle is ~250KB and only needed on boost click.
  var widgetPromise = null;
  function ensureWidgetLoaded() {
    if (widgetPromise) return widgetPromise;
    widgetPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '/assets/widgets/login-widget.js';
      s.async = true;
      s.onload = function () { Promise.resolve().then(resolve); };
      s.onerror = function () {
        widgetPromise = null;
        reject(new Error('Failed to load boost widget'));
      };
      document.head.appendChild(s);
    });
    return widgetPromise;
  }

  function readEpData() {
    var el = document.getElementById('lb-ep-data');
    if (!el) return null;
    try { return JSON.parse(el.textContent || ''); } catch (e) { return null; }
  }

  // ── Boost button ───────────────────────────────────────────────
  function wireBoost() {
    var btn = document.querySelector('[data-lb-boost-trigger="episode"]');
    if (!btn) return;
    var data = readEpData();
    if (!data || !data.episode || !data.splits) {
      btn.disabled = true;
      return;
    }
    var labelEl = btn.querySelector('.lb-boost-label');
    btn.addEventListener('click', function () {
      var prev = labelEl ? labelEl.textContent : '';
      if (labelEl) labelEl.textContent = 'Loading…';
      btn.disabled = true;
      ensureWidgetLoaded().then(function () {
        if (window.LBLogin && typeof window.LBLogin.openEpisodeBoost === 'function') {
          window.LBLogin.openEpisodeBoost({
            episode: data.episode,
            splits: data.splits,
          });
        }
      }).catch(function (e) {
        console.warn('[lb-ep] widget load failed', e);
      }).then(function () {
        if (labelEl) labelEl.textContent = prev;
        btn.disabled = false;
      });
    });
  }

  // ── MP3 download ──────────────────────────────────────────────
  // The `download` attribute is ignored cross-origin by Chrome when the
  // server doesn't send Content-Disposition: attachment, so it just
  // opens the audio file in a new tab. Fountain's CDN does send
  // Access-Control-Allow-Origin: *, so we can fetch the bytes, wrap
  // them in a Blob, and trigger a real download via a synthetic anchor.
  function wireDownloadMp3() {
    var btns = document.querySelectorAll('[data-lb-download-mp3]');
    for (var i = 0; i < btns.length; i++) (function (btn) {
      btn.addEventListener('click', function () {
        var url = btn.getAttribute('data-mp3-url');
        var filename = btn.getAttribute('data-mp3-filename') || 'episode.mp3';
        if (!url) return;
        var prev = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Downloading…';
        fetch(url).then(function (resp) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return resp.blob();
        }).then(function (blob) {
          var blobUrl = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 200);
          btn.textContent = prev;
          btn.disabled = false;
        }).catch(function (e) {
          console.warn('[lb-ep] mp3 download failed', e);
          btn.textContent = prev;
          btn.disabled = false;
          // Fall back: open the URL so the user can right-click → Save.
          window.open(url, '_blank', 'noopener');
        });
      });
    })(btns[i]);
  }

  // ── Subscribe dropdown outside-click closer (matches homepage) ─
  function wireSubscribeCloser() {
    document.addEventListener('click', function (e) {
      var open = document.querySelectorAll('details.ep-subscribe[open]');
      for (var i = 0; i < open.length; i++) {
        if (!open[i].contains(e.target)) open[i].removeAttribute('open');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      wireBoost();
      wireDownloadMp3();
      wireSubscribeCloser();
    });
  } else {
    wireBoost();
    wireDownloadMp3();
    wireSubscribeCloser();
  }

  // ── Shared profile resolver ─────────────────────────────────────
  // Exposed for other episode-page modules (ep-sats.js's pre-Nostr
  // boost list) that need npub → display name/avatar without
  // re-implementing bech32 decode + relay querying. Returns a plain
  // object keyed by the input npub strings; npubs with no resolvable
  // kind-0 are simply absent from the result.
  function fetchProfilesByNpub(npubs) {
    var hexByNpub = Object.create(null);
    var hexes = [];
    for (var i = 0; i < npubs.length; i++) {
      var npub = npubs[i];
      if (hexByNpub[npub]) continue;
      var hex = npubToHex(npub);
      if (!hex) continue;
      hexByNpub[npub] = hex;
      hexes.push(hex);
    }
    if (!hexes.length) return Promise.resolve(Object.create(null));
    return fetchProfiles(hexes).then(function (best) {
      var out = Object.create(null);
      for (var key in hexByNpub) {
        var entry = best[hexByNpub[key]];
        if (!entry) continue;
        out[key] = {
          name: pickName(entry.meta),
          picture: safeImageUrl(entry.meta && entry.meta.picture),
        };
      }
      return out;
    });
  }

  window.LBEpisodeEnhance = { fetchProfilesByNpub: fetchProfilesByNpub };
})();
