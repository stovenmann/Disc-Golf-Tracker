/* Checks for the Cloudflare Worker (worker/index.js), run in the browser with tests.html.
   make_harness.py copies the Worker to test/worker.js; each check imports a fresh copy, so its
   cached sign-in keys never leak between checks. D1 and R2 are in-memory stand-ins that answer
   exactly the statements the Worker sends. Sign-in tokens are made here with a throwaway key,
   the way Cloudflare Access signs them. All names, addresses and data are made up. */
"use strict";
(function () {
  const TEAM = "scorecard-test.cloudflareaccess.com";
  const AUD = "aud-scorecard-test";
  const ME = "keeper@example.com";
  const BASE = "https://disc-golf.example.workers.dev";
  const NOW = Date.UTC(2026, 10, 7, 15, 0, 0);
  const sec = () => Math.floor(NOW / 1000);

  const same = (label, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${label}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  };
  const truly = (label, v) => { if (!v) throw new Error(label); };
  let n = 0;
  const loadWorker = () => import("./worker.js?fresh=" + Date.now() + "-" + (++n));

  function b64url(bytes) {
    let s = "";
    bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  /* a stand-in for Cloudflare Access: a signing key, its published certs, and tokens */
  async function accessKit() {
    const kit = { keys: [], fetches: 0 };
    kit.addKey = async () => {
      const pair = await crypto.subtle.generateKey(
        { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true, ["sign", "verify"]);
      const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
      const key = { kid: "k" + Math.random().toString(36).slice(2, 10), pair, jwk };
      kit.keys.push(key);
      return key;
    };
    kit.fetch = async (url) => {
      kit.fetches++;
      if (url !== "https://" + TEAM + "/cdn-cgi/access/certs") return new Response("not found", { status: 404 });
      const keys = kit.keys.map((k) => ({ kid: k.kid, kty: "RSA", alg: "RS256", use: "sig", n: k.jwk.n, e: k.jwk.e }));
      return new Response(JSON.stringify({ keys }), { headers: { "content-type": "application/json" } });
    };
    kit.token = async (over, opts) => {
      const o = opts || {};
      const key = o.key || kit.keys[0];
      const claims = Object.assign({ aud: [AUD], iss: "https://" + TEAM, email: ME, sub: "user-1", type: "app",
        iat: sec() - 60, nbf: sec() - 60, exp: sec() + 3600 }, over || {});
      const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
      const input = enc({ alg: "RS256", kid: o.kid || key.kid, typ: "JWT" }) + "." + enc(claims);
      const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", (o.signWith || key).pair.privateKey, new TextEncoder().encode(input));
      return input + "." + b64url(new Uint8Array(sig));
    };
    await kit.addKey();
    return kit;
  }
  /* D1 stand-in: recognises exactly the Worker's statements (W.SQL) and nothing else */
  function fakeD1(W) {
    const docs = new Map(), meta = new Map();
    const key = (c, id) => c + "\u0000" + id;
    const run = (sql, a) => {
      if (W.SQL.init.indexOf(sql) >= 0) return { results: [] };
      if (sql === W.SQL.version) return { results: meta.has(a[0]) ? [{ version: meta.get(a[0]) }] : [] };
      if (sql === W.SQL.list) {
        const rows = [];
        docs.forEach((v, k) => { const [c, id] = k.split("\u0000"); if (c === a[0]) rows.push({ id, data: v.data }); });
        return { results: rows.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)) };
      }
      if (sql === W.SQL.save) { docs.set(key(a[0], a[1]), { data: a[2], updated_at: a[3] }); return { results: [] }; }
      if (sql === W.SQL.remove) { docs.delete(key(a[0], a[1])); return { results: [] }; }
      if (sql === W.SQL.bump) { meta.set(a[0], (meta.get(a[0]) || 0) + 1); return { results: [] }; }
      throw new Error("D1 stand-in: unexpected statement " + sql);
    };
    const stmt = (sql, a) => ({
      sql, a: a || [],
      bind: (...args) => stmt(sql, args),
      first: async () => run(sql, a || []).results[0] || null,
      all: async () => run(sql, a || []),
      run: async () => run(sql, a || []),
    });
    return { docs, prepare: (sql) => stmt(sql), batch: async (list) => list.map((s) => run(s.sql, s.a)) };
  }
  function fakeR2() {
    const files = new Map();
    return {
      files,
      put: async (k, body, opts) => {
        files.set(k, { bytes: new Uint8Array(body), type: opts && opts.httpMetadata && opts.httpMetadata.contentType });
        return {};
      },
      get: async (k) => {
        const f = files.get(k);
        if (!f) return null;
        return { body: f.bytes, httpEtag: '"' + k.slice(0, 8) + '"', size: f.bytes.length,
          writeHttpMetadata: (h) => { if (f.type) h.set("content-type", f.type); } };
      },
      delete: async (k) => { files.delete(k); },
    };
  }
  async function setup(over) {
    const W = await loadWorker();
    const kit = await accessKit();
    const env = Object.assign({
      DB: fakeD1(W), MAPS: fakeR2(),
      ASSETS: { fetch: async (req) => new Response("app file " + new URL(req.url).pathname) },
      ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ALLOWED_EMAILS: ME,
    }, over || {});
    let ids = 0;
    const deps = { now: () => NOW, fetch: kit.fetch, randomId: () => (++ids).toString(16).padStart(32, "0") };
    const token = await kit.token();
    const call = async (method, path, o) => {
      const opts = o || {};
      const headers = new Headers(opts.headers || {});
      const t = opts.token === undefined ? token : opts.token;
      if (t) headers.set("cf-access-jwt-assertion", t);
      const init = { method, headers };
      if (opts.body !== undefined) init.body = opts.body;
      const res = await W.handle(new Request(BASE + path, init), env, deps);
      let body = null;
      const type = res.headers.get("content-type") || "";
      if (type.indexOf("json") >= 0) body = await res.json();
      return { res, status: res.status, body };
    };
    /* a request-like object, for headers a browser won't let a script set (Cookie, Sec-Fetch-Site) */
    const callRaw = async (method, path, headerObj) =>
      W.handle({ url: BASE + path, method, headers: new Headers(headerObj) }, env, deps);
    return { W, kit, env, deps, token, call, callRaw };
  }
  const putJSON = (data) => ({ body: JSON.stringify(data), headers: { "content-type": "application/json" } });
  const sampleRound = {
    courseId: "c_oak", courseName: "Oak Bend", pars: [3, 3, 4], players: ["Ari", "Bo"],
    scores: { 0: [3, 2, null], 1: [4, 3, null] }, status: "active", date: "2026-11-07T14:00:00.000Z",
  };

  const checks = [];
  const check = (name, fn) => checks.push({ name: "Worker: " + name, fn });

  check("the API refuses anyone who isn't signed in", async () => {
    const t = await setup();
    const none = await t.call("GET", "/api/docs/rounds", { token: "" });
    same("status with no sign-in", [none.status, none.body.code], [401, "signed_out"]);
    const junk = await t.call("GET", "/api/docs/rounds", { token: "not.a.token" });
    same("status with a junk token", [junk.status, junk.body.code], [401, "signed_out"]);
    const page = await t.call("GET", "/", { token: "" });
    same("the app's own page is served (Access guards it)", await page.res.text(), "app file /");
  });

  check("an expired, forged or other-app sign-in is refused", async () => {
    const t = await setup();
    const expired = await t.call("GET", "/api/docs/rounds", { token: await t.kit.token({ exp: sec() - 120 }) });
    same("expired", [expired.status, expired.body.code], [401, "signed_out"]);
    truly("an expired sign-in says it ran out, got " + expired.body.message, /run out/.test(expired.body.message));
    const stranger = await t.kit.addKey();
    t.kit.keys.pop(); // a key Cloudflare never published, posing as the real one
    const forged = await t.call("GET", "/api/docs/rounds", { token: await t.kit.token({}, { signWith: stranger }) });
    same("signed with the wrong key", forged.status, 401);
    const otherApp = await t.call("GET", "/api/docs/rounds", { token: await t.kit.token({ aud: ["some-other-app"] }) });
    same("another Access app's sign-in", otherApp.status, 401);
    const otherTeam = await t.call("GET", "/api/docs/rounds", { token: await t.kit.token({ iss: "https://elsewhere.cloudflareaccess.com" }) });
    same("another team's sign-in", otherTeam.status, 401);
  });

  check("only the allowed account gets in", async () => {
    const t = await setup();
    const other = await t.call("GET", "/api/docs/rounds", { token: await t.kit.token({ email: "someone@example.com" }) });
    same("another account", [other.status, other.body.code], [403, "not_granted"]);
    const caps = await t.call("GET", "/api/docs/rounds", { token: await t.kit.token({ email: ME.toUpperCase() }) });
    same("the allowed account, in capitals", caps.status, 200);
  });

  check("with sign-in not set up, the API stays closed", async () => {
    for (const missing of ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "ALLOWED_EMAILS"]) {
      const t = await setup({ [missing]: "" });
      const r = await t.call("GET", "/api/docs/rounds");
      same("status without " + missing, [r.status, r.body.code], [503, "not_configured"]);
    }
  });

  check("the sign-in cookie works too, and other sites are turned away", async () => {
    const t = await setup();
    const viaCookie = await t.callRaw("GET", "/api/docs/courses", { cookie: "theme=dark; CF_Authorization=" + t.token });
    same("signed in by cookie", viaCookie.status, 200);
    const cross = await t.callRaw("GET", "/api/docs/courses", { "cf-access-jwt-assertion": t.token, "sec-fetch-site": "cross-site" });
    same("a request from another site", cross.status, 403);
  });

  check("rounds and courses save, list and delete", async () => {
    const t = await setup();
    same("empty at first", (await t.call("GET", "/api/docs/rounds")).body.docs, []);
    same("save a round", (await t.call("PUT", "/api/docs/rounds/r_one", putJSON(sampleRound))).status, 200);
    same("save a course", (await t.call("PUT", "/api/docs/courses/c_oak", putJSON({ name: "Oak Bend", pars: [3, 3, 4] }))).status, 200);
    same("the round comes back exactly, nulls and all", (await t.call("GET", "/api/docs/rounds")).body.docs, [{ id: "r_one", data: sampleRound }]);
    const changed = Object.assign({}, sampleRound, { status: "done" });
    await t.call("PUT", "/api/docs/rounds/r_one", putJSON(changed));
    same("a second save replaces the first", (await t.call("GET", "/api/docs/rounds")).body.docs, [{ id: "r_one", data: changed }]);
    same("delete", (await t.call("DELETE", "/api/docs/rounds/r_one")).status, 200);
    same("gone after delete", (await t.call("GET", "/api/docs/rounds")).body.docs, []);
    same("courses kept apart from rounds", (await t.call("GET", "/api/docs/courses")).body.docs.length, 1);
  });

  check("bad saves are refused and change nothing", async () => {
    const t = await setup();
    same("unknown collection", (await t.call("GET", "/api/docs/secrets")).status, 404);
    same("bad id", (await t.call("PUT", "/api/docs/rounds/" + encodeURIComponent("../x"), putJSON(sampleRound))).status, 400);
    same("not JSON", (await t.call("PUT", "/api/docs/rounds/r_two", { body: "{oops", headers: { "content-type": "application/json" } })).status, 400);
    same("a list instead of an object", (await t.call("PUT", "/api/docs/rounds/r_two", putJSON([1, 2]))).status, 400);
    const huge = { note: "x".repeat(t.W.LIMITS.doc) };
    same("too big", (await t.call("PUT", "/api/docs/rounds/r_two", putJSON(huge))).status, 413);
    same("nothing was stored", (await t.call("GET", "/api/docs/rounds")).body.docs, []);
  });

  check("an unchanged list costs almost nothing", async () => {
    const t = await setup();
    await t.call("PUT", "/api/docs/rounds/r_one", putJSON(sampleRound));
    const first = await t.call("GET", "/api/docs/rounds");
    const tag = first.res.headers.get("etag");
    truly("the list has an ETag", tag);
    const again = await t.call("GET", "/api/docs/rounds", { headers: { "if-none-match": tag } });
    same("asking again with no change", again.status, 304);
    await t.call("PUT", "/api/docs/rounds/r_two", putJSON(sampleRound));
    const after = await t.call("GET", "/api/docs/rounds", { headers: { "if-none-match": tag } });
    same("after a save", [after.status, after.body.docs.length], [200, 2]);
    const tag2 = after.res.headers.get("etag");
    await t.call("DELETE", "/api/docs/rounds/r_one");
    same("after a delete", (await t.call("GET", "/api/docs/rounds", { headers: { "if-none-match": tag2 } })).status, 200);
  });

  check("map images upload, load and delete", async () => {
    const t = await setup();
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const up = await t.call("POST", "/api/maps", { body: png, headers: { "content-type": "image/png" } });
    same("upload", up.status, 200);
    truly("upload returns a 32-character id, got " + up.body.id, /^[0-9a-f]{32}$/.test(up.body.id));
    same("upload answers like Claude's assets did", [up.body.url, up.body.sizeBytes, up.body.contentType], ["/api/maps/" + up.body.id, 11, "image/png"]);
    const got = await t.call("GET", up.body.url);
    same("served as an image", got.res.headers.get("content-type"), "image/png");
    same("same bytes back", Array.from(new Uint8Array(await got.res.arrayBuffer())), Array.from(png));
    truly("cached on the phone, since an id never changes", /immutable/.test(got.res.headers.get("cache-control")));
    same("delete", (await t.call("DELETE", up.body.url)).status, 200);
    same("gone after delete", (await t.call("GET", up.body.url)).status, 404);
    same("not an image", (await t.call("POST", "/api/maps", { body: "hello", headers: { "content-type": "text/plain" } })).status, 415);
    const big = new Uint8Array(t.W.LIMITS.image + 1);
    same("too big", (await t.call("POST", "/api/maps", { body: big, headers: { "content-type": "image/jpeg" } })).status, 413);
    same("a made-up id", (await t.call("GET", "/api/maps/not-an-id")).status, 404);
    same("refused uploads stored nothing", t.env.MAPS.files.size, 0);
  });

  check("a new Cloudflare signing key is picked up by itself", async () => {
    const t = await setup();
    for (let i = 0; i < 3; i++) same("call " + (i + 1), (await t.call("GET", "/api/docs/rounds")).status, 200);
    same("keys fetched once for three calls", t.kit.fetches, 1);
    const fresh = await t.kit.addKey(); // Cloudflare rotates its keys every few weeks
    let later = NOW + 60 * 1000;
    t.deps.now = () => later;
    const rotated = await t.call("GET", "/api/docs/rounds", { token: await t.kit.token({ iat: sec(), exp: sec() + 3600 }, { key: fresh }) });
    same("a token signed with the new key", rotated.status, 200);
    same("keys fetched again once", t.kit.fetches, 2);
    same("the old key still works meanwhile", (await t.call("GET", "/api/docs/rounds")).status, 200);
  });

  check("a failure on the server is reported as one, not as signed out", async () => {
    const t = await setup();
    t.deps.fetch = async () => { throw new TypeError("network down"); };
    const r = await t.call("GET", "/api/docs/rounds");
    same("Cloudflare's keys unreachable", [r.status, r.body.code], [500, "server_error"]);
  });

  window.workerChecks = checks;
})();
