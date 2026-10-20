'use strict';
// Modes: simulation; isolated-api (local TEST only); wechat-api (HTTPS login only).
// wechat-api requires environment: 'wechat', an approved HTTPS /api baseUrl and appId.
// Credentials never belong in this file or local storage.
module.exports = Object.freeze({ mode: 'simulation', baseUrl: '', environment: 'isolated-test', appId: '' });
