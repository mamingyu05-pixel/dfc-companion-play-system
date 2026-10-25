"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const LOOPBACK = "127.0.0.1";
const MAX_UPLOAD_BYTES = 21 * 1024 * 1024;
const DEFAULT_PORTS = { customer: 18300, companion: 18301, admin: 18302, api: 18400 };
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/terms.html", ["terms.html", "text/html; charset=utf-8"]],
  ["/privacy.html", ["privacy.html", "text/html; charset=utf-8"]],
  ["/legal.css", ["legal.css", "text/css; charset=utf-8"]],
]);
const HOP_HEADERS = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"];

function cleanHeaders(headers) {
  const result = { ...headers };
  const connectionHeaders = String(headers.connection || "").split(",").map(value => value.trim().toLowerCase());
  for (const name of [...HOP_HEADERS, ...connectionHeaders]) delete result[name];
  return result;
}

function validPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid local port");
  return port;
}

function createGateway(options = {}) {
  const ports = { ...DEFAULT_PORTS, ...options.ports };
  for (const value of Object.values(ports)) validPort(value);
  const timeoutMs = options.timeoutMs ?? 30000;
  const portalRoot = options.portalRoot || path.resolve(__dirname, "../../infra/nginx/portal");

  const server = http.createServer((request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "SAMEORIGIN");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    const fail = (status, message) => {
      if (response.destroyed || response.writableEnded) return;
      if (response.headersSent) { response.destroy(); return; }
      if (status === 413) response.setHeader("Connection", "close");
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ message }));
    };

    const target = request.url || "/";
    if (!target.startsWith("/") || target.startsWith("//") || /[\x00-\x20\x7f\\]/.test(target)) {
      request.resume();
      fail(400, "请求地址无效");
      return;
    }
    const pathname = target.split("?", 1)[0];
    const query = target.slice(pathname.length);
    const staticFile = STATIC_FILES.get(pathname);
    if (staticFile) {
      request.resume();
      if (!["GET", "HEAD"].includes(request.method)) {
        response.setHeader("Allow", "GET, HEAD");
        fail(405, "请求方法不支持");
        return;
      }
      const file = path.join(portalRoot, staticFile[0]);
      fs.stat(file, (error, stat) => {
        if (error || !stat.isFile()) { fail(404, "页面不存在"); return; }
        if (response.destroyed) return;
        response.writeHead(200, { "Content-Type": staticFile[1], "Content-Length": stat.size, "Cache-Control": "no-cache" });
        if (request.method === "HEAD") { response.end(); return; }
        const stream = fs.createReadStream(file);
        stream.on("error", () => fail(500, "页面读取失败"));
        response.on("close", () => stream.destroy());
        stream.pipe(response);
      });
      return;
    }

    if (["/customer", "/companion", "/admin"].includes(pathname)) {
      request.resume();
      response.writeHead(308, { Location: `${pathname}/${query}` });
      response.end();
      return;
    }

    let service;
    let upstreamPath = target;
    if (pathname === "/favicon.ico" || pathname === "/icon.svg") {
      service = "customer";
      upstreamPath = `/customer/icon.svg${query}`;
    } else if (pathname.startsWith("/customer/")) service = "customer";
    else if (pathname.startsWith("/companion/")) service = "companion";
    else if (pathname.startsWith("/admin/")) service = "admin";
    else if (pathname.startsWith("/api/") || pathname.startsWith("/uploads/")) service = "api";
    if (!service) { request.resume(); fail(404, "页面不存在"); return; }

    const contentLength = request.headers["content-length"];
    if (contentLength !== undefined && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_UPLOAD_BYTES)) {
      request.resume();
      fail(413, "上传内容超过大小限制");
      return;
    }

    const headers = cleanHeaders(request.headers);
    // All services share this loopback origin; never trust client-supplied proxy identity.
    for (const name of Object.keys(headers)) {
      if (name === "forwarded" || name === "x-real-ip" || name.startsWith("x-forwarded-")) delete headers[name];
    }
    const localPort = server.address().port;
    headers.host = `${LOOPBACK}:${localPort}`;
    headers["x-real-ip"] = LOOPBACK;
    headers["x-forwarded-for"] = LOOPBACK;
    headers["x-forwarded-host"] = headers.host;
    headers["x-forwarded-port"] = String(localPort);
    headers["x-forwarded-proto"] = "http";

    let failed = false;
    const upstream = http.request({ hostname: LOOPBACK, port: ports[service], path: upstreamPath,
      method: request.method, headers, agent: false }, incoming => {
      if (failed || response.destroyed) { incoming.destroy(); return; }
      const outgoingHeaders = cleanHeaders(incoming.headers);
      delete outgoingHeaders["x-powered-by"];
      response.writeHead(incoming.statusCode || 502, outgoingHeaders);
      incoming.on("error", () => fail(502, "本机服务响应中断"));
      incoming.pipe(response);
    });
    upstream.setTimeout(timeoutMs, () => {
      failed = true;
      fail(504, "本机服务响应超时");
      upstream.destroy();
    });
    upstream.on("error", () => { if (!failed) fail(502, "本机服务暂不可用"); });
    request.on("aborted", () => upstream.destroy());
    request.on("error", () => upstream.destroy());
    response.on("close", () => { if (!response.writableFinished) upstream.destroy(); });
    let receivedBytes = 0;
    request.on("data", chunk => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_UPLOAD_BYTES && !failed) {
        failed = true;
        request.unpipe(upstream);
        upstream.destroy();
        request.resume();
        fail(413, "上传内容超过大小限制");
      }
    });
    request.pipe(upstream);
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 120000;
  server.on("upgrade", (_request, socket) => {
    socket.end("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });
  return server;
}

if (require.main === module) {
  const port = validPort(process.env.DFC_GATEWAY_PORT || 18080);
  const server = createGateway({ ports: {
    customer: validPort(process.env.DFC_CUSTOMER_PORT || DEFAULT_PORTS.customer),
    companion: validPort(process.env.DFC_COMPANION_PORT || DEFAULT_PORTS.companion),
    admin: validPort(process.env.DFC_ADMIN_PORT || DEFAULT_PORTS.admin),
    api: validPort(process.env.API_PORT || DEFAULT_PORTS.api),
  } });
  server.on("error", () => { console.error("DFC local gateway failed to start"); process.exitCode = 1; });
  server.listen(port, LOOPBACK, () => console.log(`DFC local gateway ready: http://${LOOPBACK}:${port}`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close());
}

module.exports = { createGateway };
