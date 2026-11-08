# Disc Golf Tracker

A phone-first disc golf scorecard. It keeps score hole by hole for up to six players, remembers
your courses and their pars, shows course maps mid-round, and tracks your scores over time.

The app is one HTML file (`public/index.html`). It is moving from a [Claude](https://claude.ai)
artifact to its own Cloudflare site (see `CLOUDFLARE.md`):
- **Today** the live app is still the Claude artifact, published from commit `f35161f`.
- **This repo's `main`** is built for Cloudflare: the page saves through the Worker in
  `worker/index.js`. It isn't deployed yet.

## What it does

- **Play.** Pick a course, add players, and score each hole with − and +. The first tap on a
  blank hole enters par. Each score is labelled (birdie, par, bogey, …), and every player shows
  their strokes and running total against par. A grid of hole numbers at the top of the card
  shows which holes are scored; tap one to jump to it. You can pause a round (the pause button
  at the top) and pick it up later at the first hole not yet scored for everyone. You can also
  finish early or throw a round away.
- **Rounds.** Every finished round as a full scorecard. A score under par sits in a filled circle,
  and a score over par in an outlined square, so the shape carries the meaning, not just the colour.
- **Stats.** For each player: rounds played, best and average score against par, a trend chart
  of the last 20 rounds, and a best score for each course. Rounds finished early are left out of
  these numbers, so a few holes can't beat a full round.
- **Courses.** Name a course, set 1–36 holes, and tap each hole to set its par (3, 4 or 5). Add
  photos or screenshots of the course map. They open full screen during a round, with pinch and
  double-tap zoom. An optional link can point to a map online. Several courses around
  Wilmington, Delaware, come with links to their UDisc or state park maps.

## The look

The app uses the **Clubhouse** look: cream scorecard paper, bottle green and brass. Headings and
numbers are set in Libre Caslon Text, everything else in Inter, both loaded from Google Fonts.
The tab bar (Play, Rounds, Stats, Courses) uses line icons.

Clubhouse is the look whatever the phone's own light or dark setting. For a dark screen, open
**Settings** (the sliders button at the top of Play) and choose **Twilight**: deep green,
champagne and ivory, with the same fonts. The choice is kept on that phone only, in the browser's
storage, and doesn't touch saved rounds or courses. The course map viewer is always dark.

The page carries a Home Screen icon for iPhone: a cream disc golf basket with brass chains on
bottle green, labelled "Disc Golf". `design/app-icon.ps1` draws it (Windows PowerShell, nothing
to install), and `python design/embed_icon.py` writes it into `public/index.html` as an
`apple-touch-icon`.

## Saving, and playing without signal

On Cloudflare, rounds and courses are saved in a Cloudflare database and map images in
Cloudflare's file storage, behind a sign-in that only lets Steve in. The page picks up changes:
- when it opens;
- when it comes back to the front;
- every 30 seconds while it's open;
- after each save.

It keeps the last copy on the phone, so it opens mid-round even with no signal.

Each change is first kept on the phone, then sent. If the connection drops mid-round:
- scores stay on screen;
- the top bar says "no connection — kept on this phone";
- saves retry on their own, and straight away when signal returns or the app is reopened.

If Cloudflare's sign-in runs out mid-round, it's the same: the scores stay on the phone, and the
top bar says "signed out — kept on this phone". A Sign in button brings back the sign-in page, and
everything waiting is sent once you're signed in.

Scores that never got sent are restored the next time the app opens. "Round saved" appears only
once the round is actually saved.

Opened somewhere with no server behind it (a saved copy of the page), the app still runs and
keeps score, but it says it can't save.

## Running it

Cloudflare deploys the Worker and `public/` from this repo's `live` branch. `CLOUDFLARE.md` has
the one-time setup and the order of the remaining steps. Until then, the live app is the Claude
artifact. It was published from `index.html` at commit `f35161f`, with the `db` and `assets`
capabilities.

## Testing

The checks need only Python 3 and a browser.

```
python test/make_harness.py
python -m http.server 8766 --bind 127.0.0.1 --directory test
```

Then open http://127.0.0.1:8766/tests.html in a browser tab you can see: background tabs slow
timers and throw the checks off. All 36 should pass:
- 12 check the Cloudflare Worker (`worker/index.js`) that will serve the app (see `CLOUDFLARE.md`);
- 24 check the app itself.

Add `?only=<words>` to run some of them, for example `?only=Worker`.

`make_harness.py` also copies the Worker to `test/worker.js`, so the browser can load it as it is.
Its checks use an in-memory stand-in for Cloudflare's database and file storage, and sign-in
tokens made with a throwaway key.

The checks run the app against `test/mock-api.js`, a stand-in for the Worker's API. It answers
as the Worker does and can be made to fail on purpose. It is not the real thing: try changes on
the real site before relying on them on the course.

To try the app by hand against made-up data, open `harness.html?seed=<name>`. The seeds are
`empty`, `maps`, `midround`, `six` and `partial`. Options:
- `&fail=1` makes every save fail;
- `&offline=1` makes everything fail;
- `&signedout=401` or `&signedout=redirect` acts as if the sign-in had run out.

`test/mock-api.js` lists the rest.

## What's here

| Path | What it is |
|---|---|
| `public/index.html` | The whole app: markup, styles and script |
| `test/mock-api.js` | Stand-in for the Worker's API, for the checks |
| `test/make_harness.py` | Builds `test/harness.html`, the app with the stand-in loaded first |
| `test/tests.html`, `test/tests.js` | The browser checks |
| `worker/index.js`, `wrangler.jsonc` | The Cloudflare Worker and its settings (not deployed yet; see `CLOUDFLARE.md`) |
| `test/worker-tests.js` | The Worker's checks |
| `FINDINGS.md` | The bugs found in the first version, how each was reproduced, and how it was fixed |
| `REDESIGN.md` | The agreed redesign (opponents, friends' history, the Clubhouse look) and its build order |
| `CLOUDFLARE.md` | The approved plan to move the app from a Claude artifact to its own Cloudflare site |
| `design/canvas/` | Source of the redesign mock-ups, for reference |
| `design/app-icon.png`, `app-icon-180.png` | The Home Screen icon, full size and at iPhone size |
| `design/app-icon.ps1`, `embed_icon.py` | Draw the icon; put it into `public/index.html` |
