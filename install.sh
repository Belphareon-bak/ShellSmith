#!/usr/bin/env bash
# Nainstaluje ShellSmith pro aktuálního uživatele: spouštěč, ikony a položku v nabídce.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
BIN_DIR="$HOME/.local/bin"
APPS_DIR="$HOME/.local/share/applications"
ICON_ROOT="$HOME/.local/share/icons/hicolor"

echo "ShellSmith – instalace z $APP_DIR"

if [ ! -d "$APP_DIR/node_modules/electron" ]; then
  echo "→ instaluji závislosti (npm install)…"
  (cd "$APP_DIR" && npm install)
fi
if [ ! -f "$APP_DIR/src/renderer/dist/bundle.js" ]; then
  echo "→ sestavuji rozhraní…"
  (cd "$APP_DIR" && npm run build:renderer)
fi

mkdir -p "$BIN_DIR" "$APPS_DIR"
ln -sf "$APP_DIR/bin/shellsmith" "$BIN_DIR/shellsmith"
echo "→ spouštěč: $BIN_DIR/shellsmith"

for size in 16 24 32 48 64 128 256 512; do
  src="$APP_DIR/build/icons/${size}x${size}.png"
  [ -f "$src" ] || continue
  dst="$ICON_ROOT/${size}x${size}/apps"
  mkdir -p "$dst"
  cp -f "$src" "$dst/shellsmith.png"
done
echo "→ ikony: $ICON_ROOT/*/apps/shellsmith.png"

sed "s|@EXEC@|$BIN_DIR/shellsmith|g" "$APP_DIR/packaging/shellsmith.desktop.in" > "$APPS_DIR/shellsmith.desktop"
chmod +x "$APPS_DIR/shellsmith.desktop"
echo "→ položka v nabídce: $APPS_DIR/shellsmith.desktop"

# Obnova databází, ze kterých čtou nabídky aplikací. Bez toho se nová položka
# v nabídce KDE neobjeví (nebo tam zůstane viset ta stará, která už nefunguje).
if command -v update-desktop-database >/dev/null; then
  update-desktop-database "$APPS_DIR" 2>/dev/null || true
fi
if command -v gtk-update-icon-cache >/dev/null; then
  gtk-update-icon-cache -f -t "$ICON_ROOT" 2>/dev/null || true
fi

# Podle verze Plasmy se jmenuje jinak; projdeme, co je k dispozici.
sycoca_done=0
for kb in kbuildsycoca6 kbuildsycoca5; do
  if command -v "$kb" >/dev/null; then
    if "$kb" --noincremental >/dev/null 2>&1; then
      echo "→ nabídka KDE obnovena ($kb)"
      sycoca_done=1
      break
    fi
  fi
done
if [ "$sycoca_done" -eq 0 ]; then
  echo "  Pozn.: nepodařilo se obnovit nabídku KDE. Pokud se položka neobjeví,"
  echo "         spusťte ručně 'kbuildsycoca5 --noincremental' nebo se odhlaste a přihlaste."
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "  Pozn.: $BIN_DIR není v PATH – přidejte si ho, chcete-li spouštět příkazem 'shellsmith'." ;;
esac

cat <<'TXT'

Hotovo.
  • Spuštění z terminálu:  shellsmith
  • V nabídce KDE:         hledejte „ShellSmith“ (kategorie Internet / Síť)
  • Na panel:              pravý klik na položku v nabídce → Přidat do panelu

Odinstalace: ./uninstall.sh
TXT
