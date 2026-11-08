/* Acceptance checks for the scorecard. Each one loads test/harness.html (the app plus the
   runtime test double) in a phone-sized iframe with a seed, acts on it, and checks the result.
   Serve test/ on localhost, open tests.html (add ?only=<words> to run some), read the list
   or window.__results. */
"use strict";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
window.__results = results;

function openApp(query) {
  return new Promise((resolve) => {
    const old = document.getElementById("app-frame");
    if (old) old.remove();
    const f = document.createElement("iframe");
    f.id = "app-frame";
    f.width = 375;
    f.height = 667;
    f.src = "harness.html?" + query;
    // Python's test server now and then resets a connection mid-page, and a half-loaded frame
    // never fires onload: load it again rather than hang the whole run
    let tries = 0;
    const retry = setInterval(() => {
      if (++tries > 3) { clearInterval(retry); return; }
      f.src = "harness.html?" + query + "&reload=" + tries;
    }, 10000);
    f.onload = async () => {
      clearInterval(retry);
      const win = f.contentWindow, doc = f.contentDocument;
      for (let i = 0; i < 60 && !win.eval("state.loaded"); i++) await wait(50);
      await wait(250);
      resolve({
        win, doc,
        mock: win.__mock,
        $: (s) => doc.querySelector(s),
        $$: (s) => [...doc.querySelectorAll(s)],
        click(s) {
          const el = doc.querySelector(s);
          if (!el) throw new Error("nothing on screen matches " + s);
          el.click();
        },
        js: (code) => win.eval(code),
        toast: () => (doc.querySelector("#toastbox").textContent || "").trim(),
        holeShown: () => { const h = doc.querySelector(".holehead .hnum"); return h ? h.textContent : null; },
      });
    };
    document.getElementById("stage").appendChild(f);
  });
}
function expect(label, actual, wanted) {
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label}: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(wanted)}`);
  }
}
function expectTrue(label, value) {
  if (!value) throw new Error(label);
}
const plus = (p) => `[data-act="score"][data-p="${p}"][data-d="1"]`;
const checks = [];
const check = (name, fn) => checks.push({ name, fn });

/* ---------- 1. course editor ---------- */
check("Editing a course keeps its map images", async () => {
  const a = await openApp("seed=maps");
  a.click('[data-act="tab"][data-tab="courses"]');
  a.click('[data-act="editcourse"]');
  expect("thumbnails shown in the editor", a.$$("#modal .mthumbrow img").length, 2);
  a.click('#modal [data-act="cyclepar"][data-i="3"]');
  a.click('#modal [data-act="savecourse"]');
  await wait(900);
  const c = a.mock.peek("courses", "c_maple");
  expect("hole 4 par after save", c.pars[3], 4);
  expect("map images after save", c.mapAssets.length, 2);
});

/* ---------- 2. redraws on save ---------- */
check("A save doesn't redraw the scorecard or move the screen", async () => {
  const a = await openApp("seed=six");
  const main = a.$("main");
  main.scrollTop = 99999;
  const scrolledTo = main.scrollTop;
  expectTrue("the six-player card should scroll on a 375×667 screen", scrolledTo > 0);
  const btn = a.$(plus(5));
  btn.click();
  await wait(1500);
  expect("stored score for player 6, hole 1", a.mock.peek("rounds", "r_six").scores[5][0], 3);
  expectTrue("the + button was replaced after the save", a.doc.contains(btn));
  expect("scroll position after the save", main.scrollTop, scrolledTo);
});

check("A tap made while a save lands still counts", async () => {
  const a = await openApp("seed=six");
  const tap = (type, el) => {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new a.win.PointerEvent(type, { bubbles: true, pointerId: 7, clientX: r.left + 24, clientY: r.top + 24 }));
  };
  a.click(plus(1));            // first tap: par (3); its save fires 700 ms later
  await wait(650);
  tap("pointerdown", a.$(plus(1)));
  await wait(250);             // the save and its echo land while the finger is down
  tap("pointerup", a.$(plus(1)));
  await wait(1500);
  expect("stored score for player 2, hole 1", a.mock.peek("rounds", "r_six").scores[1][0], 4);
});

check("Changing holes scrolls back to the top; the hole strip follows", async () => {
  const a = await openApp("seed=six");
  const main = a.$("main");
  main.scrollTop = 99999;
  a.click('[data-act="nexthole"]');
  expect("hole shown", a.holeShown(), "Hole 2");
  expect("scroll position after Next", main.scrollTop, 0);
  a.click('[data-act="gohole"][data-i="8"]');
  const strip = a.$(".holestrip"), cur = a.$(".holestrip .cur");
  const s = strip.getBoundingClientRect(), c = cur.getBoundingClientRect();
  expectTrue("hole 9 chip is visible in the strip", c.left >= s.left - 1 && c.right <= s.right + 1);
});

/* ---------- 3. resume ---------- */
check("Reopening mid-round shows the next unplayed hole", async () => {
  const a = await openApp("seed=midround");
  expect("hole shown on open", a.holeShown(), "Hole 6");
});

check("Pause stays paused", async () => {
  const a = await openApp("seed=midround");
  a.click(plus(0));
  a.click('[data-act="exitround"]');
  await wait(1500);
  expect("screen 1.5 s after Pause", a.holeShown(), null);
  expectTrue("the round is listed as in progress", a.$('[data-act="resume"]'));
});

check("Resume picks up at the next unplayed hole", async () => {
  const a = await openApp("seed=midround");
  a.click('[data-act="exitround"]');
  a.click('[data-act="resume"]');
  expect("hole shown after Resume", a.holeShown(), "Hole 6");
});

/* ---------- 4. map uploads ---------- */
check("Adding three map images at once keeps all three", async () => {
  const a = await openApp("seed=maps");
  a.click('[data-act="tab"][data-tab="courses"]');
  a.click('[data-act="maps"]');
  a.click('#mapview [data-act="mapadd"]');
  const files = [1, 2, 3].map((n) => new a.win.File([new Uint8Array([137, 80, 78, 71, n])], `map${n}.png`, { type: "image/png" }));
  await a.js("handleMapFiles")(files);
  await wait(1200);
  expect("map images stored on the course", a.mock.peek("courses", "c_maple").mapAssets.length, 5);
  expect("thumbnails in the viewer", a.$$("#mapview .mthumb").length, 5);
});

check("Adding images in the course editor keeps old and new", async () => {
  const a = await openApp("seed=maps");
  a.click('[data-act="tab"][data-tab="courses"]');
  a.click('[data-act="editcourse"]');
  a.click('#modal [data-act="mapadd"]');
  const files = [1, 2].map((n) => new a.win.File([new Uint8Array([137, 80, 78, 71, n])], `map${n}.png`, { type: "image/png" }));
  await a.js("handleMapFiles")(files);
  expect("thumbnails in the editor", a.$$("#modal .mthumbrow img").length, 4);
  a.click('#modal [data-act="savecourse"]');
  await wait(900);
  expect("map images stored on the course", a.mock.peek("courses", "c_maple").mapAssets.length, 4);
});

/* ---------- 5. stats ---------- */
check("Rounds finished early don't count toward bests or averages", async () => {
  const a = await openApp("seed=partial");
  a.click('[data-act="tab"][data-tab="stats"]');
  const tiles = a.$$(".tile").map((t) => t.querySelector(".k").textContent + " " + t.querySelector(".v").textContent);
  expect("tiles", tiles, ["Rounds 1", "Best vs par +5", "Avg vs par +5.0"]);
  const best = a.$$(".bestlist li").map((li) => li.textContent.replace(/\s+/g, " ").trim());
  expect("course bests", best.length, 1);
  expectTrue("course best is the full round, got " + best[0], best[0].includes("32 (+5)"));
  expectTrue("Stats says a round finished early was left out", /finished early/i.test(a.$("main").textContent));
});

check("Round history marks a round finished early", async () => {
  const a = await openApp("seed=partial");
  a.click('[data-act="tab"][data-tab="history"]');
  const cards = a.$$("main .card").map((c) => c.textContent.replace(/\s+/g, " "));
  expect("rounds listed", cards.length, 2);
  expectTrue("the 3-hole round says thru 3, got " + cards[0], /thru 3/.test(cards[0]));
  expectTrue("the full round has no thru note", !/thru/.test(cards[1]));
});

/* ---------- 6. weak signal ---------- */
check("A failed save keeps the score on screen and saves once back online", async () => {
  const a = await openApp("seed=midround&fail=1");
  a.click(plus(0));                         // hole 6 is shown; enter a 3
  await wait(1600);
  expect("score on screen after the failed save", a.$("#sv-0").firstChild.textContent, "3");
  expect("stored score while offline", a.mock.peek("rounds", "r_mid").scores[0][5], null);
  a.mock.setFail(false);
  a.win.dispatchEvent(new a.win.Event("online"));
  await wait(1200);
  expect("stored score once back online", a.mock.peek("rounds", "r_mid").scores[0][5], 3);
});

check("A failed save is retried without another tap", async () => {
  const a = await openApp("seed=midround&fail=1");
  a.click(plus(0));
  await wait(1300);                         // first attempt has failed
  a.mock.setFail(false);
  await wait(3500);                         // first retry is due about 2 s after the failure
  expect("stored score after the retry", a.mock.peek("rounds", "r_mid").scores[0][5], 3);
});

check("Finishing without signal says so, and saves once back online", async () => {
  const a = await openApp("seed=midround&fail=1");
  a.click('[data-act="finish"]');
  a.click('#modal [data-act="dofinish"]');
  await wait(1200);
  expectTrue("toast should not claim it saved, got: " + a.toast(), !/Round saved/.test(a.toast()));
  expect("stored status while offline", a.mock.peek("rounds", "r_mid").status, "active");
  a.mock.setFail(false);
  a.win.dispatchEvent(new a.win.Event("online"));
  await wait(1200);
  expect("stored status once back online", a.mock.peek("rounds", "r_mid").status, "done");
});

check("Scores not yet saved survive closing the app", async () => {
  let a = await openApp("seed=midround&fail=1");
  a.click(plus(0));
  a.click(plus(1));
  await wait(300);                          // closed before any save could land
  a = await openApp("seed=midround");      // reopened with signal; the store never got them
  await wait(1200);
  expect("hole shown after reopening (hole 6 is now scored)", a.holeShown(), "Hole 7");
  const r = a.mock.peek("rounds", "r_mid");
  expect("stored scores for hole 6 after reopening", [r.scores[0][5], r.scores[1][5]], [3, 3]);
});

/* ---------- 7. normal paths still work ---------- */
check("A new round can be started, scored and finished", async () => {
  const a = await openApp("seed=maps");
  a.click('[data-act="newround"]');
  a.click('[data-act="pickcourse"]');
  a.click('[data-act="startround"]');
  expect("hole shown", a.holeShown(), "Hole 1");
  a.click(plus(0));
  a.click(plus(0));
  a.click('[data-act="finish"]');
  a.click('#modal [data-act="dofinish"]');
  await wait(1200);
  const id = a.js("state.rounds[0].id");
  const r = a.mock.peek("rounds", id);
  expect("stored round", { status: r.status, hole1: r.scores[0][0] }, { status: "done", hole1: 4 });
  expectTrue("toast says it saved, got: " + a.toast(), /Round saved/.test(a.toast()));
});

check("Discarding a round removes it for good", async () => {
  const a = await openApp("seed=midround");
  a.click(plus(0));
  a.click('[data-act="discard"]');
  a.click('#modal [data-act="dodiscard"]');
  await wait(1500);
  expect("stored round", a.mock.peek("rounds", "r_mid"), null);
  expect("screen", a.holeShown(), null);
  expect("in-progress list", a.$$('[data-act="resume"]').length, 0);
});

check("A viewer who can't write gets the view-only notice, not endless retries", async () => {
  const a = await openApp("seed=midround");
  // the platform rejects writes below a viewer's level with invalid_argument
  a.js(`DB = { doc: () => ({ set: () => Promise.reject({ code: "invalid_argument", message: "below write level" }), delete: () => Promise.reject({ code: "invalid_argument", message: "below write level" }) }) }`);
  a.click(plus(0));
  await wait(1200);
  expectTrue("view-only banner shown", /view-only/i.test(a.$("main").textContent));
  expect("changes left queued on the device", localStorage.getItem("dg.outbox.v1"), null);
});

check("The app starts with no server to save to (a plain page)", async () => {
  const a = await openApp("nomock=1");
  expect("API stand-in installed", a.mock.installed, false);
  expect("data status", a.js("state.dbStatus"), "local");
  expectTrue("no error toast, got: " + a.toast(), !/broke/i.test(a.toast()));
  a.click('[data-act="newround"]');
  expectTrue("setup screen shown", a.$('[data-act="startround"]'));
});

/* ---------- 8. on Cloudflare (CLOUDFLARE.md) ---------- */
check("Signed out mid-round: scores stay on the phone and save after signing in", async () => {
  const a = await openApp("seed=midround");
  a.mock.setSignedOut("401");               // Cloudflare's sign-in has run out
  a.click(plus(0));                         // hole 6: enter a 3; its save is refused
  await wait(1200);
  expect("score on screen", a.$("#sv-0").firstChild.textContent, "3");
  expect("stored score while signed out", a.mock.peek("rounds", "r_mid").scores[0][5], null);
  expectTrue("the top bar says signed out, got: " + a.$("#syncnote").textContent, /signed out/i.test(a.$("#syncnote").textContent));
  expectTrue("a Sign in button is offered", a.$('[data-act="signin"]'));
  a.mock.setSignedOut("");                  // signed in again
  a.win.dispatchEvent(new a.win.Event("online"));
  await wait(800);
  expect("stored score once signed in", a.mock.peek("rounds", "r_mid").scores[0][5], 3);
  expectTrue("the signed-out note is gone, got: " + a.$("#syncnote").textContent, !/signed out/i.test(a.$("#syncnote").textContent));
});

check("Cloudflare's redirect to its sign-in page counts as signed out, not as no signal", async () => {
  const a = await openApp("seed=midround");
  a.mock.setSignedOut("redirect");
  a.click(plus(0));
  await wait(1200);
  expectTrue("the top bar says signed out, got: " + a.$("#syncnote").textContent, /signed out/i.test(a.$("#syncnote").textContent));
  expect("stored score while signed out", a.mock.peek("rounds", "r_mid").scores[0][5], null);
});

check("Opened with no signal, the app still shows the round this phone last saw", async () => {
  let a = await openApp("seed=midround");   // a normal visit keeps a copy on the phone
  expect("hole shown on the first visit", a.holeShown(), "Hole 6");
  a = await openApp("seed=midround&offline=1"); // reopened with no signal at all
  expect("hole shown with no signal", a.holeShown(), "Hole 6");
  expect("rounds on screen", a.js("state.rounds.length"), 1);
});

check("A copy kept from another server is never shown as current", async () => {
  let a = await openApp("seed=maps");       // this phone keeps a copy with no rounds in it
  expect("rounds on the first server", a.js("state.rounds.length"), 0);
  a = await openApp("seed=midround");       // a different server (a recreated database) has one
  expect("hole shown from the new server", a.holeShown(), "Hole 6");
});

check("Map images load from the scorecard's own address", async () => {
  const a = await openApp("seed=maps");
  a.click('[data-act="tab"][data-tab="courses"]');
  a.click('[data-act="maps"]');
  expect("map viewer image", a.$("#mapimg").getAttribute("src"), "/api/maps/" + "a".repeat(32));
  a.click('#mapview [data-act="mapclose"]');
  a.click('[data-act="editcourse"]');
  expect("editor thumbnails", a.$$("#modal .mthumbrow img").map((i) => i.getAttribute("src")),
    ["/api/maps/" + "a".repeat(32), "/api/maps/" + "b".repeat(32)]);
});

check("A server that answers with a problem says so, not \"no connection\"", async () => {
  // what Steve saw at the first deploy: the sign-in settings hadn't reached the server
  const a = await openApp("seed=midround");
  a.mock.setServer("503");
  a.click(plus(0));
  await wait(1500);                              // the save fires after 700 ms and is refused
  expect("top bar", a.$("#syncnote").textContent, "server problem — kept on this phone");
  expectTrue("the toast doesn't blame the signal: " + a.toast(), !/no connection/i.test(a.toast()));
  expectTrue("the toast gives the server's own words: " + a.toast(), /Sign-in isn't set up on the server yet/.test(a.toast()));
  expectTrue("the banner gives the server's own words", /Sign-in isn't set up on the server yet/.test(a.$("#main").textContent));
  expect("the score stays on screen", a.js("state.rounds.find(r => r.id === 'r_mid').scores[0][5]"), 3);
  a.mock.setServer("");                          // fixed in the dashboard
  await wait(3500);                              // the first retry comes about 2 s after the refusal
  expect("stored score for player 1, hole 6", a.mock.peek("rounds", "r_mid").scores[0][5], 3);
  expect("top bar once the server is fixed", a.$("#syncnote").textContent, "");
  expectTrue("the banner is gone once the server is fixed", !/isn't set up/.test(a.$("#main").textContent));
  // opened while the server has a problem: the screen says so instead of looking empty
  const b = await openApp("seed=maps&server=500");
  expect("top bar on opening", b.$("#syncnote").textContent, "server problem — kept on this phone");
  expectTrue("the banner on opening", /Something went wrong on the server/.test(b.$("#main").textContent));
});

/* ---------- 9. Home Screen and full screen ---------- */
// The manifest and icons live in public/ beside the page; make_harness.py copies them next to
// the harness, so they resolve against the page the way they will on Cloudflare.
function loadImage(url) {
  return new Promise((ok, bad) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => bad(new Error("no image at " + url));
    img.src = url;
  });
}
function cornerColour(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(2, 2, 1, 1).data;
  return "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}
const metaOf = (a, name) => { const m = a.$(`meta[name="${name}"]`); return m ? m.getAttribute("content") : null; };

check("Added to the Home Screen, it shows the basket icon and the name Disc Golf", async () => {
  const a = await openApp("seed=empty");
  const link = a.$('link[rel="apple-touch-icon"]');
  expectTrue("the page names a Home Screen icon", link);
  const img = await loadImage(new URL(link.getAttribute("href"), a.doc.baseURI).href);
  expect("icon size", [img.naturalWidth, img.naturalHeight], [180, 180]);
  expect("icon background (bottle green)", cornerColour(img), "#1F4A34");
  expect("name under the icon", metaOf(a, "apple-mobile-web-app-title"), "Disc Golf");
  const tab = a.$('link[rel="icon"]');
  expectTrue("the browser tab shows the basket too", tab);
  await loadImage(new URL(tab.getAttribute("href"), a.doc.baseURI).href);
});

check("Opened from the Home Screen, it runs full screen like an app", async () => {
  const a = await openApp("seed=empty");
  expect("full screen on an iPhone", metaOf(a, "apple-mobile-web-app-capable"), "yes");
  expect("full screen on other phones", metaOf(a, "mobile-web-app-capable"), "yes");
  expectTrue("the page reaches under the notch and the home bar", /viewport-fit=cover/.test(metaOf(a, "viewport") || ""));
  const link = a.$('link[rel="manifest"]');
  expectTrue("the page names a web-app manifest", link);
  // Cloudflare's sign-in turns away a manifest fetched without the sign-in cookie
  expect("the manifest is fetched signed in", link.getAttribute("crossorigin"), "use-credentials");
  const at = new URL(link.getAttribute("href"), a.doc.baseURI);
  const res = await fetch(at.href, { credentials: "include" });
  expectTrue("the manifest is served", res.ok);
  const m = await res.json();
  expect("display", m.display, "standalone");
  expect("name", m.name, "Disc Golf Scorecard");
  expect("short name", m.short_name, "Disc Golf");
  const home = new URL("./", at).href;
  expect("opens on the scorecard's own page", new URL(m.start_url, at).href, home);
  expect("stays inside the scorecard", new URL(m.scope, at).href, home);
  expect("splash colour (Clubhouse cream)", String(m.background_color).toUpperCase(), "#F3EEE2");
  const sizes = [];
  for (const i of m.icons || []) {
    const img = await loadImage(new URL(i.src, at).href);
    expect(i.src + " size", img.naturalWidth + "x" + img.naturalHeight, i.sizes);
    expect(i.src + " background (bottle green)", cornerColour(img), "#1F4A34");
    sizes.push(i.sizes);
  }
  expect("icon sizes in the manifest", sizes.sort(), ["192x192", "512x512"]);
  // with the page under the notch, the bars pad themselves clear of it and of the home bar
  const rules = [...a.doc.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch (e) { return []; } });
  const css = (sel) => { const r = rules.find((x) => x.selectorText === sel); return r ? r.style.cssText : ""; };
  expectTrue("the top bar clears the notch", /safe-area-inset-top/.test(css("header.topbar")));
  expectTrue("the tab bar clears the home bar", /safe-area-inset-bottom/.test(css("nav.tabs")));
});

check("The phone's status bar takes the look's colour, Clubhouse or Twilight", async () => {
  const bar = (a) => metaOf(a, "theme-color");
  const page = (a) => a.win.getComputedStyle(a.doc.body).backgroundColor;
  const rgb = (a, colour) => {
    const s = a.doc.createElement("i");
    s.style.color = colour;
    a.doc.body.appendChild(s);
    const c = a.win.getComputedStyle(s).color;
    s.remove();
    return c;
  };
  const cream = "rgb(243, 238, 226)", twilight = "rgb(14, 21, 17)";
  // iOS draws its own bar, tinted with this colour, so the clock stays readable in both looks
  let a = await openApp("seed=empty");
  expect("status bar style", metaOf(a, "apple-mobile-web-app-status-bar-style"), "default");
  expectTrue("the page names a status bar colour", bar(a));
  expect("page in Clubhouse", page(a), cream);
  expect("status bar in Clubhouse", rgb(a, bar(a)), cream);
  a.click('[data-act="settings"]');
  a.click('#modal [data-act="setlook"][data-look="twilight"]');
  expect("page after choosing Twilight", page(a), twilight);
  expect("status bar after choosing Twilight", rgb(a, bar(a)), twilight);
  a = await openApp("seed=empty");          // Twilight is kept on this phone
  expect("page on reopening", page(a), twilight);
  expect("status bar on reopening", rgb(a, bar(a)), twilight);
  a.click('[data-act="settings"]');
  a.click('#modal [data-act="setlook"][data-look="clubhouse"]');
  expect("status bar back in Clubhouse", rgb(a, bar(a)), cream);
});

/* ---------- runner ---------- */
(async () => {
  const only = new URLSearchParams(location.search).get("only");
  // the Cloudflare Worker's checks (worker-tests.js) run first; they need no app frame
  for (const c of (window.workerChecks || []).concat(checks)) {
    if (only && !c.name.toLowerCase().includes(only.toLowerCase())) continue;
    try { localStorage.clear(); } catch (e) { /* no storage */ }
    let ok = true, msg = "";
    try { await c.fn(); } catch (e) { ok = false; msg = (e && e.message) || String(e); }
    results.push({ name: c.name, ok, msg });
    const li = document.createElement("li");
    li.className = ok ? "pass" : "fail";
    li.textContent = (ok ? "PASS  " : "FAIL  ") + c.name + (msg ? " — " + msg : "");
    document.getElementById("out").appendChild(li);
  }
  const failed = results.filter((r) => !r.ok).length;
  document.getElementById("sum").textContent = failed ? `${failed} of ${results.length} failing` : `all ${results.length} passing`;
  window.__done = true;
})();
