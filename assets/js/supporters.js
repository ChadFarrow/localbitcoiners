/* Supporters page — mempool.space-style grids of the people who power
 * Local Bitcoiners, in three groups:
 *
 *   1. Boosters & Streamers — everyone who sent sats, bucketed into
 *      lifetime tiers (100k+ / 69k+ / 21k+ / under 21k). Totals come
 *      from /data/sats.json (total_sats per sender_npub, boosts AND
 *      streams), the same ledger the Stats leaderboard uses. Hosts are
 *      excluded (we don't rank ourselves); truly anonymous payments
 *      (no npub and no name) are skipped.
 *   2. Coding Contributors — hardcoded; Reed maintains this by hand.
 *   3. Show Guests — npubs pulled live from /api/guests (the [guests:]
 *      tags in each episode's RSS shownotes).
 *
 * Names + circular avatars resolve through the shared profile cache
 * exposed by episode-enhance.js (window.LBEpisodeEnhance). We paint
 * immediately from the localStorage cache, then upgrade in place once
 * the relay fetch resolves. Supporters with a name but no avatar get a
 * blank circle; supporters with neither npub nor name never appear.
 */
(function () {
  'use strict';

  var SATS_URL = '/data/sats.json';
  var GUESTS_URL = '/api/guests';

  // Hosts — excluded from the booster tiers (mirrors stats.js HOST_NPUBS).
  var HOST_NPUBS = {
    'npub1xgyjasdztryl9sg6nfdm2wcj0j3qjs03sq7a0an32pg0lr5l6yaqxhgu7s': true, // Reed
    'npub1f5pre6wl6ad87vr4hr5wppqq30sh58m4p33mthnjreh03qadcajs7gwt3z': true, // Rev Hodl
  };

  // Coding Contributors — maintained by hand. Reed will say when to add.
  var CODING_CONTRIBUTORS = [
    { npub: 'npub1xgyjasdztryl9sg6nfdm2wcj0j3qjs03sq7a0an32pg0lr5l6yaqxhgu7s', label: 'Reed' },
    { npub: 'npub177fz5zkm87jdmf0we2nz7mm7uc2e7l64uzqrv6rvdrsg8qkrg7yqx0aaq7', label: 'Chad Farrow' },
  ];

  // Tier buckets, top to bottom. `min` is the inclusive lifetime-sats
  // floor; a supporter lands in the first tier they clear.
  var TIERS = [
    { id: 't100', min: 100000, title: '100k+ Boosters' },
    { id: 't69',  min: 69000,  title: '69k+ Boosters' },
    { id: 't21',  min: 21000,  title: '21k+ Boosters' },
    { id: 't0',   min: 1,      title: 'Boosters & Streamers' },
  ];

  function shortNpub(npub) {
    if (!npub || npub.length < 20) return npub || '';
    return npub.slice(0, 10) + '…' + npub.slice(-4);
  }

  // Registry of rendered cards keyed by npub so a single profile resolve
  // updates every card for that person (a guest may also be a booster).
  var cardsByNpub = Object.create(null);

  function registerCard(npub, rec) {
    if (!cardsByNpub[npub]) cardsByNpub[npub] = [];
    cardsByNpub[npub].push(rec);
  }

  // Build one supporter card. `npub` may be null for name-only supporters.
  function makeCard(opts) {
    var npub = opts.npub || null;
    var name = opts.name || (npub ? shortNpub(npub) : 'Anonymous');
    var picture = opts.picture || null;

    var card = document.createElement(npub ? 'a' : 'div');
    card.className = 'sup-card';
    if (npub) {
      card.href = 'https://mynostr.app/' + npub;
      card.target = '_blank';
      card.rel = 'noopener';
    }

    var avatar = document.createElement('span');
    avatar.className = 'sup-avatar';
    var img = null;
    if (picture) {
      img = document.createElement('img');
      img.src = picture;
      img.alt = '';
      img.loading = 'lazy';
      avatar.appendChild(img);
    } else {
      avatar.classList.add('is-blank');
    }

    var nameEl = document.createElement('span');
    nameEl.className = 'sup-name';
    nameEl.textContent = name;

    card.appendChild(avatar);
    card.appendChild(nameEl);

    if (npub) {
      registerCard(npub, { avatar: avatar, nameEl: nameEl, hasName: !!opts.name });
    }
    return card;
  }

  // Apply a resolved profile to every card for that npub.
  function applyProfile(npub, prof) {
    var recs = cardsByNpub[npub];
    if (!recs || !prof) return;
    for (var i = 0; i < recs.length; i++) {
      var rec = recs[i];
      if (prof.name) { rec.nameEl.textContent = prof.name; rec.hasName = true; }
      if (prof.picture && rec.avatar.classList.contains('is-blank')) {
        rec.avatar.classList.remove('is-blank');
        var img = document.createElement('img');
        img.src = prof.picture;
        img.alt = '';
        img.loading = 'lazy';
        rec.avatar.appendChild(img);
      }
    }
  }

  function renderSection(container, title, sub, cards) {
    if (!cards.length) return;
    var section = document.createElement('section');
    section.className = 'sup-section';

    var head = document.createElement('div');
    head.className = 'sup-section-head';
    var h2 = document.createElement('h2');
    h2.textContent = title;
    var badge = document.createElement('span');
    badge.className = 'sup-count';
    badge.textContent = String(cards.length);
    h2.appendChild(badge);
    head.appendChild(h2);
    if (sub) {
      var p = document.createElement('p');
      p.className = 'sup-section-sub';
      p.textContent = sub;
      head.appendChild(p);
    }
    section.appendChild(head);

    var grid = document.createElement('div');
    grid.className = 'sup-grid';
    for (var i = 0; i < cards.length; i++) grid.appendChild(cards[i]);
    section.appendChild(grid);

    container.appendChild(section);
  }

  // ── Aggregate supporters from the sats ledger ──────────────────────
  function aggregate(rows) {
    var byKey = Object.create(null);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var sats = typeof r.total_sats === 'number' ? r.total_sats : 0;
      if (sats <= 0) continue;
      var npub = r.sender_npub || '';
      if (npub && HOST_NPUBS[npub]) continue;            // hosts don't rank
      var key = npub || (r.sender_name ? 'name:' + r.sender_name : '');
      if (!key) continue;                                 // truly anonymous → skip
      var rec = byKey[key];
      if (!rec) {
        rec = byKey[key] = { npub: npub || null, name: r.sender_name || null, sats: 0 };
      }
      rec.sats += sats;
      if (!rec.name && r.sender_name) rec.name = r.sender_name;
    }
    var people = [];
    for (var k in byKey) people.push(byKey[k]);
    people.sort(function (a, b) { return b.sats - a.sats; });
    return people;
  }

  function tierOf(sats) {
    for (var i = 0; i < TIERS.length; i++) {
      if (sats >= TIERS[i].min) return TIERS[i].id;
    }
    return null;
  }

  function render(people, guestNpubs, cache) {
    var root = document.getElementById('supporters-root');
    var loading = document.getElementById('supporters-loading');
    if (loading) loading.style.display = 'none';

    function profFor(npub) { return (npub && cache[npub]) || null; }

    // 1. Booster tiers.
    var buckets = Object.create(null);
    TIERS.forEach(function (t) { buckets[t.id] = []; });
    people.forEach(function (p) {
      var tid = tierOf(p.sats);
      if (!tid) return;
      var prof = profFor(p.npub);
      buckets[tid].push(makeCard({
        npub: p.npub,
        name: (prof && prof.name) || p.name || null,
        picture: prof && prof.picture,
      }));
    });
    TIERS.forEach(function (t, idx) {
      renderSection(
        root,
        t.title,
        idx === 0 ? 'Lifetime sats sent via boosts + streams. Anonymous supporters aren’t shown.' : '',
        buckets[t.id]
      );
    });

    // 2. Coding Contributors.
    var contribCards = CODING_CONTRIBUTORS.map(function (c) {
      var prof = profFor(c.npub);
      return makeCard({
        npub: c.npub,
        name: (prof && prof.name) || c.label,
        picture: prof && prof.picture,
      });
    });
    renderSection(root, 'Coding Contributors', 'Builders who’ve shipped code to the site and bots.', contribCards);

    // 3. Show Guests.
    var guestCards = guestNpubs.map(function (npub) {
      var prof = profFor(npub);
      return makeCard({
        npub: npub,
        name: (prof && prof.name) || null,
        picture: prof && prof.picture,
      });
    });
    renderSection(root, 'Show Guests', 'Everyone who’s come on the podcast.', guestCards);
  }

  function collectNpubs(people, guestNpubs) {
    var set = Object.create(null);
    people.forEach(function (p) { if (p.npub) set[p.npub] = true; });
    CODING_CONTRIBUTORS.forEach(function (c) { set[c.npub] = true; });
    guestNpubs.forEach(function (n) { set[n] = true; });
    return Object.keys(set);
  }

  function init() {
    var errEl = document.getElementById('supporters-error');

    var satsP = fetch(SATS_URL, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('sats ' + r.status); return r.json(); })
      .then(function (d) { return Array.isArray(d.rows) ? d.rows : []; });

    // Guests are non-critical — fall back to an empty roster if the
    // feed endpoint is down so the booster tiers still render.
    var guestsP = fetch(GUESTS_URL)
      .then(function (r) { return r.ok ? r.json() : { guests: [] }; })
      .then(function (d) { return Array.isArray(d.guests) ? d.guests : []; })
      .catch(function () { return []; });

    Promise.all([satsP, guestsP]).then(function (res) {
      var people = aggregate(res[0]);
      var guestNpubs = res[1];
      var npubs = collectNpubs(people, guestNpubs);

      var enhance = window.LBEpisodeEnhance || {};
      var cache = (enhance.getCachedProfilesByNpub && enhance.getCachedProfilesByNpub(npubs)) || Object.create(null);

      render(people, guestNpubs, cache);

      // Upgrade in place once relays answer.
      if (enhance.fetchProfilesByNpub) {
        enhance.fetchProfilesByNpub(npubs).then(function (profiles) {
          if (!profiles) return;
          Object.keys(profiles).forEach(function (npub) {
            applyProfile(npub, profiles[npub]);
          });
        }).catch(function () {});
      }
    }).catch(function (e) {
      console.error('[supporters] load failed', e);
      var loading = document.getElementById('supporters-loading');
      if (loading) loading.style.display = 'none';
      if (errEl) errEl.style.display = 'block';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
