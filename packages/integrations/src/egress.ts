import { promises as dns } from "node:dns";
import { request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

/**
 * The HTTP response surface required by the egress contract.  `body` is the
 * preferred path because it permits incremental consumption.  `text` and
 * `json` remain available for deterministic test transports and legacy
 * providers; production fetch implementations expose `body`.
 */
export interface EgressHttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers?: { get?(name: string): string | null } | Readonly<Record<string, string | undefined>>;
  readonly body?: ReadableStream<Uint8Array> | null;
  text?(): Promise<string>;
  json?(): Promise<unknown>;
}

export type EgressFetch = (input: string, init?: RequestInit, target?: EgressTarget) => Promise<EgressHttpResponse>;
export type EgressDnsResolver = (hostname: string) => Promise<readonly string[]>;

export interface EgressPolicy {
  /** Exact host matches only; subdomains are not implicitly trusted. */
  readonly allowedHosts?: readonly string[];
  /** Defaults to HTTPS unless allowInsecure is explicitly true. */
  readonly allowInsecure?: boolean;
  readonly allowedPorts?: readonly number[];
  /** Operator-specific IPv6 translation or tunnel prefixes to deny in this network. */
  readonly blockedIpv6Prefixes?: readonly string[];
  readonly maxRedirects?: number;
  /** Injected in tests and controlled runtimes; production defaults to DNS. */
  readonly resolveHostname?: EgressDnsResolver;
}

export interface EgressTarget {
  readonly url: string;
  readonly protocol: "http:" | "https:";
  readonly hostname: string;
  readonly port: number;
  readonly addresses: readonly string[];
}

export interface EgressFetchResult {
  readonly response: EgressHttpResponse;
  readonly finalUrl: string;
  readonly target: EgressTarget;
  readonly redirects: readonly string[];
}

export class EgressPolicyViolation extends Error {
  constructor(
    readonly phase: "INITIAL" | "REDIRECT",
    readonly reason: string,
    readonly targetUrl: string
  ) {
    super(`egress policy rejected ${phase.toLowerCase()} target: ${reason}`);
    this.name = "EgressPolicyViolation";
  }
}

const MAX_REDIRECTS = 5;
const DEFAULT_ALLOWED_PORTS = [443] as const;
const BUILT_IN_BLOCKED_IPV6_PREFIXES = [
  "64:ff9b::/32", // Well-known and local-use IPv4/IPv6 translation space.
  "2001::/32", // Teredo.
  "2002::/16", // 6to4.
  "100::/64" // Discard-only.
] as const;

/**
 * Network policy deliberately rejects non-global addresses.  The URL parser
 * canonicalizes decimal/hex-like host spellings before this function is
 * reached, while DNS answers are checked directly, including IPv4-mapped IPv6.
 */
export function isAllowedEgressAddress(address: string, blockedIpv6Prefixes: readonly string[] = []): boolean {
  if (!Array.isArray(blockedIpv6Prefixes) || blockedIpv6Prefixes.some((prefix) => !parseIpv6Prefix(prefix))) return false;
  const value = address.trim().toLowerCase().replace(/%.*$/, "");
  const family = isIP(value);
  if (family === 4) return isAllowedIpv4(value);
  if (family !== 6) return false;

  const bytes = parseIpv6(value);
  if (!bytes) return false;
  if ([...BUILT_IN_BLOCKED_IPV6_PREFIXES, ...blockedIpv6Prefixes].some((prefix) => ipv6MatchesPrefix(bytes, prefix))) return false;
  const mapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mapped) return isAllowedIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);

  // Unspecified, loopback, link-local, ULA, multicast and documentation IPv6.
  const unspecified = bytes.every((byte) => byte === 0);
  const loopback = unspecified || bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  const linkLocal = bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80;
  const uniqueLocal = (bytes[0]! & 0xfe) === 0xfc;
  const multicast = bytes[0] === 0xff;
  const documentation = bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8;
  if (loopback || linkLocal || uniqueLocal || multicast || documentation) return false;
  return true;
}

