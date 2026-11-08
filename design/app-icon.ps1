# Draws the Disc Golf Tracker's icon, in the Clubhouse colours (bottle green, cream, brass): a disc
# golf basket with brass chains. It writes the full-size drawing to design/app-icon.png, and the
# sizes the site serves to public/icons/:
#   apple-touch-icon.png  180 x 180, the iPhone Home Screen
#   icon-192.png, icon-512.png  named in public/manifest.webmanifest; 192 is also the browser tab's
# Uses the drawing library built into Windows; nothing to install.
#   powershell -NoProfile -ExecutionPolicy Bypass -File design\app-icon.ps1
# iOS rounds the corners itself, so the square is full bleed.
Add-Type -AssemblyName System.Drawing

$S = 1024
$out = Join-Path $PSScriptRoot "app-icon.png"
$green = [System.Drawing.ColorTranslator]::FromHtml("#1F4A34")
$cream = [System.Drawing.ColorTranslator]::FromHtml("#F3EEE2")
$brass = [System.Drawing.ColorTranslator]::FromHtml("#CBAA6C")

function New-Pen($color, $width) {
  $p = New-Object System.Drawing.Pen $color, $width
  $p.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $p.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $p.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  return $p
}
function P($x, $y) { return New-Object System.Drawing.PointF ([single]$x), ([single]$y) }

$bmp = New-Object System.Drawing.Bitmap $S, $S
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear($green)
# draw about 12% larger around the centre, so the basket fills the icon at Home Screen size
$g.TranslateTransform([single]512, [single]512)
$g.ScaleTransform([single]1.12, [single]1.12)
$g.TranslateTransform([single](-512), [single](-512))

$dy = -36                      # lifts the drawing to sit a touch above centre
$bandY = 262 + $dy             # chain support ring
$rimY = 590 + $dy              # top of the basket tray
$trayY = 708 + $dy             # bottom of the tray
$baseY = 842 + $dy             # foot of the pole

$creamPen = New-Pen $cream 30
$chainPen = New-Pen $brass 13
$slatPen = New-Pen $cream 12

# pole
$g.DrawLine($creamPen, (P 512 $bandY), (P 512 $baseY))

# chains, hanging from the ring and gathering toward the pole above the tray
$tops = @(352, 404, 456, 568, 620, 672)
$ends = @(446, 468, 490, 534, 556, 578)
for ($i = 0; $i -lt $tops.Count; $i++) {
  $x0 = $tops[$i]; $x1 = $ends[$i]
  $g.DrawBezier($chainPen, (P $x0 ($bandY + 20)), (P $x0 ($bandY + 150)), (P $x1 ($rimY - 150)), (P $x1 ($rimY - 6)))
}

# chain support ring
$g.DrawLine((New-Pen $cream 40), (P 330 $bandY), (P 694 $bandY))

# tray: a trapezoid with slats
$tray = @((P 300 $rimY), (P 724 $rimY), (P 672 $trayY), (P 352 $trayY))
$g.DrawPolygon($creamPen, $tray)
foreach ($t in @(@(394, 416), @(458, 464), @(566, 560), @(630, 608))) {
  $g.DrawLine($slatPen, (P $t[0] $rimY), (P $t[1] $trayY))
}
$g.DrawLine((New-Pen $cream 34), (P 300 $rimY), (P 724 $rimY))

# foot
$g.DrawLine($creamPen, (P 430 $baseY), (P 594 $baseY))

# if a save fails with "A generic error occurred in GDI+", the old file couldn't be replaced:
# delete it and run the script again
function Save-Png($bitmap, $path) {
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output "wrote $path"
}
Save-Png $bmp $out

$icons = Join-Path (Split-Path $PSScriptRoot -Parent) "public\icons"
New-Item -ItemType Directory -Force $icons | Out-Null
foreach ($size in @(@(180, "apple-touch-icon.png"), @(192, "icon-192.png"), @(512, "icon-512.png"))) {
  $n = $size[0]
  $sm = New-Object System.Drawing.Bitmap $n, $n
  $gs = [System.Drawing.Graphics]::FromImage($sm)
  $gs.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gs.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $gs.DrawImage($bmp, 0, 0, $n, $n)
  Save-Png $sm (Join-Path $icons $size[1])
  $gs.Dispose(); $sm.Dispose()
}
$g.Dispose(); $bmp.Dispose()
