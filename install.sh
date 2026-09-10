#!/usr/bin/env bash
# Nainstaluje C3Term pro aktuálního uživatele: spouštěč, ikony a položku v nabídce.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
BIN_DIR="$HOME/.local/bin"
APPS_DIR="$HOME/.local/share/applications"
ICON_ROOT="$HOME/.local/share/icons/hicolor"

echo "C3Term – instalace z $APP_DIR"

if [ ! -d "$APP_DIR/node_modules/electron" ]; then
  echo "→ instaluji závislosti (npm install)…"
  (cd "$APP_DIR" && npm install)
fi
if [ ! -f "$APP_DIR/src/renderer/dist/bundle.js" ]; then
  echo "→ sestavuji rozhraní…"
  (cd "$APP_DIR" && npm run build:renderer)
fi

mkdir -p "$BIN_DIR" "$APPS_DIR"
ln -sf "$APP_DIR/bin/c3term" "$BIN_DIR/c3term"
echo "→ spouštěč: $BIN_DIR/c3term"

for size in 16 24 32 48 64 128 256 512; do
  src="$APP_DIR/build/icons/${size}x${size}.png"
  [ -f "$src" ] || continue
  dst="$ICON_ROOT/${size}x${size}/apps"
  mkdir -p "$dst"
  cp -f "$src" "$dst/c3term.png"
done
echo "→ ikony: $ICON_ROOT/*/apps/c3term.png"

sed "s|@EXEC@|$BIN_DIR/c3term|g" "$APP_DIR/packaging/c3term.desktop.in" > "$APPS_DIR/c3term.desktop"
chmod +x "$APPS_DIR/c3term.desktop"
echo "→ položka v nabídce: $APPS_DIR/c3term.desktop"

command -v update-desktop-database >/dev/null && update-desktop-database "$APPS_DIR" 2>/dev/null || true
command -v gtk-update-icon-cache  >/dev/null && gtk-update-icon-cache -f -t "$ICON_ROOT" 2>/dev/null || true
command -v kbuildsycoca6 >/dev/null && kbuildsycoca6 --noincremental >/dev/null 2>&1 || \
command -v kbuildsycoca5 >/dev/null && kbuildsycoca5 --noincremental >/dev/null 2>&1 || true

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "  Pozn.: $BIN_DIR není v PATH – přidejte si ho, chcete-li spouštět příkazem 'c3term'." ;;
esac

cat <<'TXT'

Hotovo.
  • Spuštění z terminálu:  c3term
  • V nabídce KDE:         hledejte „C3Term“ (kategorie Internet / Síť)
  • Na panel:              pravý klik na položku v nabídce → Přidat do panelu

Odinstalace: ./uninstall.sh
TXT
