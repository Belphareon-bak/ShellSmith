# Architektura ShellSmithu

**Verze:** 1.1.2

Aplikace stojí na Electronu a drží se klasického rozdělení: **main proces** má
přístup k systému (procesy, sokety, disk), **renderer** kreslí rozhraní a nemá
přímý přístup k ničemu jinému než k úzkému mostu v preloadu.

```
┌─ main proces (Node) ───────────────────────────────────────────┐
│  main.js          okno, IPC, menu, přetažení ven, externí editor│
│  sessions.js      LocalSession (node-pty) │ SshSession (ssh2)   │
│  fsadapters.js    LocalAdapter            │ SftpAdapter         │
│  transfer.js      rekurzivní přenosy s průběhem a kolizemi      │
│  store.js         nastavení, relace, tajemství, stav            │
│  dragserver.js    jednorázová URL pro přetažení souboru ven     │
└────────────────────────────┬───────────────────────────────────┘
                             │ contextBridge („smith“)
┌────────────────────────────┴───────────────────────────────────┐
│  app.js           orchestrace, zkratky, stavový řádek, dialogy  │
│  terminal.js      TerminalPane – xterm.js + chování myši        │
│  tabs.js          taby a strom rozdělených panelů               │
│  files.js         FileTree – strom, výběr, drag & drop          │
│  sessionmgr.js    uložené relace a jejich editor                │
│  settingsdlg.js   nastavení generované ze schématu              │
│  themes.js        motivy (rozhraní + paleta terminálu)          │
└────────────────────────────────────────────────────────────────┘
```

`src/shared/defaults.js` je společný oběma stranám: drží výchozí hodnoty
i popis polí, ze kterého si renderer generuje dialog nastavení. Nové nastavení
se tak přidává na jednom místě.

## Relace

`BaseSession` definuje společné rozhraní (`write`, `resize`, `close`, události
`data` / `status` / `cwd` / `exit` / `prompt`) a příslib `ready()`, který se
splní ve chvíli, kdy je relace opravdu přihlášená.

`LocalSession` spouští shell přes `node-pty`. Pracovní adresář čte ze
`/proc/<pid>/cwd`, takže nepotřebuje do shellu nic vkládat.

`SshSession` staví spojení přes `ssh2`. Řeší:

- **ověření serveru** proti vlastnímu `known_hosts.json`; neznámý nebo změněný
  otisk se pošle rendereru jako dotaz (`prompt`) a spojení čeká na odpověď,
- **přihlášení** agentem, klíčem, heslem nebo keyboard-interactive (2FA),
- **jump host** — nejdřív se připojí k uložené relaci a jejím tunelem
  (`forwardOut`) protáhne cílové spojení,
- **SFTP kanál** sdílený s panelem souborů, otevřený až po `ready()`.

> Proč až po `ready()`: kdyby panel souborů požádal o SFTP během výměny klíčů,
> odešel by na server kanálový paket mimo pořadí. Server v režimu *strict KEX*
> takové spojení okamžitě ukončí. Na tuhle chybu se přišlo při testech a je to
> důvod, proč `sftp()` čeká na příslib místo aby se spoléhal na `this.client`.

### Sledování adresáře přes OSC 7

Po otevření shellu se odešle jednořádkový hook, který po každém promptu vypíše
`OSC 7` s aktuálním adresářem, a hned za ním značka `ESC ] 777 ; ss BEL`.
Do jejího příchodu se výstup shellu jen sbírá do bufferu; pak se z něj vyřízne
celý řádek s příkazem (hledá se podle názvu funkce, protože readline dlouhý
řádek při zalomení překresluje) a teprve zbytek se pošle do terminálu. Uživatel
tak vidí jen uvítání serveru a prompt.

## Souborová vrstva

`LocalAdapter` a `SftpAdapter` mají shodné rozhraní (`list`, `stat`, `mkdir`,
`rename`, `chmod`, `unlink`, `rmdir`, `createReadStream`, `createWriteStream`…).
Díky tomu je `TransferJob` jediný kus kódu pro upload, download, kopii mezi
dvěma servery i kopii v rámci jednoho stroje — liší se jen dvojice adaptérů.

