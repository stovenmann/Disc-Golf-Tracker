"""Put the Home Screen icon into public/index.html.

Reads design/app-icon-180.png (drawn by design/app-icon.ps1) and writes it into public/index.html as an
apple-touch-icon, embedded as a data: URI because the artifact can't serve separate image files.
Running it again replaces the icon line, so redraw the icon and rerun to change it.
    python design/embed_icon.py
"""
import base64
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
page = root / "public" / "index.html"
png = (root / "design" / "app-icon-180.png").read_bytes()
uri = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
lines = [
    f'<link rel="apple-touch-icon" sizes="180x180" href="{uri}">',
    '<meta name="apple-mobile-web-app-title" content="Disc Golf">',
]
src = page.read_bytes().decode("utf-8")
src = re.sub(r'<link rel="apple-touch-icon"[^>]*>\n<meta name="apple-mobile-web-app-title"[^>]*>\n', "", src)
anchor = "<title>Disc Golf Scorecard</title>\n"
if src.count(anchor) != 1:
    raise SystemExit("could not find the <title> line in public/index.html")
src = src.replace(anchor, anchor + "\n".join(lines) + "\n", 1)
page.write_bytes(src.encode("utf-8"))  # bytes, so line endings stay LF
print(f"embedded a {len(png):,}-byte icon in index.html")
