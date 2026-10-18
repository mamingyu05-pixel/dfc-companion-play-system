import http = require("node:http");
import https = require("node:https");
import net = require("node:net");
import tls = require("node:tls");
import dns = require("node:dns");
import dgram = require("node:dgram");
import { syncBuiltinESMExports } from "node:module";
import type { IsolatedTestConfig } from "./isolated-test-runtime";

type Mutable = Record<string, any>;
type NetworkModules = { http: Mutable; https: Mutable; socket: Mutable; tls: Mutable;
  dns: Mutable; dnsPromises: Mutable; dgram: Mutable; global: Mutable; sync: () => void };

export function isolatedSocketAllowed(args: unknown[], config: IsolatedTestConfig): boolean {
  let options: any = args[0];
  if (Array.isArray(options)) options = options[0]; // Node's normalized connect arguments.
  if (typeof options === "number" || (typeof options === "string" && /^\d+$/.test(options))) {
    options = { port: options, host: args[1] };
  }
  return !!options && typeof options === "object" && !options.path && !options.socket &&
    options.host === config.host && [config.port, config.databasePort].includes(Number(options.port));
}

export function isolatedHttpAllowed(args: unknown[], config: IsolatedTestConfig): boolean {
  let options: any = args[0];
  if (typeof options === "string" || options instanceof URL) {
    let url: URL;
    try { url = new URL(String(options)); } catch { return false; }
    if (url.protocol !== "http:" || url.hostname !== config.host || Number(url.port) !== config.port || url.username || url.password) return false;
    options = { protocol: url.protocol, hostname: url.hostname, port: url.port, ...(typeof args[1] === "object" && args[1] ? args[1] : {}) };
  }
  return !!options && typeof options === "object" && (!options.protocol || options.protocol === "http:") &&
    (options.hostname ?? options.host) === config.host && Number(options.port) === config.port &&
    !options.socketPath && !options.createConnection && !options.lookup && !options.auth &&
    (options.agent === undefined || options.agent === false);
}

/** Application transport guard, not an OS sandbox. Native Prisma is constrained by the validated loopback DB URL. */
export function installIsolatedNetwork(config: IsolatedTestConfig, modules?: NetworkModules): () => void {
  const m = modules ?? { http, https, socket: net.Socket.prototype, tls, dns, dnsPromises: dns.promises,
    dgram, global: globalThis, sync: syncBuiltinESMExports } as unknown as NetworkModules;
  const undo: Array<() => void> = [];
  const deny = () => { throw new Error("Isolated TEST outbound transport blocked"); };
  function replace(target: Mutable, key: string, value: (...args: any[]) => any) {
    const original = target[key]; target[key] = value; undo.push(() => { target[key] = original; });
  }
  try {
    const connect = m.socket.connect;
    replace(m.socket, "connect", function(this: unknown, ...args: any[]) {
      if (!isolatedSocketAllowed(args, config)) return deny();
      return connect.apply(this, args);
    });
    for (const key of ["request", "get"]) {
      const original = m.http[key];
      replace(m.http, key, function(this: unknown, ...args: any[]) {
        if (!isolatedHttpAllowed(args, config)) return deny();
        return original.apply(this, args);
      });
      replace(m.https, key, deny);
    }
    replace(m.tls, "connect", deny);
    replace(m.dgram, "createSocket", deny);
    for (const target of [m.dns, m.dnsPromises, m.dns.Resolver?.prototype, m.dnsPromises.Resolver?.prototype].filter(Boolean)) {
      for (const key of Object.getOwnPropertyNames(target)) {
        if (!/^(lookup|resolve|reverse)/.test(key) || typeof target[key] !== "function") continue;
        if (key === "lookup" && (target === m.dns || target === m.dnsPromises)) {
          const lookup = target[key];
          replace(target, key, function(this: unknown, ...args: any[]) {
            // Node listen() uses lookup even for literal IPs. These exact literals take
            // Node's isIP fast path, without a resolver request; transport rules still apply.
            if (args[0] !== "127.0.0.1" && args[0] !== "::1") return deny();
            return lookup.apply(this, args);
          });
        } else replace(target, key, deny);
      }
    }
    // No application feature in this test needs fetch; the native bridge uses the bounded HTTP adapter.
    replace(m.global, "fetch", deny);
    m.sync();
  } catch (error) { for (const restore of undo.reverse()) restore(); m.sync(); throw error; }
  return () => { for (const restore of undo.reverse()) restore(); m.sync(); };
}
