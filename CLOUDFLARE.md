# Moving the scorecard to Cloudflare

Agreed with Steve on 2026-11-07, and the plan approved the same day.

**Where it stands.** Steps 1 to 3 are done; all 39 checks pass.
- **Step 1:** the Worker (`worker/index.js`), its settings (`wrangler.jsonc`) and 12 checks.
- **Step 2:** the page (now `public/index.html`) saves through the Worker's API.
  - It keeps the last copy on the phone, so it opens with no signal.
  - It treats a lapsed sign-in like a dropped signal: nothing is lost, and the Sign in button
    brings back Cloudflare's sign-in page.
  - The checks run it against `test/mock-api.js`, a stand-in for the API.
  - Step 2 found one real bug. A phone's kept copy from one database could have passed for current
    on a recreated database, because both counted versions from zero. Each database now has a
    random tag in its ETag, and two new checks cover it.
- **Step 3:** the Home Screen and full screen, with 3 checks.
  - `public/manifest.webmanifest` gives the name "Disc Golf", the icons and full screen. The page
    fetches it with the sign-in cookie, since Access turns away a request without one.
  - The icon is now a file: `public/icons/apple-touch-icon.png` for the iPhone, and 192 and 512
    sizes for the manifest. `design/app-icon.ps1` writes all three.
  - The phone's status bar takes the look's background, in Clubhouse and in Twilight.

Some things can only be tried on Cloudflare itself, at step 4:
- the SQL against a real D1 database (the checks use a stand-in);
- a real Access sign-in token (the checks sign their own the same way);
- on the iPhone: the icon and name on the Home Screen, full screen, the status bar in both looks,
  and signing in from the Home Screen app.

If the Home Screen shows a letter or a screenshot instead of the basket, iOS fetched the icon
without the sign-in cookie. The fix is an Access rule that lets anyone fetch `/icons/*` and
`/manifest.webmanifest`, which hold nothing private.

Next: step 4.

## Why

The scorecard runs inside claude.ai, so iOS takes its Home Screen icon and title from claude.ai's
page, not from ours. The family calendar (Goose & Co.) runs as its own site on Cloudflare, which is
why its logo works on every device. Moving the scorecard there gives it:
- its own web address;
- the basket icon on the Home Screen;
- full-screen use, like an installed app.

## Decisions

- **Sign-in: Steve only.** Cloudflare Access sits in front of the whole site, the same kind of
  sign-in the calendar uses. Friends never open the app.
- **Address: the free Cloudflare one**, something like `disc-golf.<account>.workers.dev`.
- **When: before redesign slice 2** (the player roster). The roster changes saved data, so the
  data moves once, and slices 2 to 4 are built on Cloudflare.
- **The Claude artifact is left untouched**, with all its data, as it is today. Nothing is
  written to it during or after the move.

## How it's built

Nothing gets installed on Steve's PC. Cloudflare builds and deploys from the GitHub repo itself.

- **One Worker** serves the app's page, the icons and the web-app manifest, plus a small API:
  - list, save and delete rounds and courses;
  - upload, show and delete map images.
- **D1** (Cloudflare's database) holds rounds and courses, one row per document, the same shape
  as today. **R2** (Cloudflare's file storage) holds map images.
- **The page changes very little.** A small adapter gives it the same `doc().set()` /
  `collection().onSnapshot()` interface it uses now. So the outbox, retries, offline handling and
  every fix in `FINDINGS.md` stay as they are.
  - The page picks up changes when it opens, when it comes back to the front, every 30 seconds
    while it's open, and after each save. That suits one phone keeping score.
- **Signed out is not lost.** If Cloudflare's sign-in lapses mid-round:
  - scores stay on the phone, as they do offline;
  - the top bar says to sign in again;
  - nothing is sent until you do.
  The calendar audit lists this as a real failure ("Clearance expired"), so it gets its own check.
- **The Worker checks the sign-in itself** as well as Cloudflare Access, so the API is closed
  even if Access were ever switched off.
- **Publishing stays in Steve's hands.** Cloudflare deploys only from a `live` branch. Work lands
  on `main` as now. "Publish" means moving `live` up to `main`, done only when Steve says so.

## Testing

Still only Python and a browser.
- The test harness swaps `mock-claude.js` for a stand-in of the new API, with the same behaviour
  (each save echoed, failures on demand). The 19 checks keep passing.
- New checks cover:
  - sign-in lapsing mid-round;
  - map images loading from the new address;
  - the manifest and icon.
- The Worker is plain JavaScript with no add-ons. The checks load it in the browser with an
  in-memory database and file store, so its API is tested before it ever reaches Cloudflare.

## Moving the data

1. **Export.** Claude reads the artifact's rounds, courses and map images, read-only, into a
   folder on Steve's PC that git ignores. Disc golf scores are read through the model to do this.
   Nothing is written back to the artifact.
2. **Import.** A one-time import page on the new site, behind the sign-in, takes that folder.
3. **Check.** Count rounds, courses and map images on both sides. Open a few full scorecards and
   compare totals. Steve then plays one round on the new address before the old one is retired
   from use.

## Steve's one-time setup (about 15 minutes, in the Cloudflare dashboard)

Claude writes exact click-by-click steps when it's time:
1. Create a D1 database `disc-golf` and an R2 bucket `disc-golf-maps`. Send Claude the
   database's id, which isn't a secret.
2. Workers & Pages → Create → import the GitHub repo `stovenmann/Disc-Golf-Tracker`, deploying
   from the `live` branch.
3. Zero Trust → Access: protect the new address and allow only Steve's email.

## Build order

1. Worker, database and API, with browser checks.
2. The page talks to the new API; the harness uses the new stand-in; all checks pass.
3. Manifest, icons and full-screen settings.
4. Steve's dashboard setup and the first publish. Then, on his iPhone: sign in, add it to the
   Home Screen, and open it from there.
5. Export, import, compare. Steve checks his data on the phone.

Then redesign slice 2 (the roster) continues on Cloudflare.
