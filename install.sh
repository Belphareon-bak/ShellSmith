#!/usr/bin/env bash
# Nainstaluje ShellSmith pro aktuálního uživatele: spouštěč, ikony a položku v nabídce.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
BIN_DIR="$HOME/.local/bin"
APPS_DIR="$HOME/.local/share/applications"
ICON_ROOT="$HOME/.local/share/icons/hicolor"

echo "ShellSmith – instalace z $APP_DIR"

echo "→ synchronizuji závislosti podle package-lock.json…"
(cd "$APP_DIR" && npm ci)

# Electron od verze 44 nepublikuje postinstall, takže `npm ci` binárku sám
# nestáhne a node_modules/electron/dist zůstane prázdný. Bez tohohle kroku
# se aplikace nespustí – a z nabídky plochy dokonce bez jakékoli hlášky.
if [ ! -x "$APP_DIR/node_modules/electron/dist/electron" ]; then
  echo "→ dotahuji binárku Electronu…"
  (cd "$APP_DIR" && node node_modules/electron/install.js)
fi
if [ ! -x "$APP_DIR/node_modules/electron/dist/electron" ]; then
  echo "Instalace selhala: binárku Electronu se nepodařilo získat." >&2
  echo "Zkuste v $APP_DIR ručně: node node_modules/electron/install.js" >&2
  exit 1
fi

echo "→ sestavuji aktuální rozhraní…"
(cd "$APP_DIR" && npm run build:renderer)

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

# --------------------------------------------------------------------------
# Sandbox Chromia na Ubuntu 24.04.
#
# Jádro tu nedovolí neprivilegovaným procesům vytvořit user namespace
# (kernel.apparmor_restrict_unprivileged_userns=1). Electron pak sáhne po
# pomocné binárce chrome-sandbox, která musí patřit rootovi a mít 4755 –
# v node_modules to tak není. Z terminálu se aplikace obvykle spustí, protože
# shell běží v jiném profilu AppArmoru; z nabídky plochy ale plasmashell předá
# potomkům svůj enforcing profil a aplikace skončí dřív, než otevře okno.
SANDBOX="$APP_DIR/node_modules/electron/dist/chrome-sandbox"
AA_PROFILE="$APP_DIR/packaging/shellsmith.apparmor"

# Profil s doplněnou cestou připravíme vždy, ať je po ruce.
sed "s|@ELECTRON@|$APP_DIR/node_modules/electron/dist/electron|; s|@PROFILE@|$AA_PROFILE|" \
  "$APP_DIR/packaging/shellsmith.apparmor.in" > "$AA_PROFILE"

restrict="$(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)"
if [ "$restrict" = "1" ] && [ -f "$SANDBOX" ] && [ ! -u "$SANDBOX" ] && [ ! -e /etc/apparmor.d/shellsmith ]; then
  cat <<TXT

  POZOR: z nabídky plochy se aplikace takhle nespustí.
  Jádro omezuje neprivilegované namespace a chrome-sandbox není setuid root,
  takže Electron skončí dřív, než otevře okno. Z terminálu to projde.

  Trvalá oprava (jednorázově, vyžaduje heslo správce):

     sudo install -m 644 $AA_PROFILE /etc/apparmor.d/shellsmith
     sudo apparmor_parser -r /etc/apparmor.d/shellsmith

  Bez hesla správce: spouštěč se při prvním pokusu zeptá, jestli má ShellSmith
  spustit bez sandboxu, a volbu si zapamatuje. Totéž natvrdo:

     touch "${XDG_CONFIG_HOME:-$HOME/.config}/shellsmith/allow-no-sandbox"

TXT
fi

cat <<'TXT'

Hotovo.
  • Spuštění z terminálu:  shellsmith
  • V nabídce KDE:         hledejte „ShellSmith“ (kategorie Internet / Síť)
  • Na panel:              pravý klik na položku v nabídce → Přidat do panelu

Odinstalace: ./uninstall.sh
TXT
