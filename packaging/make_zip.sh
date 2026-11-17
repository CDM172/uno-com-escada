#!/bin/sh
# Builds the game and packs it into a zip that installs on Windows (Install.cmd) and also plays
# on macOS and Linux.
#   sh packaging/make_zip.sh [OUT_DIR]        (default OUT_DIR: dist/)
#   HTML=build.html sh packaging/make_zip.sh  packs an already built and tested index.html
# Needs node and zip. Run on Linux (uses GNU sed).
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$HERE")
OUT=${1:-$ROOT/dist}
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
NAME="Uno with a Ladder - DB5 Edition"
ZIP="Uno-with-a-Ladder-DB5-Edition.zip"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
D="$STAGE/$NAME"
mkdir -p "$D/game" "$D/scripts"

# The game itself: one self-contained HTML file, with the DB5 as its window and taskbar icon.
if [ -n "${HTML:-}" ]; then                 # HTML=path/to/tested-build.html packs that build instead of building
  cp "$HTML" "$D/game/index.html"
else
  node "$ROOT/fable/source/build.mjs" --out "$D/game/index.html"
fi
node -e '
const fs = require("fs"); const [html, png] = process.argv.slice(1);
let s = fs.readFileSync(html, "utf8");
const tag = `<link rel="icon" type="image/png" href="data:image/png;base64,${fs.readFileSync(png).toString("base64")}">`;
if (!/rel="icon"/.test(s)) s = s.replace(/<head[^>]*>/i, (m) => m + tag);
fs.writeFileSync(html, s);' "$D/game/index.html" "$HERE/icon/DB5-64.png"

cp "$HERE/windows/Install.cmd" "$HERE/windows/Play.cmd" "$HERE/windows/Uninstall.cmd" "$D/"
cp "$HERE/windows/scripts/"*.ps1 "$D/scripts/"
cp "$HERE/README.txt" "$D/README.txt"
cp "$ROOT/LICENSE.md" "$D/LICENSE.md"
cp "$HERE/icon/DB5.ico" "$HERE/icon/DB5.png" "$D/"
cp "$HERE/Play-Linux.sh" "$HERE/Play-macOS.command" "$D/"
chmod 755 "$D/Play-Linux.sh" "$D/Play-macOS.command"
# Windows text files get CRLF line endings.
for f in "$D"/*.cmd "$D"/scripts/*.ps1 "$D/README.txt" "$D/LICENSE.md"; do sed -i 's/\r*$/\r/' "$f"; done

rm -f "$OUT/$ZIP"
(cd "$STAGE" && zip -qrX9 "$OUT/$ZIP" "$NAME")
echo "ok $OUT/$ZIP $(du -k "$OUT/$ZIP" | cut -f1) KiB"
