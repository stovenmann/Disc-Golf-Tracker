"""Build test/harness.html: index.html with the runtime test double loaded first.

Run from anywhere:  python test/make_harness.py
Then serve test/ on localhost and open harness.html?seed=<name> (see mock-claude.js).
"""
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
src = (root / "index.html").read_text(encoding="utf-8")
marker = '<script>\n"use strict";'
if src.count(marker) != 1:
    raise SystemExit("could not find the app's script tag in index.html")
mock = root / "test" / "mock-claude.js"
version = int(mock.stat().st_mtime)  # cache-buster, so an edited mock is always picked up
out = src.replace(marker, f'<script src="mock-claude.js?v={version}"></script>\n' + marker, 1)
(root / "test" / "harness.html").write_text(out, encoding="utf-8", newline="\n")
print("wrote test/harness.html")

# the Cloudflare Worker, copied next to the checks so the browser can import it as it is
(root / "test" / "worker.js").write_bytes((root / "worker" / "index.js").read_bytes())
print("wrote test/worker.js")
