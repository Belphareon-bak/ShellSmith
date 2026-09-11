#!/usr/bin/env bash
# Odebere spouštěč, ikony a položku v nabídce. Nastavení v ~/.config/shellsmith nechává být.
set -euo pipefail

rm -f "$HOME/.local/bin/shellsmith"
rm -f "$HOME/.local/share/applications/shellsmith.desktop"
for size in 16 24 32 48 64 128 256 512; do
  rm -f "$HOME/.local/share/icons/hicolor/${size}x${size}/apps/shellsmith.png"
done
# Bez obnovy databází by v nabídce zůstala viset položka, která už nic nespustí.
if command -v update-desktop-database >/dev/null; then
  update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
fi
for kb in kbuildsycoca6 kbuildsycoca5; do
  command -v "$kb" >/dev/null && "$kb" --noincremental >/dev/null 2>&1 && break
done

echo "ShellSmith odinstalován."
echo "Nastavení a uložené relace zůstávají v ~/.config/shellsmith (smažte ručně, pokud je nechcete)."
