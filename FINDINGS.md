# Disc Golf Scorecard: investigation and fixes, 2026-11-07

Source: the "Disc Golf Scorecard" artifact (https://claude.ai/artifact/BGtnTbuWtkc7EapWecrqLc),
version 1794074449-5b1b, copied unmodified to `index.html` (baseline commit `67fcbcb`).
It is one HTML file that uses the artifact runtime's `db` (courses, rounds) and `assets` (map images).

**Status:** all seven reproduced bugs are fixed in `index.html`. The fixed version is not yet
published to the artifact. All 19 checks in `test/tests.html` pass, three runs in a row; on
the original code 15 of the first 18 failed.

The checks run against a test double of the artifact runtime (`test/mock-claude.js`). It copies
the documented `db`/`assets` behaviour: a save reaches the live listener twice, once at once and
once when confirmed; delivered docs are frozen. It is not the real platform. Run the fixed app
there before trusting it on a round.

## The pattern behind most of it

The app redrew the entire screen on every database snapshot, and every save produces two. So
about a second after each score tap, the scorecard was torn down and rebuilt under your thumb.
Several earlier "fixes" (the in-place score update, the pointer-event tap handling) were patches
on symptoms of this. The second pattern: it trusted a live connection. Nothing was kept on the
device, and a failed save was not retried.

## Findings and fixes, worst first

### 1. Editing a course deleted its map images. **Fixed**
The editor was opened without the course's `mapAssets`, so Save wrote an empty list.
It now opens with them: they show as thumbnails, and each can be removed.

### 2. Taps were dropped and the screen jumped mid-round. **Fixed**
Each save's echo redrew everything and called `scrollIntoView`. Now:
- A snapshot redraws only when it changes what is shown. A save's own echo doesn't.
- The hole strip scrolls only itself, never the card or the page.
- The card returns to the top only when the hole changes.

### 3. Pause didn't stick. **Fixed**
Every rounds snapshot re-opened the newest active round. Now the round in progress opens once,
on first load, and never after you've tapped anything.

### 4. Reopening mid-round put you on hole 1. **Fixed**
Auto-resume and the Resume button now share one rule: open at the first hole not yet scored for everyone.

### 5. Adding several map images at once kept only the first. **Fixed**
After each upload the course is looked up again by id, rather than reusing an object a save has
since replaced. An image uploaded into an editor that was closed meanwhile is deleted, not orphaned.

### 6. Rounds finished early counted as bests. **Fixed**
"Best vs par", the average, the trend and "Course bests" use complete rounds only. Stats says how
many rounds finished early were left out, and Rounds marks them "thru N".

### 7. Weak signal on the course lost data. **Fixed**
- Every change goes into an outbox, kept in localStorage when the browser allows. Each entry is
  removed only once the store confirms the write.
- Snapshots never overwrite a document that is still in the outbox.
- A failed save retries with backoff (2s, 4s, 8s … up to 30s), and at once when the phone comes
  back online or the app is brought back to the front.
- Leaving the app sends anything still waiting on the 700ms save delay.
- Changes left unsaved on the last visit are restored and sent the next time the app opens.
- The top bar says "no connection — kept on this phone" while anything is unsaved.
- "Round saved" appears only once the store has the round. Otherwise the message says it will save
  when you're back online.
- A write the store refuses for good (view-only access) switches the screen to view-only and drops
  the queued changes. Otherwise every later visit would retry them and be refused. This replaces the old
  check for `not_granted`/`not_writer`, which missed the code the platform actually sends
  (`invalid_argument`).

## Not changed (found by reading, not tested)
- Once a hole has a score it can't be cleared back to blank. Pars cycle 3–5 only (no par 2 or 6).
- Course bests are keyed by course name, so renaming a course splits its history. Players are
  matched by exact name ("steven" ≠ "Steven" across rounds).
- Deleting a course leaves its map images in storage.
- "Steven" is hard-coded as the default player and sorted first in Stats.
- The tap handling on the + / − buttons (pointer events with a click fallback) is unchanged. The
  dropped taps came from the redraws in item 2, not from it.

## Running the checks

```
python test/make_harness.py
python -m http.server 8766 --bind 127.0.0.1 --directory test
```
Open `http://127.0.0.1:8766/tests.html` in a visible browser tab; background tabs slow timers and
throw the timings off. Add `?only=<words>` to run some. Results also land in `window.__results`.

To poke at the app by hand, open `harness.html?seed=<name>`. Seeds: `empty`, `maps`, `midround`,
`six`, `partial`. `&fail=1` makes every save fail (`__mock.setFail(false)` to recover),
`&lat=` / `&up=` change write and upload delays, and `&nomock=1` runs with no runtime at all.
`window.__mock.log` records every write and snapshot; `__mock.peek("rounds", id)` shows what is
stored. Re-run `make_harness.py` after any change to `index.html`. All seeded data is made up.
