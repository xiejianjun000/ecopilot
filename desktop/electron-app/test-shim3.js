// Try requiring the built-in electron modules directly
const builtins = ['electron/js2c/browser_init', 'electron/js2c/node_init'];

for (const name of builtins) {
  try {
    // Use Module._load to bypass some checks
    const Module = require('module');
    const result = Module._load(name, null, true);
    console.log(`${name}: type=${typeof result}, keys=${Object.keys(result||{}).slice(0,5)}`);
  } catch(e) {
    console.log(`${name}: ERROR - ${e.message.substring(0,100)}`);
  }
}
