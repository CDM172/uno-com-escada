#!/bin/sh
# Uno with a Ladder - DB5 Edition: double-click to play. Opens the game in a Chrome or Edge app
# window; without either, in Safari (WebGPU needs Safari 26 or newer).
# The first time, macOS may refuse to open a downloaded script: right-click it > Open.
DIR=$(cd "$(dirname "$0")" && pwd)
URL="file://$DIR/game/index.html"
PROFILE="$HOME/Library/Application Support/Uno with a Ladder/browser-profile"
for APP in "Google Chrome" "Microsoft Edge" "Chromium" "Brave Browser"; do
  if open -Ra "$APP" >/dev/null 2>&1; then
    open -na "$APP" --args --app="$URL" --user-data-dir="$PROFILE" --no-first-run \
      --no-default-browser-check --autoplay-policy=no-user-gesture-required
    exit 0
  fi
done
open -a Safari "$DIR/game/index.html"
