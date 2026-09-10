#!/usr/bin/env bash
# Odebere spouštěč, ikony a položku v nabídce. Nastavení v ~/.config/c3term nechává být.
set -euo pipefail

rm -f "$HOME/.local/bin/c3term"
rm -f "$HOME/.local/share/applications/c3term.desktop"
for size in 16 24 32 48 64 128 256 512; do
  rm -f "$HOME/.local/share/icons/hicolor/${size}x${size}/apps/c3term.png"
done
command -v update-desktop-database >/dev/null && update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

echo "C3Term odinstalován."
echo "Nastavení a uložené relace zůstávají v ~/.config/c3term (smažte ručně, pokud je nechcete)."
