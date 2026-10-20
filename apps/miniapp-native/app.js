const config = require('./api-config.js');
App({ globalData: { simulation: config.mode === 'simulation', testApiSession: null } });
