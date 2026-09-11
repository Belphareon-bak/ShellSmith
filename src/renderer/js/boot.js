import { App } from './app.js';

const app = new App();
window.__shellsmith = app;
app.boot().catch(e => {
  const error = document.createElement('pre');
  error.className = 'boot-error';
  error.textContent = `Chyba při startu:\n${e.stack || e}`;
  document.body.replaceChildren(error);
});
