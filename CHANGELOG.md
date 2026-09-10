# Změny

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
- Čtyři motivy (MobaXterm Dark/Classic, C3 Nocturne, C3 Daylight), přepínání za běhu
- Nastavení generované ze schématu, ukládá se okamžitě
- Vlastní titulková lišta s možností přepnout na systémový rámeček

### Instalace
- `install.sh` se spouštěčem, ikonami a položkou v nabídce KDE
- Konfigurace pro `electron-builder` (.deb, AppImage)
