# Licence použitých knihoven

ShellSmith je [MIT](LICENSE). Do spustitelného balíčku (AppImage, `.deb`)
se spolu s ním distribuují níže uvedené knihovny. Všechny jsou pod
permisivními licencemi, které distribuci v rámci MIT projektu dovolují.

Seznam odpovídá stavu produkčních závislostí v `package-lock.json`;
po změně závislostí ho přegenerujte příkazem `npm run licenses`.

## Běhové závislosti

| Knihovna | Verze | Licence | Zdroj |
|---|---|---|---|
| `@xterm/addon-fit` | 0.10.0 | MIT | [https://github.com/xtermjs/xterm.js/tree/master/addons/addon-fit](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-fit) |
| `@xterm/addon-search` | 0.15.0 | MIT | [https://github.com/xtermjs/xterm.js/tree/master/addons/addon-search](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-search) |
| `@xterm/addon-unicode11` | 0.8.0 | MIT | [https://github.com/xtermjs/xterm.js/tree/master/addons/addon-unicode11](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-unicode11) |
| `@xterm/addon-web-links` | 0.11.0 | MIT | [https://github.com/xtermjs/xterm.js/tree/master/addons/addon-web-links](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-web-links) |
| `@xterm/addon-webgl` | 0.18.0 | MIT | [https://github.com/xtermjs/xterm.js/tree/master/addons/addon-webgl](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-webgl) |
| `@xterm/xterm` | 5.5.0 | MIT | [https://github.com/xtermjs/xterm.js](https://github.com/xtermjs/xterm.js) |
| `asn1` | 0.2.6 | MIT | [https://github.com/joyent/node-asn1](https://github.com/joyent/node-asn1) |
| `bcrypt-pbkdf` | 1.0.2 | BSD-3-Clause | [https://github.com/joyent/node-bcrypt-pbkdf](https://github.com/joyent/node-bcrypt-pbkdf) |
| `buildcheck` | 0.0.7 | MIT | [http://github.com/mscdex/buildcheck](http://github.com/mscdex/buildcheck) |
| `cpu-features` | 0.0.10 | MIT | [https://github.com/mscdex/cpu-features](https://github.com/mscdex/cpu-features) |
| `nan` | 2.28.0 | MIT | [https://github.com/nodejs/nan](https://github.com/nodejs/nan) |
| `node-addon-api` | 7.1.1 | MIT | [https://github.com/nodejs/node-addon-api](https://github.com/nodejs/node-addon-api) |
| `node-pty` | 1.1.0 | MIT | [https://github.com/microsoft/node-pty](https://github.com/microsoft/node-pty) |
| `safer-buffer` | 2.1.2 | MIT | [https://github.com/ChALkeR/safer-buffer](https://github.com/ChALkeR/safer-buffer) |
| `ssh2` | 1.17.0 | MIT | [http://github.com/mscdex/ssh2](http://github.com/mscdex/ssh2) |
| `tweetnacl` | 0.14.5 | Unlicense | [https://github.com/dchest/tweetnacl-js](https://github.com/dchest/tweetnacl-js) |

## Běhové prostředí

| Knihovna | Verze | Licence | Zdroj |
|---|---|---|---|
| `electron` | 37.2.1 | MIT | [https://github.com/electron/electron](https://github.com/electron/electron) |

Electron s sebou nese Chromium a Node.js, které stojí na dalších licencích
(BSD-3-Clause a další). Jejich úplné znění najdete v balíčku v souborech
`LICENSES.chromium.html` a `LICENSE.electron.txt`, které tam Electron přikládá.

## Co ShellSmith nepřibaluje

Ikony aplikace jsou původní. Žádné písmo se nedistribuuje – rozhraní i
terminál používají písma nainstalovaná v systému, a pokud zvolené písmo
chybí, sáhne se po systémovém záložním.
