# Redesign: opponents, friends' history and a new look

Agreed with Steve on 2026-11-07. Build it in the order at the end. Slice 1 (the Clubhouse look) is
built and live as artifact version 10; slices 2 to 4 are not built.

The screens are on a private Claude design canvas: https://claude.ai/artifact/JaLgtx8yW6VySAYkPytgTH.
The canvas's source is in `design/canvas/`: one `.dc.html` file per screen plus `canvas.json`.
These files need the canvas runtime to render, so they are a reference, not pages to open. Each
screen's `theme()` holds the exact colours and fonts of all three looks that were compared. Every
name and number on the canvas is sample data.

## Decisions

- **Look: A · Clubhouse.** Cream scorecard paper, bottle green and brass, serif headings and
  numerals (Libre Caslon Text), Inter for everything else. Tokens, from `design/canvas/Main.dc.html`:
  - Colours: background `#F3EEE2`, surface `#FBF8F1`, ink `#1C2A21`, secondary ink `#4C574F`,
    muted `#686D61`, lines `#E0D8C7`, accent and under par `#1F4A34` (text on it `#F8F3E7`),
    soft fill `#E7ECE2`, brass `#83673A`, over par `#984A2C`.
  - Score mix: par `#D3CAB4`, bogey `#C68B69`.
  - Shapes: radius 14px, pill buttons.
  - Scores: under par is a filled circle; over par, or a hole lost, is an outlined square. Shape
    carries the meaning, not colour alone.
- **Dark mode (confirmed 2026-11-07):** Clubhouse cream is the default, whatever the phone's own
  setting. A switch in Settings turns on the Twilight colours (row B on the canvas) with the
  Clubhouse fonts, not Twilight's. The choice is kept on the phone, not in the saved data.
- **Formats, chosen at tee-off:**
  - *Classic:* lowest total strokes wins.
  - *Match play:* each hole is won, lost or halved; the card shows the match status
    ("Steven 2 up with 12 to play").
  - *Best disc:* doubles. Two-player teams both throw and play the better disc, posting one team
    score per hole. Also record whose disc was played on each hole.
- **Players are a roster on one phone.** Steven keeps score for everyone; friends don't open
  the app.
- **Tabs: Play · Rounds · Players · Courses.** Players replaces Stats:
  - Your page: trend, scoring mix, toughest holes, rivals.
  - Each friend's page: your head-to-head record by format, your record as best disc partners,
    the last five meetings, and their own form.
- Bests and averages count complete rounds only. This is already in `index.html`.

## Build order

Each slice:
- Write checks in `test/tests.js` first wherever there is logic.
- Run the whole suite until it passes.
- Commit and push.
- Publish to the live artifact only when Steve says so.

1. **Clubhouse look on the existing screens.** Colours, fonts, the icon tab bar, the new
   scorecard layout. No change to saved data. **Done 2026-11-07; published as artifact version 10 (commit
   `f35161f`).** Where it
   differs from the canvas, and why:
   - The tabs are already in the final order (Play · Rounds · Stats · Courses). Stats sits where
     Players will go in slice 4.
   - Settings is a sliders button at the top of Play. It opens a sheet that holds the
     Clubhouse/Twilight switch.
   - The scorecard title is the course name, with the date and par above it. The format name
     takes the title in slice 3.
   - The hole grid marks each hole as scored, current or not yet played. Match results (won,
     lost, halved) come in slice 3.
   - Pause stays a one-tap button beside Map, and Finish early and Discard sit under the
     hole buttons. The canvas puts all three behind a "…" menu. Keeping them one tap away
     left every behaviour and check unchanged; the menu can follow if Steve wants it.
   - The course map viewer keeps a dark background in both looks, so maps read well.
   **Then, before slice 2: move the app to Cloudflare** (decided 2026-11-07). It gets its own
   address, the Home Screen icon and full screen. The plan and its build order are in
   `CLOUDFLARE.md`. Slices 2 to 4 are built on Cloudflare.
2. **Player roster.** Add a `players` collection. Match the names in existing rounds to roster
   entries, case-insensitively ("steven" and "Steven" are one person). Keep the original names on
   every round, so the change only adds. Export a copy of the saved data before it runs on the
   live artifact.
3. **Formats:** Classic, Match play, and Best disc with teams and "disc played".
4. **Players tab:** your page and the friend pages, as on the canvas.

Data shape to settle in slice 2 (a sketch, not a decision):
- `players/<id>`: `{name, isMe, createdAt}`.
- Rounds add:
  - `playerIds`;
  - `format` (`classic`, `match` or `bestdisc`);
  - for best disc, `teams` (`[[id, id], [id, id]]`), team scores keyed by team, and
    `discs` (the player whose disc was played, per team and hole).

## Working notes

- Development needs only Python 3 and a browser. Nothing else is installed (no Node, no `gh`).
- The live app is the private artifact https://claude.ai/artifact/BGtnTbuWtkc7EapWecrqLc.
  - It is published from `index.html` and keeps its `db`, `assets` and `user` capabilities.
  - Before republishing, confirm the live version still matches the last published commit.
- Claude Code's browser pane isn't signed in to claude.ai, so a session can't view the live app or
  the canvas. The test harness in `test/` is where changes get checked.
