/* Stand-in for the scorecard's Cloudflare API (worker/index.js), for the browser checks.
   make_harness.py loads it before the app. It answers the page's fetch() calls to /api/ the way
   the Worker does:
   - GET /api/docs/<collection> sends an ETag and answers 304 when nothing changed;
   - PUT and DELETE save or remove one document;
   - POST /api/maps stores an image and answers {id, url, sizeBytes, contentType}.
   Map images themselves aren't served: <img> requests go to the test server and show broken,
   as they always have here.
   Query params:
     seed=<name>         starting data (see SEEDS)
     lat=<ms>            how long a write takes (default 60)
     read=<ms>           how long a read takes (default 20)
     up=<ms>             how long an upload takes (default 800)
     fail=1              every save, delete and upload fails as if the signal dropped (reads still
                         work, as in the original checks); switch with __mock.setFail(true|false)
     offline=1           every request fails, reads included: no signal at all;
                         switch with __mock.setOffline(true|false)
     signedout=401       every request answers as Cloudflare does when sign-in has lapsed;
     signedout=redirect  "redirect" sends its redirect to the sign-in page instead;
                         switch with __mock.setSignedOut("" | "401" | "redirect")
     nomock=1            no API at all, like a page opened outside Cloudflare
   Every request is recorded in window.__mock.log. All data is made up. */
