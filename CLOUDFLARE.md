# Moving the scorecard to Cloudflare

Agreed with Steve on 2026-11-07, and the plan approved the same day.

**Where it stands.** The scorecard runs on Cloudflare, behind Steve's sign-in, and all 40 checks
pass. Steps 1 to 4 are done. Step 5 isn't needed: Steve chose to start fresh. What's left is
Steve's own round on the new address.
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

Now: step 4. The setup steps are below, and `wrangler.jsonc` turns off preview copies, so the
one at the workers.dev address is the only one.
- Part 1 is done (2026-11-08): the D1 database `disc-golf` and the R2 bucket `disc-golf-maps`
  exist, and the database id is in `wrangler.jsonc`.
- The first publish is made: the `live` branch is at the same commit as `main`.
- Part 2, steps 3 to 5 are done (2026-11-08): the Worker deploys from `live`, Access is on, and
  the three sign-in settings are saved. From outside, every address on the site, the API
  included, sends a stranger to the sign-in page, and a made-up sign-in token is turned away too.
  (The address isn't written here: it contains Steve's email name, and this repo is public.)
- Step 6 found two things (2026-11-08):
  - The three sign-in settings had gone in as **build** settings, which the running app never
    sees, so the server answered "Sign-in isn't set up on the server yet." Step 5 below now says
    where they go.
  - The app called that answer "no connection", which was wrong. A server that answers with a
    problem now shows "server problem — kept on this phone" and a banner with the server's own
    words; a check covers it. Steve said to publish it, and it went live at `7c5e7b3`.
  - The import form had set `main` as the production branch, with preview builds on for other
    branches. So pushes to `main` were deploying, and the push to `live` failed as a preview
    (`wrangler preview` wants a `previews` block this app doesn't use). Steve then set the
    production branch to `live` (Settings → Build → Branch control), and a test push to `main`
    confirmed it no longer deploys. Builds for other branches are still on, so each push to `main`
    runs a preview that fails and deploys nothing; turning them off is a tidy-up. Step 3 below
    now says to check both after the import.
- Step 5, moving the data, isn't needed (2026-11-08). Claude exported the old artifact's data
  read-only into the git-ignored `export/` folder: 1 course and 1 round, no map images. Steve then
  chose to start fresh rather than bring those over. A one-time import page was built and checked
  (commit `b0b27fa`), then taken out unused; it can be restored from that commit if ever wanted.
  The old artifact still has its data, untouched.
- Next: Steve plays a round on the new address, then stops using the old one. Then redesign
  slice 2 (the roster).

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

Not done: Steve chose to start fresh on 2026-11-08 (see "Where it stands"). The plan was:

1. **Export.** Claude reads the artifact's rounds, courses and map images, read-only, into a
   folder on Steve's PC that git ignores. Disc golf scores are read through the model to do this.
   Nothing is written back to the artifact.
2. **Import.** A one-time import page on the new site, behind the sign-in, takes that folder.
3. **Check.** Count rounds, courses and map images on both sides. Open a few full scorecards and
   compare totals. Steve then plays one round on the new address before the old one is retired
   from use.

## Steve's one-time setup (about 20 minutes, in the Cloudflare dashboard)

Written 2026-11-08 from Cloudflare's docs of that week. Cloudflare moves its screens around, so a
label may differ a little; the names to type are exact. Use the Cloudflare account the family
calendar is on, at dash.cloudflare.com.

**Part 1: the storage (about 5 minutes)**
1. **Database.** Storage & databases → D1 SQL database → Create database. Name it `disc-golf` and
   leave the location as it is. Copy its **Database ID** (a long code with dashes) and send it to
   Claude. It isn't a secret.
2. **Map storage.** Storage & databases → R2 object storage. If Cloudflare asks to turn R2 on, it
   wants a payment card: up to 10 GB a month is free, and a $5 hold may show and drop off. Then
   Create bucket, named `disc-golf-maps`, with the location left as it is.

Claude then puts the database ID into `wrangler.jsonc` and makes the first publish: the `live`
branch, at the same commit as `main`.

**Part 2: the app and its sign-in (about 15 minutes, after Claude says it's published)**
3. **The app.** Workers & Pages → Create application → import a repository from GitHub. Let
   Cloudflare see `stovenmann/Disc-Golf-Tracker` if GitHub asks, and pick it.
   - Project name: `disc-golf`. Build command: empty. Deploy command: `npx wrangler deploy`.
   - Production branch: `live`. The import form may quietly use `main`, so check afterwards in
     the Worker's Settings → Build → Branch control: production branch `live`, and builds for
     non-production branches off. Otherwise every push to `main` goes live.
   - Leave builds for other branches (previews) off.
   - Deploy. When the build is done, the Worker shows its address,
     `https://disc-golf.<something>.workers.dev`.
4. **Sign-in.** In the Worker: the Access tab → Protect this Worker behind Access → All traffic.
   (Older screens: Settings → Domains & Routes → workers.dev → Enable Cloudflare Access.)
   - A box shows the **team domain** (ending `cloudflareaccess.com`) and the **AUD tag** (a long
     code). Copy both.
   - Then make sure only you get in. Zero Trust → Access controls → Policies → the one named
     `disc-golf - Production` → its Include rule is **Emails**, with your email and nothing else.
     Never "Everyone", and not a login method on its own: either lets anyone in.
5. **The Worker's sign-in settings.** In the Worker: Settings → Variables and Secrets → Add, three
   times, type Text. This is the section beside Domains & Routes, **not** "Build variables and
   secrets" in the Build section: those are only used while Cloudflare builds the app, and the
   running app never sees them. Its panel has a Deploy button; the build one only has Save.
   - `ACCESS_TEAM_DOMAIN`: the team domain from the box;
   - `ACCESS_AUD`: the AUD tag;
   - `ALLOWED_EMAILS`: your email.
   Then deploy. They live only in the dashboard, so your email stays out of this public repo.
6. **On the iPhone.**
   - Open the address in Safari and sign in with your email and the code Cloudflare sends.
     The app opens empty: your rounds move over at step 5.
   - Share → Add to Home Screen. The icon should be the basket, named "Disc Golf".
   - Open it from the Home Screen: full screen, no Safari bar. It may ask you to sign in once
     more. Try Settings → Twilight and check the top of the screen.
   - Make a course called Test, score a hole, then discard the round and delete the course.
   - Keep playing real rounds on the old app until step 5.

## Build order

1. Worker, database and API, with browser checks.
2. The page talks to the new API; the harness uses the new stand-in; all checks pass.
3. Manifest, icons and full-screen settings.
4. Steve's dashboard setup and the first publish. Then, on his iPhone: sign in, add it to the
   Home Screen, and open it from there.
5. Export, import, compare. Steve checks his data on the phone. *Not needed: Steve started fresh.*

Then redesign slice 2 (the roster) continues on Cloudflare.
