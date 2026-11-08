/* The scorecard's Worker on Cloudflare (see CLOUDFLARE.md).

   It serves the app's own files, and a small API for the page:
     GET    /api/docs/<collection>        every document in rounds or courses
                                          (sends an ETag; answers 304 when nothing changed)
     PUT    /api/docs/<collection>/<id>   save one document; the JSON body is its data
     DELETE /api/docs/<collection>/<id>   delete one document
     POST   /api/maps                     upload a map image; the body is the image
     GET    /api/maps/<id>                one map image
     DELETE /api/maps/<id>                delete one map image

   Cloudflare Access signs Steve in before anything reaches this Worker. The Worker checks that
   sign-in again on every API call, so the API stays closed even if Access were ever turned off.
   Settings, kept in the Cloudflare dashboard rather than in this public repo:
     ACCESS_TEAM_DOMAIN  e.g. "yourteam.cloudflareaccess.com"
     ACCESS_AUD          the Access application's audience tag
     ALLOWED_EMAILS      who may use the API (comma separated)
   Without all three the API refuses everything.

   Plain JavaScript with no add-ons: Cloudflare runs this file as it is, and the browser checks in
   test/ run the same file against an in-memory database and file store. */

export const COLLECTIONS = ["rounds", "courses"];
export const LIMITS = { doc: 256 * 1024, image: 10 * 1024 * 1024 };
const DOC_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAP_ID = /^[0-9a-f]{32}$/;
const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|heic|heif|avif)$/;

/* Every statement the Worker sends to D1. The test double recognises exactly these. */
export const SQL = {
  init: [
    "CREATE TABLE IF NOT EXISTS docs (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (collection, id))",
    "CREATE TABLE IF NOT EXISTS meta (collection TEXT PRIMARY KEY, version INTEGER NOT NULL)",
  ],
  version: "SELECT version FROM meta WHERE collection = ?1",
  list: "SELECT id, data FROM docs WHERE collection = ?1 ORDER BY id",
  save: "INSERT INTO docs (collection, id, data, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
  remove: "DELETE FROM docs WHERE collection = ?1 AND id = ?2",
  bump: "INSERT INTO meta (collection, version) VALUES (?1, 1) ON CONFLICT (collection) DO UPDATE SET version = version + 1",
};

export default {
  fetch(request, env) {
    return handle(request, env);
  },
};

/* deps lets the checks supply the clock, the network and new ids; Cloudflare uses the defaults. */
export async function handle(request, env, deps) {
  const d = Object.assign({ now: () => Date.now(), fetch: (u) => fetch(u), randomId }, deps || {});
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) {
    return env.ASSETS ? env.ASSETS.fetch(request) : fail(404, "not_found", "No such page.");
  }
  try {
    if (request.headers.get("sec-fetch-site") === "cross-site") {
      return fail(403, "cross_site", "Requests from other sites are refused.");
    }
    const who = await signedIn(request, env, d);
    if (!who.ok) return fail(who.status, who.code, who.message);
    return await api(request, env, url, d);
  } catch (e) {
    return fail(500, "server_error", "Something went wrong on the server. Try again.");
  }
}

/* ---------------- sign-in ---------------- */

const certCache = new Map(); // team domain -> { at, keys: Map(kid -> CryptoKey) }

async function signedIn(request, env, d) {
  const team = String(env.ACCESS_TEAM_DOMAIN || "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const aud = String(env.ACCESS_AUD || "").trim();
  const allowed = String(env.ALLOWED_EMAILS || "").toLowerCase().split(/[\s,;]+/).filter(Boolean);
  if (!team || !aud || !allowed.length) return no(503, "not_configured", "Sign-in isn't set up on the server yet.");
  const out = no(401, "signed_out", "Sign in again to save.");
  const token = request.headers.get("cf-access-jwt-assertion") || cookie(request, "CF_Authorization");
  if (!token) return out;
  const parts = token.split(".");
  if (parts.length !== 3) return out;
  let header, claims;
  try {
    header = JSON.parse(text64(parts[0]));
    claims = JSON.parse(text64(parts[1]));
  } catch (e) {
    return out;
  }
  if (!header || header.alg !== "RS256" || !header.kid || !claims || typeof claims !== "object") return out;
  const key = await accessKey(team, header.kid, d);
  if (!key) return out;
  let good = false;
  try {
    good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, bytes64(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  } catch (e) {
    good = false;
  }
  if (!good) return out;
  const now = Math.floor(d.now() / 1000);
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (auds.indexOf(aud) < 0 || claims.iss !== "https://" + team) return out;
  if (typeof claims.exp !== "number" || claims.exp < now - 30) return no(401, "signed_out", "Your sign-in has run out. Sign in again to save.");
  if (typeof claims.nbf === "number" && claims.nbf > now + 30) return out;
  const email = String(claims.email || "").toLowerCase();
  if (allowed.indexOf(email) < 0) return no(403, "not_granted", "This account can't use the scorecard.");
  return { ok: true, email };
}

/* Cloudflare publishes the keys that sign Access tokens and replaces them every few weeks.
   Keys are kept for an hour; a token signed with an unknown key fetches them again. */
async function accessKey(team, kid, d) {
  const now = d.now();
  let entry = certCache.get(team);
  const stale = !entry || now - entry.at > 3600 * 1000 || (!entry.keys.has(kid) && now - entry.at > 10 * 1000);
  if (stale) {
    const res = await d.fetch("https://" + team + "/cdn-cgi/access/certs");
    if (!res.ok) throw new Error("certs " + res.status);
    const body = await res.json();
    const keys = new Map();
    for (const jwk of (body && body.keys) || []) {
      if (jwk && jwk.kty === "RSA" && jwk.kid && jwk.n && jwk.e) {
        const k = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, ext: true },
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
        keys.set(jwk.kid, k);
      }
    }
    entry = { at: now, keys };
    certCache.set(team, entry);
  }
  return entry.keys.get(kid) || null;
}

/* ---------------- the API ---------------- */

async function api(request, env, url, d) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "docs", coll, id]
  const method = request.method;
  if (parts[1] === "docs") {
    const coll = parts[2];
    if (COLLECTIONS.indexOf(coll) < 0 || parts.length > 4) return fail(404, "not_found", "No such collection.");
    await ready(env.DB);
    if (parts.length === 3) {
      return method === "GET" ? listDocs(request, env, coll) : fail(405, "bad_method", "Not allowed here.");
    }
    let id;
    try { id = decodeURIComponent(parts[3]); } catch (e) { id = ""; }
    if (!DOC_ID.test(id)) return fail(400, "bad_id", "That id isn't valid.");
    if (method === "PUT") return saveDoc(request, env, coll, id, d);
    if (method === "DELETE") return deleteDoc(env, coll, id);
    return fail(405, "bad_method", "Not allowed here.");
  }
  if (parts[1] === "maps") {
    if (parts.length === 2) {
      return method === "POST" ? uploadMap(request, env, d) : fail(405, "bad_method", "Not allowed here.");
    }
    const id = parts[2];
    if (parts.length !== 3 || !MAP_ID.test(id)) return fail(404, "not_found", "No such map image.");
    if (method === "GET") return getMap(env, id);
    if (method === "DELETE") {
      await env.MAPS.delete(id);
      return json(200, { ok: true });
    }
    return fail(405, "bad_method", "Not allowed here.");
  }
  return fail(404, "not_found", "No such address.");
}