Přenos má dvě fáze: **sken** (sestaví plochý seznam souborů a celkovou velikost,
aby šel ukázat smysluplný průběh) a **kopírování** (stream přes měřicí
`Transform`). Kolize názvů se řeší dotazem do rendereru, odpověď může platit i
pro všechny další. Tentýž postup platí pro přesuny souborů v rámci adaptéru,
které mohou použít přejmenování. U kopií se zapisuje výhradně vytvořený
dočasný soubor a zveřejní se až po dokončení; pro existující vzdálený cíl je
nutné rozšíření `posix-rename@openssh.com`. Bez něj se přepis odmítne.

Fronta spouští přenosy postupně. Chyba skenu ukončí přenos před zápisem.
Přeskočené soubory se nepočítají jako přenesené; stav `partial` odlišuje
částečný výsledek od `done`. Mazání po přesunu se týká pouze dokončených
souborů, jejichž metadata se nezměnila, a následně prázdných zdrojových
adresářů. Zrušení vyřeší i čekající dialog kolize.

## Rozhraní

`TerminalPane` obaluje jednu instanci xterm.js a jednu relaci. Panelů může být
v tabu víc — `Tab` drží binární strom `{ leaf | split }` a překresluje ho do
vnořených flexboxů s táhly.

Panely nejsou svázané s tabem natrvalo: `movePaneIntoSplit`, `swapPanes`
a `detachPane` přepisují jen odkazy v uzlech rozvržení a panel se přenese do
DOM cíle. Relace ani xterm se přitom nevytvářejí znovu, takže přesun mezi taby
nepřeruší spojení ani nezahodí historii.

`FileTree` si drží mapu `cesta → { children, expanded }` a z ní počítá seznam
viditelných řádků. Řádky adresářů jsou zároveň cíle pro puštění, takže lze
pustit soubor přímo „do složky" bez toho, aby se do ní muselo vstoupit.

Přetažení ven se řeší podle zdroje: lokální soubory dostanou `text/uri-list`
s `file://`, vzdálené soubory `DownloadURL` mířící na jednorázové URL
z `dragserver.js`, ze kterého Chromium obsah stáhne až ve chvíli puštění.

## Perzistence

Stav verze 2 ukládá celý strom splitů, poměry a aktivní panel i tab.
Starý formát s jediným `opts` na tab se načítá jako jeden list. Společné
funkce jsou v `src/shared/layout.js`; při obnově je zápis stavu pozastaven.

`store.js` zapisuje atomicky (zápis do `.tmp` a přejmenování) s právy `600`.
Poškozený soubor se odloží stranou místo aby se ztratil. Tajemství jdou přes
`safeStorage`; když šifrování není k dispozici, neuloží se nic.

## Testování

`npm test` spouští regresní testy v `test/`, včetně SSH handshaku a přenosů
proti dočasnému OpenSSH SFTP procesu za loopback SSH serverem. Testy IPC
ověřují skutečný handler a odmítnutí cizího odesílatele. Renderer používá
oddělený bootstrap `boot.js`, takže lze testovat jeho řídicí kód samostatně.

`npm run test:smoke` spustí Electron dvakrát s dočasnou konfigurací a headless
vykreslováním. Ověří skutečný lokální PTY, dva panely, jejich obnovu, poměr
rozdělení i motiv. `-- --screenshots docs/screenshots` navíc aktualizuje snímek
Classic. Test se nepřipojuje k uživatelským relacím. CI spouští testy, build,
smoke a úplný npm audit.

Aplikace se dá řídit zvenčí přes CDP — po spuštění s
`--remote-debugging-port=<port>` je v rendereru dostupné `window.__shellsmith`
a přes `Runtime.evaluate` lze volat cokoli z veřejného API (`connectSaved`,
`startTransfer`, `remoteTree.navigate`, …) a kontrolovat výsledek. Tímto
způsobem byl ověřen SSH handshake, dialogy, SFTP operace, přenosy včetně kolizí
a chování myši.
