# Moving the scorecard to Cloudflare

Agreed with Steve on 2026-11-07, and the plan approved the same day. Step 1 is in progress.

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
4. Steve's dashboard setup, the first publish, and sign-in tried on his iPhone.
5. Export, import, compare. Steve checks his data on the phone.

Then redesign slice 2 (the roster) continues on Cloudflare.
