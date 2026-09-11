# Ověření 1.1.1 — 2026-09-11

Změny vznikly nad commitem `49f95f712468e33d205243c5ab01d82514ad8703`.
Před opravami byl pracovní strom čistý. Běžící uživatelské relace ani jejich
konfigurace se při testech neměnily. Místní instalace ze zdrojů byla následně
aktualizována přes `install.sh`, včetně položky nabídky KDE.

| Kontrola | Výsledek a rozsah |
|---|---|
| `npm ci` / `postinstall` | Dokončeno v rámci instalace; nativní rebuild `node-pty` prošel |
| `npm test` | 26 testů, 26 PASS, 0 FAIL, 0 skipped |
| `npm run build:renderer` | Sestavení JS a CSS prošlo |
| `npm run test:smoke` | Skutečný Electron 44.3.0, lokální PTY a příkaz v shellu; dva panely se po restartu obnovily v poměru 0.6 a s původním aktivním panelem |
| `npm audit` | 0 nálezů v celém stromu, včetně devDependencies |
| `npm run dist` | Sestaveny `ShellSmith-1.1.1.AppImage` a `shellsmith_1.1.1_amd64.deb` |
| Obsah balíčku | ASAR obsahuje renderer, nové sdílené moduly, LICENSE a THIRD-PARTY-NOTICES |
| Classic | Snímek z běžícího Electronu zkontrolován; šedé plochy nahradily téměř bílé pozadí. Daylight nebyl změněn |
| `bash -n` / `git diff --check` | Bez chyb |

Regresní pokrytí:

- Skutečný IPC handler přesunu čeká na řešení kolize; cizí renderer nebo rámec
  nemůže volat privilegované kanály.
- Přenosy zachovávají obsah, práva nových adresářů a symlinky. Přeskočený zdroj
  zůstává zachován i při přesunu; poškozený sken se nevydává za dokončenou kopii.
- Simulovaná chyba nebo zrušení streamu zachová původní cíl a uklidí staging.
  Zrušení ukončí čekání na konflikt. Souběžně vzniklý cíl se nepřepíše bez souhlasu.
- Přenos sám na sebe nebo do podadresáře se odmítne. Fronta spouští úlohy postupně.
- Skutečný SSH handshake používá nově vygenerovaný šifrovaný OpenSSH Ed25519
  klíč nebo heslo; změněný host key se při odmítnutí nepřijme. Přenosy po síti
  používají OpenSSH `sftp-server`, včetně atomického přepsání a downloadu.
- Rozdělený UTF-8 znak i OSC 7 sekvence se správně složí. Ukončení relace vyřeší
  čekání na přihlášení a na odpověď uživatele.
- Názvy adresářů a SSH URL s apostrofy nemění význam příkazu; řídicí znaky se
  odmítají. SSH URL vybírá uloženou relaci i podle portu.
- Opožděné odpovědi na navázání panelu a výpis adresáře nepoškodí nový výběr.
  Celý strom splitu se serializuje; načítá se také původní formát stavu.

Při rozšiřování smoke testu se objevil falešný neúspěch: shell někdy před
kontrolní výstup vložil prompt na stejný řádek. Test nyní hledá krátký sentinel
vytvořený až vykonáním `printf`, který není přítomen v echu vstupního příkazu.
Po úpravě prošly tři po sobě jdoucí dvojice start/obnova.

Pro SFTP overwrite je nutné `posix-rename@openssh.com`; bez této schopnosti
serveru se přepis bezpečně odmítne a uživatel může zvolit jiný název. Atomické
zveřejnění souboru není zárukou odolnosti proti výpadku napájení ani snapshotem
souboru, který souběžně mění jiný proces.

Toto ověření nepokrývá všechny kombinace reálných serverů, jump hostů a 2FA,
skutečnou klíčenku plochy, systémové přetahování X11/Wayland ani chování všech
externích editorů. Smoke ověřuje aplikaci ze zdrojů; instalace `.deb` a start
AppImage nebyly součástí testu. CI konfigurace je připravena, její vzdálený běh
se v tomto lokálním ověření nespouštěl.
