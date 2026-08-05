console.log('Electron version:', process.versions.electron);

// Check the require cache for electron modules
const electronCacheKeys = Object.keys(require.cache).filter(k => k.includes('electron'));
console.log('Electron cache keys:', electronCacheKeys);

// Check if browser_init is in module.builtinModules
const Module = require('module');
if (Module.builtinModules) {
  const eMods = Module.builtinModules.filter(k => k.includes('electron'));
  console.log('Electron builtins:', eMods);
}

// Try to get the internal electron module differently
// In Electron, the module might be exposed through __non_webpack_require__
try {
  if (typeof __non_webpack_require__ !== 'undefined') {
    console.log('__non_webpack_require__ exists');
  }
} catch(e) {}

// Check process._preload_modules
console.log('process._preload_modules:', process._preload_modules);

// Check the Electron binding for available modules
try {
  const binding = process._linkedBinding('electron_common_features');
  console.log('binding type:', typeof binding);
  console.log('binding keys:', Object.keys(binding));
  if (binding.getAppPath) console.log('getAppPath exists');
} catch(e) {
  console.log('electron_common_features error:', e.message);
}
