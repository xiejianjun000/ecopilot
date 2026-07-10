const { app } = require('electron');
console.log('electron module type:', typeof require('electron'));
console.log('app type:', typeof app);
console.log('electron keys:', Object.keys(require('electron')).slice(0,5));
if (app) app.whenReady().then(() => { console.log('ready'); app.quit(); });
