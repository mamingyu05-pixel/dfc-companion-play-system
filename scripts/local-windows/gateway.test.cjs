"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { test } = require("node:test");
const { createGateway } = require("./gateway.cjs");

async function listen(server, t) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return server.address().port;
}

function request(port, target, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: target, method: options.method || "GET", headers: options.headers }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("error", reject);
    for (const chunk of options.chunks || []) req.write(chunk);
    req.end();
  });
}

test("same-origin route mapping preserves paths and queries for all four services", async t => {
  const ports = {};
  for (const service of ["customer", "companion", "admin", "api"]) {
    ports[service] = await listen(http.createServer((req, res) => res.end(JSON.stringify({ service, target: req.url }))), t);
  }
  const port = await listen(createGateway({ ports }), t);
  for (const [target, service, mapped] of [
    ["/customer/login/?next=%2Fcustomer%2Forders", "customer"],
    ["/companion/_next/static/file.js", "companion"],
    ["/admin/login/", "admin"], ["/api/auth/public-config?x=1", "api"],
    ["/uploads/evidence/image.png", "api"],
    ["/favicon.ico?v=2", "customer", "/customer/icon.svg?v=2"],
    ["/icon.svg", "customer", "/customer/icon.svg"],
  ]) {
    const result = await request(port, target);
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.body), { service, target: mapped || target });
  }
});

test("portal serves only exact public files, supports HEAD, and redirects retain query strings", async t => {
  const port = await listen(createGateway(), t);
  for (const target of ["/", "/terms.html", "/privacy.html", "/legal.css"]) {
    const result = await request(port, target);
    assert.equal(result.status, 200);
    assert.ok(result.body.length > 0);
    assert.equal(result.headers["x-content-type-options"], "nosniff");
    const head = await request(port, target, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(Number(head.headers["content-length"]), result.body.length);
  }
  for (const target of ["/.env", "/../package.json", "/%2e%2e/package.json", "/legal.css/extra"]) {
    assert.equal((await request(port, target)).status, 404);
  }
  assert.equal((await request(port, "/", { method: "POST" })).status, 405);
  for (const name of ["customer", "companion", "admin"]) {
    const redirect = await request(port, `/${name}?next=orders`);
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.location, `/${name}/?next=orders`);
  }
});

test("upload bytes stream unchanged and spoofed forwarding and hop headers are removed", async t => {
  const payload = Buffer.from([0, 255, 1, 0, 128, 13, 10]);
  let observed;
  const api = await listen(http.createServer((req, res) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      observed = { headers: req.headers, body: Buffer.concat(chunks), method: req.method };
      res.writeHead(201, { Connection: "close, x-private-hop", "X-Private-Hop": "private", "X-Powered-By": "fixture", "Content-Type": "application/octet-stream" });
      res.end(observed.body);
    });
  }), t);
  const port = await listen(createGateway({ ports: { api } }), t);
  const result = await request(port, "/api/uploads/evidence", { method: "POST", chunks: [payload.subarray(0, 3), payload.subarray(3)], headers: {
    Host: "spoofed.invalid", Connection: "close, x-private-request", "X-Private-Request": "private",
    "X-Forwarded-For": "203.0.113.1", "X-Forwarded-Host": "spoofed.invalid", "X-Forwarded-Proto": "https",
    Forwarded: "for=203.0.113.1", "Content-Type": "application/octet-stream", Authorization: "Bearer synthetic-fixture",
  } });
  assert.equal(result.status, 201);
  assert.deepEqual(result.body, payload);
  assert.deepEqual(observed.body, payload);
  assert.equal(observed.method, "POST");
  assert.equal(observed.headers["x-forwarded-for"], "127.0.0.1");
  assert.equal(observed.headers["x-forwarded-proto"], "http");
  assert.equal(observed.headers.host, `127.0.0.1:${port}`);
  assert.equal(observed.headers["x-forwarded-host"], `127.0.0.1:${port}`);
  assert.equal(observed.headers.forwarded, undefined);
  assert.equal(observed.headers["x-private-request"], undefined);
  assert.equal(observed.headers.authorization, "Bearer synthetic-fixture");
  assert.equal(result.headers["x-private-hop"], undefined);
  assert.equal(result.headers["x-powered-by"], undefined);
});

test("unavailable and stalled upstreams return bounded generic errors", async t => {
  const closed = http.createServer();
  closed.listen(0, "127.0.0.1");
  await once(closed, "listening");
  const unusedPort = closed.address().port;
  await new Promise(resolve => closed.close(resolve));
  let port = await listen(createGateway({ ports: { api: unusedPort } }), t);
  const unavailable = await request(port, "/api/health");
  assert.equal(unavailable.status, 502);
  assert.doesNotMatch(unavailable.body.toString(), /ECONNREFUSED|stack|127\.0\.0\.1|[A-Z]:\\/);
  const stalledPort = await listen(http.createServer(() => {}), t);
  port = await listen(createGateway({ ports: { api: stalledPort }, timeoutMs: 30 }), t);
  assert.equal((await request(port, "/api/health")).status, 504);
});

test("oversized declared and chunked uploads are rejected", async t => {
  let requests = 0;
  const api = await listen(http.createServer((req, res) => { requests++; req.resume(); req.on("end", () => res.end("ok")); }), t);
  const port = await listen(createGateway({ ports: { api } }), t);
  const declared = await request(port, "/api/uploads/evidence", { method: "POST", headers: { "Content-Length": String(22 * 1024 * 1024) } });
  assert.equal(declared.status, 413);
  assert.equal(requests, 0);
  const chunk = Buffer.alloc(1024 * 1024, 1);
  const streamed = await request(port, "/api/uploads/evidence", { method: "POST", chunks: Array(22).fill(chunk) });
  assert.equal(streamed.status, 413);
});