const ready_ = new WeakSet();
async function ready(db) {
  if (ready_.has(db)) return;
  await db.batch(SQL.init.map((s) => db.prepare(s)));
  ready_.add(db);
}
const etagOf = (v) => '"v' + v + '"';

async function listDocs(request, env, coll) {
  const row = await env.DB.prepare(SQL.version).bind(coll).first();
  const known = etagOf(row ? row.version : 0);
  if (request.headers.get("if-none-match") === known) {
    return new Response(null, { status: 304, headers: { etag: known, "cache-control": "no-store" } });
  }
  // the version and the documents are read together, so the ETag matches what is sent
  const [v, list] = await env.DB.batch([env.DB.prepare(SQL.version).bind(coll), env.DB.prepare(SQL.list).bind(coll)]);
  const version = v.results && v.results[0] ? v.results[0].version : 0;
  const docs = (list.results || []).map((r) => ({ id: r.id, data: JSON.parse(r.data) }));
  return json(200, { docs, version }, { etag: etagOf(version) });
}

async function saveDoc(request, env, coll, id, d) {
  if (Number(request.headers.get("content-length") || 0) > LIMITS.doc) return fail(413, "too_large", "That's too much to save at once.");
  const body = await request.text();
  if (new TextEncoder().encode(body).length > LIMITS.doc) return fail(413, "too_large", "That's too much to save at once.");
  let data;
  try { data = JSON.parse(body); } catch (e) { return fail(400, "bad_json", "That wasn't valid data."); }
  if (!data || typeof data !== "object" || Array.isArray(data)) return fail(400, "bad_json", "That wasn't valid data.");
  await env.DB.batch([
    env.DB.prepare(SQL.save).bind(coll, id, JSON.stringify(data), d.now()),
    env.DB.prepare(SQL.bump).bind(coll),
  ]);
  return json(200, { ok: true });
}

async function deleteDoc(env, coll, id) {
  await env.DB.batch([env.DB.prepare(SQL.remove).bind(coll, id), env.DB.prepare(SQL.bump).bind(coll)]);
  return json(200, { ok: true });
}

async function uploadMap(request, env, d) {
  const type = String(request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!IMAGE_TYPES.test(type)) return fail(415, "not_an_image", "Map uploads must be images.");
  if (Number(request.headers.get("content-length") || 0) > LIMITS.image) return fail(413, "too_large", "That image is too big; the limit is 10 MB.");
  const body = await request.arrayBuffer();
  if (!body.byteLength) return fail(400, "empty", "The image was empty.");
  if (body.byteLength > LIMITS.image) return fail(413, "too_large", "That image is too big; the limit is 10 MB.");
  const id = d.randomId();
  await env.MAPS.put(id, body, { httpMetadata: { contentType: type } });
  return json(200, { id, url: "/api/maps/" + id, sizeBytes: body.byteLength, contentType: type });
}

async function getMap(env, id) {
  const obj = await env.MAPS.get(id);
  if (!obj) return fail(404, "not_found", "No such map image.");
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (obj.httpEtag) headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "private, max-age=31536000, immutable"); // an id never changes its image
  return new Response(obj.body, { headers });
}

/* ---------------- small helpers ---------------- */

function json(status, body, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, headers || {}),
  });
}
function fail(status, code, message) {
  return json(status, { code, message });
}
function no(status, code, message) {
  return { ok: false, status, code, message };
}
function cookie(request, name) {
  const all = request.headers.get("cookie") || "";
  for (const part of all.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) {
      try { return decodeURIComponent(part.slice(i + 1)); } catch (e) { return ""; }
    }
  }
  return "";
}
function bytes64(s) {
  let b = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  const bin = atob(b);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function text64(s) {
  return new TextDecoder().decode(bytes64(s));
}
function randomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}