export const defaultEgressDnsResolver: EgressDnsResolver = async (hostname) => {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

/**
 * Native production transport for the policy boundary. The validated address
 * is supplied to the socket lookup callback, so the connection does not run a
 * second uncontrolled DNS lookup after policy validation. Injected transports
 * remain available for deterministic tests and must honor the third argument
 * when they perform real network I/O.
 */
export const pinnedEgressFetch: EgressFetch = async (input, init = {}, target) => {
  if (!target) throw new Error("pinned egress transport requires a validated target");
  const parsed = new URL(input);
  const address = target.addresses[0];
  if (!address) throw new Error("pinned egress target has no resolved address");
  const family = isIP(address);
  const headers = new Headers(init.headers);
  if (!headers.has("accept-encoding")) headers.set("accept-encoding", "identity");
  const requestBody = bodyBytes(init.body);
  const requestOptions: RequestOptions = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    method: String(init.method ?? "GET").toUpperCase(),
    path: `${parsed.pathname || "/"}${parsed.search}`,
    headers: Object.fromEntries(headers.entries()),
    lookup: pinnedLookup(address, family),
    ...(init.signal ? { signal: init.signal } : {})
  };
  const requestFn = target.protocol === "https:" ? httpsRequest : httpRequest;
  return await new Promise<EgressHttpResponse>((resolve, reject) => {
    const request = requestFn(requestOptions, (response: IncomingMessage) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) for (const item of value) responseHeaders.append(name, item);
        else if (value !== undefined) responseHeaders.set(name, value);
      }
      resolve({
        status: response.statusCode ?? 0,
        ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
        headers: responseHeaders,
        body: Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>
      });
    });
    request.once("error", reject);
    if (requestBody) request.write(requestBody);
    request.end();
  });
};

export async function validateEgressTarget(rawUrl: string, policy: EgressPolicy = {}, phase: "INITIAL" | "REDIRECT" = "INITIAL"): Promise<EgressTarget> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new EgressPolicyViolation(phase, "invalid URL", rawUrl);
  }

  const protocol = parsed.protocol;
  if (protocol !== "https:" && !(protocol === "http:" && policy.allowInsecure === true)) {
    throw new EgressPolicyViolation(phase, "protocol is not allowed", rawUrl);
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new EgressPolicyViolation(phase, "credentials and fragments are not allowed", rawUrl);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!hostname) throw new EgressPolicyViolation(phase, "hostname is empty", rawUrl);
  const requestedBlockedIpv6Prefixes = policy.blockedIpv6Prefixes ?? [];
  if (!Array.isArray(requestedBlockedIpv6Prefixes) || requestedBlockedIpv6Prefixes.length > 20 || requestedBlockedIpv6Prefixes.some((prefix) => !parseIpv6Prefix(prefix))) {
    throw new EgressPolicyViolation(phase, "blocked IPv6 prefix policy is invalid", rawUrl);
  }
  const blockedIpv6Prefixes = Object.freeze([...requestedBlockedIpv6Prefixes]);
  const allowedHosts = policy.allowedHosts?.map(normalizeHost).filter(Boolean) ?? undefined;
  if (allowedHosts !== undefined && (!allowedHosts.length || !allowedHosts.includes(hostname))) {
    throw new EgressPolicyViolation(phase, "hostname is not allowlisted", rawUrl);
  }

  const port = parsed.port ? Number(parsed.port) : protocol === "https:" ? 443 : 80;
  const allowedPorts = policy.allowedPorts ?? (protocol === "https:" ? DEFAULT_ALLOWED_PORTS : [80]);
  if (!Number.isInteger(port) || !allowedPorts.includes(port)) {
    throw new EgressPolicyViolation(phase, "port is not allowlisted", rawUrl);
  }

  let addresses: readonly string[];
  if (isIP(hostname)) {
    addresses = [hostname];
  } else {
    const resolver = policy.resolveHostname ?? defaultEgressDnsResolver;
    try {
      addresses = await resolver(hostname);
    } catch {
      throw new EgressPolicyViolation(phase, "hostname resolution failed", rawUrl);
    }
  }
  if (!addresses.length || addresses.some((address) => !isAllowedEgressAddress(address, blockedIpv6Prefixes))) {
    throw new EgressPolicyViolation(phase, "a resolved address is private, reserved or otherwise non-global", rawUrl);
  }

  return { url: parsed.toString(), protocol, hostname, port, addresses: Object.freeze([...addresses]) };
}

/**
 * Fetches with redirects disabled at the platform layer.  If redirects are
 * explicitly enabled, every Location is parsed, allowlisted and resolved
 * again.  A redirect never carries authorization/cookie headers to its next
 * hop, and non-GET redirects are rejected to avoid replaying a send effect.
 */
