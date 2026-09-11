# Změny

## 1.1.2 — 2026-09-11

### Spuštění z nabídky plochy
- **Oprava:** aplikace nešla spustit z nabídky ani z panelu, zatímco
  z terminálu naskočila. Ubuntu 24.04 nedovolí neprivilegovaným procesům
  vytvořit user namespace, takže Electron sáhne po `chrome-sandbox`, který
  v `node_modules` není setuid root. Z terminálu to projde (shell běží
  v nevynucovaném profilu AppArmoru), z nabídky ne – plasmashell předá
  potomkům svůj enforcing profil.
- Spouštěč na situaci přijde sám a zeptá se, jestli má aplikaci spustit bez
  sandboxu; volbu si zapamatuje v `~/.config/shellsmith/allow-no-sandbox`.
  Trvalé řešení je profil AppArmor – šablona je v
  `packaging/shellsmith.apparmor.in`, `install.sh` z ní vyrobí soubor
  s doplněnou cestou.
- Spouštěč už nikdy neskončí tiše: chybějící předpoklady ohlásí i okýnkem
  (`kdialog`/`zenity`/`notify-send`), když neběží v terminálu.
- **Oprava:** `install.sh` nechával po `npm ci` prázdný
  `node_modules/electron/dist`, protože Electron od verze 44 nepublikuje
  `postinstall`. Binárku teď dotahuje sám a bez ní instalaci zastaví.

### Vzhled
- Classic se vrátil ke světlé měkké šedé podle původního MobaXtermu. Tmavá
  varianta z 1.1.1 působila proti tmavému terminálu zamlženě; plochy se teď
  liší jen o pár tónů, text je tlumená břidlice místo černé a terminál zůstává
  tmavý, ale ne uhlově černý.


## 1.1.1 — 2026-09-11

- Classic používá tlumené šedé plochy a tmavý šedý terminál; Daylight zůstává světlým motivem.
- Cesty ze souborového panelu a SSH odkazů se bezpečně escapují; řídicí znaky se odmítají. Výběr uložené relace z odkazu respektuje port.
- Kopie se dokončují přes dočasný soubor, přepisy přes SFTP vyžadují atomické přejmenování. Přesuny respektují kolize a nemažou přeskočené soubory.
- Přenosy zachovávají práva nových adresářů a symbolické odkazy, rozlišují částečné výsledky a chyby skenu. Zrušení funguje i při čekání na konflikt.
- Opraveno přihlášení šifrovanými OpenSSH klíči, dekódování děleného UTF-8, dělené OSC 7 a ukončování čekajících relací.
- Obnova zachovává celý split, poměry a aktivní panely. Opožděné odpovědi souborového panelu nepřepisují novější výběr relace.
- IPC ověřuje odesílatele a hlavní rámec. Změněný otisk serveru má výchozí akci Odmítnout; poškozené otisky blokují připojení.
- Aktualizován Electron a build nástroje; chyba nativního rebuildu již není maskovaná. Doplněny regresní testy, integrační SSH/SFTP, Electron smoke a CI.

## 1.1.0 — 2026-09-10

### Přejmenování
- Projekt se jmenuje **ShellSmith** (dříve C3Term). Přejmenován spouštěč,
  položka v nabídce, ikony, balíček i adresář s nastavením; stará konfigurace
  z `~/.config/c3term` se při prvním startu automaticky převezme.
- Motivy `C3 Nocturne` / `C3 Daylight` se jmenují `ShellSmith Nocturne` /
  `ShellSmith Daylight`; uložená volba starého motivu se namapuje na nový.

### Rozdělené panely
- **Oprava:** rozdělení nešlo vzít zpět jinak než ukončením shellu. Panely
  v rozděleném tabu teď mají hlavičku s křížkem a `Ctrl+Shift+W` zavírá panel
  (poslední panel zavře tab). Celý tab zavře `Ctrl+Shift+Q`.
- **Nové:** při rozdělení se vybírá, co se v nové polovině zobrazí — nový
  lokální terminál, zopakování relace, kterákoli uložená relace, nebo přesun
  terminálu, který už běží v jiném tabu.
- **Nové:** prohození dvou panelů (i napříč taby) a odpojení panelu do
  vlastního tabu. Relace při přesunu běží dál, spojení se nepřerušuje.
- Hlavička panelu ukazuje název relace a její stav, takže je v rozděleném
  zobrazení poznat, co kde běží.

## 1.0.0 — 2026-09-10

První vydání.

### Terminál
- Lokální shell přes `node-pty`, SSH přes `ssh2`, vykreslování xterm.js s GPU akcelerací
- Taby: přejmenování, přetahování, duplikace, opětovné připojení, indikace stavu
- Rozdělené panely vodorovně i svisle, opakovaně, s posuvnými předěly
- Označení myší kopíruje, pravé tlačítko vkládá, prostřední vkládá primární výběr
- Potvrzení víceřádkového vložení, vyhledávání v historii, zoom písma

### Soubory
- Adresářový strom s líným načítáním, vícenásobným výběrem a klávesovým ovládáním
- Drag & drop: ze systému, mezi panely, mezi servery, uvnitř serveru i ven do plochy
- Rekurzivní přenosy s průběhem, rychlostí, rušením a řešením kolizí
- Volitelný druhý (lokální) panel pro symetrické přetahování
- Vytváření adresářů, přejmenování, mazání, změna práv, otevření v externím editoru
  s automatickým uložením zpět na server
- Strom následuje `cd` v terminálu (OSC 7, u lokálních relací přes `/proc`)

### Relace
- Uložené relace ve složkách, filtrování, rychlé připojení `user@host:port`
- Přihlášení agentem, klíčem, heslem i keyboard-interactive (2FA)
- Jump host přes jinou uloženou relaci
- Otevírání odkazů `ssh://`, argumenty `--new-local` a `--sessions`
- Obnova otevřených tabů po startu

### Bezpečnost
- Vlastní `known_hosts` s potvrzením otisku a varováním při jeho změně
- Hesla a passphrase jen v klíčence systému, nikdy v čitelné podobě na disku
- Renderer v sandboxu s izolací kontextu, bez integrace Node

### Vzhled a nastavení
- Čtyři motivy (MobaXterm Dark/Classic, ShellSmith Nocturne, ShellSmith Daylight), přepínání za běhu
- Nastavení generované ze schématu, ukládá se okamžitě
- Vlastní titulková lišta s možností přepnout na systémový rámeček

### Instalace
- `install.sh` se spouštěčem, ikonami a položkou v nabídce KDE
- Konfigurace pro `electron-builder` (.deb, AppImage)
