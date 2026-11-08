/* Test double for the claude.ai artifact runtime (contract 0.2.96): db + assets.
   It mirrors the documented behaviour the scorecard depends on:
   - a set()/delete() is delivered to listeners at once (hasPendingWrites: true)
     and again when the store confirms it;
   - delivered documents are frozen;
   - assets.upload() resolves {id, url, sizeBytes, contentType}.
   Query params: seed=<name> (see SEEDS), lat=<ms to confirm a write>,
   up=<ms per upload>, fail=1 (every write rejects "unavailable" and is rolled back;
   switch it at run time with __mock.setFail(true|false)).
   Everything it does is recorded in window.__mock.log. All data is made up. */
(function () {
  "use strict";
  const q = new URLSearchParams(location.search);
  const LAT = Number(q.get("lat") || 400);
  const UP = Number(q.get("up") || 800);
  let FAIL = q.get("fail") === "1";
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
  const freeze = (o) => {
    Object.values(o).forEach((v) => { if (v && typeof v === "object") freeze(v); });
    return Object.freeze(o);
  };
  const seed = SEEDS[q.get("seed") || "empty"] || {};
  const store = { courses: new Map(), rounds: new Map() };
  Object.keys(seed).forEach((c) => Object.entries(seed[c]).forEach(([id, d]) => store[c].set(id, freeze(clone(d)))));

  const listeners = { courses: [], rounds: [] };
  const log = [];
  const t0 = performance.now();
  const stamp = () => Math.round(performance.now() - t0);

  function snapshot(coll, pending) {
    const meta = { fromCache: false, hasPendingWrites: pending };
    const docs = [...store[coll].entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, d]) => Object.freeze({ id, exists: true, data: () => d, metadata: meta }));
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: meta };
  }
  function emit(coll, pending) {
    log.push({ t: stamp(), ev: "snapshot", coll, pending });
    listeners[coll].forEach((fn) => setTimeout(() => fn(snapshot(coll, pending)), 0));
  }
  function ref(path) {
    const [coll, id] = path.split("/");
    if (!store[coll] || !id) throw new TypeError("mock: unexpected path " + path);
    const write = (op, apply) => {
      const before = store[coll].get(id);
      apply();
      log.push({ t: stamp(), ev: op, path, body: store[coll].has(id) ? clone(store[coll].get(id)) : null });
      emit(coll, true);
      return new Promise((resolve, reject) => setTimeout(() => {
        if (FAIL) {
          if (before) store[coll].set(id, before); else store[coll].delete(id);
          emit(coll, false);
          reject({ code: "unavailable", message: "mock: network dropped" });
        } else {
          emit(coll, false);
          resolve();
        }
      }, LAT));
    };
    return {
      id, path,
      set: (data) => write("set", () => store[coll].set(id, freeze(clone(data)))),
      delete: () => write("delete", () => store[coll].delete(id)),
    };
  }
  const db = Object.freeze({
    doc: ref,
    collection: (coll) => ({
      onSnapshot(next) {
        listeners[coll].push(next);
        setTimeout(() => next(snapshot(coll, false)), 60);
        return () => { listeners[coll] = listeners[coll].filter((f) => f !== next); };
      },
    }),
  });

  let uploads = 0;
  const assets = Object.freeze({
    upload: (blob) => new Promise((resolve) => setTimeout(() => {
      const id = (++uploads).toString(16).padStart(32, "0");
      log.push({ t: stamp(), ev: "upload", id });
      resolve({ id, url: "/_blob/" + id, sizeBytes: blob.size || 0, contentType: blob.type || "image/png" });
    }, UP)),
    delete: (id) => {
      log.push({ t: stamp(), ev: "asset-delete", id });
      return Promise.resolve({ deleted: true });
    },
  });

  window.__mock = {
    store, log,
    peek: (coll, id) => (store[coll].has(id) ? clone(store[coll].get(id)) : null),
    setFail: (v) => { FAIL = !!v; },
  };
  if (q.get("nomock") === "1") return; // behave like a page opened outside claude.ai
  window.claude = Object.freeze({
    use: (name) => new Promise((resolve) => setTimeout(() => resolve(name === "db" ? db : name === "assets" ? assets : null), 30)),
  });
})();