export async function fetchWithEgressPolicy(fetcher: EgressFetch, rawUrl: string, init: RequestInit = {}, policy: EgressPolicy = {}): Promise<EgressFetchResult> {
  const maxRedirects = policy.maxRedirects ?? 0;
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > MAX_REDIRECTS) {
    throw new EgressPolicyViolation("INITIAL", "redirect budget is invalid", rawUrl);
  }

  let currentUrl = rawUrl;
  let currentInit: RequestInit = { ...init, redirect: "manual" };
  const redirects: string[] = [];
  for (let redirectCount = 0; ; redirectCount += 1) {
    const target = await validateEgressTarget(currentUrl, policy, redirectCount === 0 ? "INITIAL" : "REDIRECT");
    const response = await fetcher(target.url, currentInit, target);
    if (!isRedirectStatus(response.status)) return { response, finalUrl: target.url, target, redirects: Object.freeze([...redirects]) };

    const location = headerValue(response.headers, "location");
    await cancelResponseBody(response);
    if (!location) throw new EgressPolicyViolation("REDIRECT", "redirect did not provide a Location", target.url);
    if (redirectCount >= maxRedirects) throw new EgressPolicyViolation("REDIRECT", "redirect budget exhausted", target.url);
    const method = String(currentInit.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") throw new EgressPolicyViolation("REDIRECT", "redirecting a non-read request is disabled", target.url);
    let nextUrl: URL;
    try {
      nextUrl = new URL(location, target.url);
    } catch {
      throw new EgressPolicyViolation("REDIRECT", "redirect Location is invalid", location);
    }
    redirects.push(nextUrl.toString());
    currentUrl = nextUrl.toString();
    currentInit = { ...currentInit, redirect: "manual", headers: withoutSensitiveHeaders(currentInit.headers) };
  }
}

export function headerValue(headers: EgressHttpResponse["headers"], name: string): string | null {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1] ?? null;
}

function withoutSensitiveHeaders(headers: HeadersInit | undefined): Headers {
  const result = new Headers(headers);
  result.delete("authorization");
  result.delete("cookie");
  result.delete("proxy-authorization");
  return result;
}

async function cancelResponseBody(response: EgressHttpResponse): Promise<void> {
  try { await response.body?.cancel("redirect response body discarded"); } catch { /* release is best effort */ }
}

function bodyBytes(body: BodyInit | null | undefined): string | Uint8Array | undefined {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  throw new TypeError("pinned egress transport accepts only bounded byte or string request bodies");
}

function pinnedLookup(address: string, family: number): NonNullable<RequestOptions["lookup"]> {
  return ((_hostname: string, _options: object, callback: (error: NodeJS.ErrnoException | null, resolvedAddress: string, resolvedFamily: number) => void) => {
    callback(null, address, family);
  }) as NonNullable<RequestOptions["lookup"]>;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function normalizeHost(host: string): string {
  const raw = host.trim().toLowerCase().replace(/\.$/, "");
  if (!raw) return "";
  try {
    return new URL(`https://${raw}`).hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

function isAllowedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second, third] = parts as [number, number, number, number];
  if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
  if (first === 169 && second === 254) return false;
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && (second === 0 || second === 168)) return false;
  if (first === 198 && (second === 18 || second === 19 || second === 51)) return false;
  if (first === 203 && second === 0 && third === 113) return false;
  if (first === 100 && second >= 64 && second <= 127) return false;
  return true;
}

function parseIpv6(value: string): readonly number[] | null {
  const sections = value.split("::");
  if (sections.length > 2) return null;
  const parseSection = (section: string): number[] => {
    if (!section) return [];
    const groups: number[] = [];
    for (const token of section.split(":")) {
      if (token.includes(".")) {
        const octets = token.split(".").map(Number);
        if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return [];
        groups.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(token)) return [];
      groups.push(Number.parseInt(token, 16));
    }
    return groups;
  };
  const left = parseSection(sections[0] ?? "");
  const right = sections.length === 2 ? parseSection(sections[1] ?? "") : [];
  if ((sections[0] && left.length === 0) || (sections[1] && right.length === 0)) return null;
  const missing = sections.length === 2 ? 8 - left.length - right.length : 0;
  if ((sections.length === 2 && missing < 1) || (sections.length === 1 && left.length !== 8) || left.length + right.length + missing !== 8) return null;
  const groups = [...left, ...new Array<number>(missing).fill(0), ...right];
  if (groups.length !== 8) return null;
  return Object.freeze(groups.flatMap((group) => [group >> 8, group & 0xff]));
}

function parseIpv6Prefix(value: string): { readonly bytes: readonly number[]; readonly bits: number } | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([^/]+)\/(\d{1,3})$/);
  if (!match) return null;
  const bytes = parseIpv6(match[1]!.toLowerCase().replace(/%.*$/, ""));
  const bits = Number(match[2]);
  if (!bytes || !Number.isInteger(bits) || bits < 0 || bits > 128) return null;
  return { bytes, bits };
}

function ipv6MatchesPrefix(address: readonly number[], prefix: string): boolean {
  const parsed = parseIpv6Prefix(prefix);
  if (!parsed) return false;
  const wholeBytes = Math.floor(parsed.bits / 8);
  for (let index = 0; index < wholeBytes; index += 1) {
    if (address[index] !== parsed.bytes[index]) return false;
  }
  const remainingBits = parsed.bits % 8;
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return ((address[wholeBytes]! ^ parsed.bytes[wholeBytes]!) & mask) === 0;
}
