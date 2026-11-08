# Disc Golf Tracker

A phone-first disc golf scorecard. It keeps score hole by hole for up to six players, remembers
your courses and their pars, shows course maps mid-round, and tracks your scores over time.

It is one HTML file (`index.html`) built to run as a [Claude](https://claude.ai) artifact, which
gives it somewhere to save rounds, courses and map images.

## What it does

- **Play.** Pick a course, add players, and score each hole with − and +. The first tap on a
  blank hole enters par. Each score is labelled (birdie, par, bogey, …), and every player shows
  their running total against par. You can pause a round and pick it up later at the first hole
  not yet scored for everyone. You can also finish early or throw a round away.
- **Courses.** Name a course, set 1–36 holes, and tap each hole to set its par (3, 4 or 5). Add
  photos or screenshots of the course map. They open full screen during a round, with pinch and
  double-tap zoom. An optional link can point to a map online. Several courses around
  Wilmington, Delaware, come with links to their UDisc or state park maps.
- **Rounds.** Every finished round as a full scorecard, with scores under par circled and over
  par boxed.
- **Stats.** For each player: rounds played, best and average score against par, a trend chart
  of the last 20 rounds, and a best score for each course. Rounds finished early are left out of
  these numbers, so a few holes can't beat a full round.

## Saving, and playing without signal

In a Claude artifact, rounds and courses are saved to the artifact's database and map images to
its file storage. They are shared by everyone who can open the artifact.

Each change is first kept on the phone, then sent. If the connection drops mid-round:
- scores stay on screen;
- the top bar says "no connection — kept on this phone";
- saves retry on their own, and straight away when signal returns or the app is reopened.

Scores that never got sent are restored the next time the app opens. "Round saved" appears only
once the round is actually saved.

Opened as a plain file in a browser, outside Claude, the app still runs and keeps score, but
it says it can't save.

## Running it

Publish `index.html` as a Claude artifact with the `db` capability (rounds and courses) and the
`assets` capability (map images). Without `assets`, map uploads are hidden and everything else
works.

## Testing

The checks need only Python 3 and a browser.

```
python test/make_harness.py
python -m http.server 8766 --bind 127.0.0.1 --directory test
```

Then open http://127.0.0.1:8766/tests.html in a browser tab you can see: background tabs slow
timers and throw the checks off. All 19 should pass. Add `?only=<words>` to run some of them.

The checks run the app against `test/mock-claude.js`, a stand-in for Claude's artifact runtime
that follows its documented behaviour and can be made to fail saves on purpose. It is not the
real thing: try changes in the real artifact before relying on them on the course.

To try the app by hand against made-up data, open `harness.html?seed=<name>`. The seeds are
`empty`, `maps`, `midround`, `six` and `partial`. Add `&fail=1` to make every save fail.
`test/mock-claude.js` lists the other options.

## What's here

| Path | What it is |
|---|---|
| `index.html` | The whole app: markup, styles and script |
| `test/mock-claude.js` | Stand-in for the artifact runtime's `db` and `assets` |
| `test/make_harness.py` | Builds `test/harness.html`, the app with the stand-in loaded first |
| `test/tests.html`, `test/tests.js` | The browser checks |
| `FINDINGS.md` | The bugs found in the first version, how each was reproduced, and how it was fixed |
| `REDESIGN.md` | The agreed redesign (opponents, friends' history, the Clubhouse look) and its build order |
| `design/canvas/` | Source of the redesign mock-ups, for reference |