(function () {
  "use strict";
  const q = new URLSearchParams(location.search);
  // short enough that a save and the refresh after it both land while a finger is still on a
  // button in "A tap made while a save lands still counts"
  const LAT = Number(q.get("lat") || 60);
  const READ = Number(q.get("read") || 20);
  const UP = Number(q.get("up") || 800);
  let FAIL = q.get("fail") === "1";
  let OFFLINE = q.get("offline") === "1";
  let SIGNED_OUT = q.get("signedout") || "";
  const day = 86400000, now = Date.now();
  const iso = (daysAgo) => new Date(now - daysAgo * day).toISOString();
  const aid = (ch) => ch.repeat(32);
  const nine = (v) => Array(9).fill(v);
  const blank = () => nine(null);

  const maple = { name: "Maple Hollow", pars: nine(3), mapUrl: "", mapAssets: [aid("a"), aid("b")], createdAt: iso(40) };
  const roundOn = (extra) => Object.assign({ courseId: "c_maple", courseName: "Maple Hollow", pars: nine(3) }, extra);

  const SEEDS = {
    empty: {},
    // a course that already has two map images
    maps: { courses: { c_maple: maple } },
    // a round in progress: holes 1-5 scored for both players
    midround: {
      courses: { c_maple: maple },
      rounds: {
        r_mid: roundOn({
          players: ["Steven", "Pat"],
          scores: { 0: [3, 4, 2, 3, 3, null, null, null, null], 1: [4, 3, 3, 3, 5, null, null, null, null] },
          status: "active", date: iso(0), createdAt: iso(0),
        }),
      },
    },
    // six players, nothing scored: enough rows to scroll on a phone
    six: {
      courses: { c_maple: maple },
      rounds: {
        r_six: roundOn({
          players: ["Steven", "Pat", "Robin", "Jules", "Casey", "Morgan"],
          scores: { 0: blank(), 1: blank(), 2: blank(), 3: blank(), 4: blank(), 5: blank() },
          status: "active", date: iso(0), createdAt: iso(0),
        }),
      },
    },
    // one full round at +5 and one round finished early after 3 holes at -2
    partial: {
      courses: { c_maple: maple },
      rounds: {
        r_full: roundOn({ players: ["Steven"], scores: { 0: [4, 3, 4, 3, 3, 4, 3, 3, 5] }, status: "done", date: iso(12), createdAt: iso(12) }),
        r_part: roundOn({ players: ["Steven"], scores: { 0: [2, 3, 2, null, null, null, null, null, null] }, status: "done", date: iso(2), createdAt: iso(2) }),
      },
    },
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const seed = SEEDS[q.get("seed") || "empty"] || {};
  const store = { courses: new Map(), rounds: new Map() };
  const versions = { courses: 0, rounds: 0 };
  const EPOCH = Math.floor(Math.random() * 1e12); // each page load is a different "database", as on the Worker
  Object.keys(seed).forEach((c) => Object.entries(seed[c]).forEach(([id, d]) => store[c].set(id, clone(d))));
  const maps = new Map();
  const log = [];
  const t0 = performance.now();
  const stamp = () => Math.round(performance.now() - t0);

  window.__mock = {
    store, maps, log, installed: false,
    peek: (coll, id) => (store[coll].has(id) ? clone(store[coll].get(id)) : null),
    setFail: (v) => { FAIL = !!v; },
    setOffline: (v) => { OFFLINE = !!v; },
    setSignedOut: (v) => { SIGNED_OUT = v ? String(v) : ""; },
  };
  if (q.get("nomock") === "1") return; // behave like a page with no server behind it
  window.__mock.installed = true;

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return realFetch(input, init);
    return answer(url, init || {});
  };
  const json = (status, body, headers) =>
    new Response(JSON.stringify(body), { status, headers: Object.assign({ "content-type": "application/json; charset=utf-8" }, headers || {}) });
  function header(init, name) {
    const h = init.headers;
    if (!h) return null;
    if (h instanceof Headers) return h.get(name);
    for (const k in h) if (k.toLowerCase() === name) return h[k];
    return null;
  }
  function answer(url, init) {
    const method = String(init.method || "GET").toUpperCase();
    const parts = url.pathname.split("/").filter(Boolean); // ["api", "docs", coll, id]
    const upload = parts[1] === "maps" && method === "POST";
    const delay = upload ? UP : method === "GET" ? READ : LAT;
    return new Promise((resolve, reject) => setTimeout(() => {
      const entry = { t: stamp(), method, path: url.pathname };
      log.push(entry);
      if (OFFLINE || (FAIL && method !== "GET")) { entry.ev = "dropped"; reject(new TypeError("mock: network dropped")); return; }
      if (SIGNED_OUT === "redirect") {
        entry.ev = "redirect";
        resolve(new Response(null, { status: 302, headers: { location: "https://example.cloudflareaccess.com/cdn-cgi/access/login" } }));
        return;
      }
      if (SIGNED_OUT) { entry.ev = "signed_out"; resolve(json(401, { code: "signed_out", message: "Sign in again to save." })); return; }
      if (parts[1] === "docs") {
        const coll = parts[2];
        if (!store[coll]) { resolve(json(404, { code: "not_found", message: "No such collection." })); return; }
        if (parts.length === 3 && method === "GET") {
          const tag = '"' + EPOCH + "-v" + versions[coll] + '"';
          if (header(init, "if-none-match") === tag) { entry.ev = "unchanged"; resolve(new Response(null, { status: 304, headers: { etag: tag } })); return; }
          entry.ev = "snapshot";
          const docs = [...store[coll].entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, d]) => ({ id, data: clone(d) }));
          resolve(json(200, { docs, version: versions[coll] }, { etag: tag }));
          return;
        }
        const id = decodeURIComponent(parts[3] || "");
        if (method === "PUT") {
          store[coll].set(id, clone(JSON.parse(init.body)));
          versions[coll]++;
          entry.ev = "set";
          entry.body = JSON.parse(init.body);
          resolve(json(200, { ok: true }));
          return;
        }
        if (method === "DELETE") {
          store[coll].delete(id);
          versions[coll]++;
          entry.ev = "delete";
          resolve(json(200, { ok: true }));
          return;
        }
      }
      if (parts[1] === "maps") {
        if (upload) {
          const id = (maps.size + 1).toString(16).padStart(32, "0");
          const body = init.body;
          maps.set(id, body);
          entry.ev = "upload";
          resolve(json(200, { id, url: "/api/maps/" + id, sizeBytes: (body && body.size) || 0, contentType: (body && body.type) || "image/png" }));
          return;
        }
        if (method === "DELETE") { maps.delete(parts[2]); entry.ev = "map-delete"; resolve(json(200, { ok: true })); return; }
      }
      resolve(json(404, { code: "not_found", message: "No such address." }));
    }, delay));
  }
})();
