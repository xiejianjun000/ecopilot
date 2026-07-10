console.log('Electron version:', process.versions.electron);
const e = require('electron');
console.log('typeof e:', typeof e);
console.log('has app:', 'app' in (typeof e === 'object' ? e : {}));
if (e && e.app) {
  e.app.whenReady().then(() => { console.log('SUCCESS!'); e.app.quit(); });
}
