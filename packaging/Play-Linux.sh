#!/bin/sh
# Uno with a Ladder - DB5 Edition: opens the game in a Chrome / Chromium / Edge app window.
#   ./Play-Linux.sh             play
#   ./Play-Linux.sh --install   also add it to your applications menu
# WebGPU on Linux still sits behind the flags below in most Chrome builds.
DIR=$(cd "$(dirname "$0")" && pwd)
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
if [ "${1:-}" = "--install" ]; then
  mkdir -p "$DATA/applications"
  cat > "$DATA/applications/uno-with-a-ladder-db5.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Uno with a Ladder - DB5 Edition
Comment=Aston Martin DB5 racing game (WebGPU)
Exec="$DIR/Play-Linux.sh"
Icon=$DIR/DB5.png
Categories=Game;
Terminal=false
EOF
  echo "Added to your applications menu."
fi
URL="file://$DIR/game/index.html"
PROFILE="$DATA/uno-with-a-ladder/browser-profile"
for b in google-chrome-stable google-chrome chromium chromium-browser microsoft-edge-stable microsoft-edge brave-browser; do
  if command -v "$b" >/dev/null 2>&1; then
    exec "$b" --app="$URL" --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check \
      --enable-unsafe-webgpu --enable-features=Vulkan --ignore-gpu-blocklist \
      --autoplay-policy=no-user-gesture-required --start-maximized
  fi
done
echo "This game needs Google Chrome, Chromium or Microsoft Edge (with WebGPU)." >&2
exit 1
