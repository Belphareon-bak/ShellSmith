# Změny

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
