import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("trusted TLS edge overwrites caller X-Forwarded-For", async () => {
  const source = await readFile("docker/nginx/proxy.tls.conf", "utf8");
  assert.match(source, /proxy_set_header X-Forwarded-For \$remote_addr/);
  assert.doesNotMatch(source, /proxy_add_x_forwarded_for/);
});

function block(source: string, marker: string): string {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing ${marker}`);
  const end = source.indexOf("\n    }", start);
  assert.ok(end >= 0, `unterminated ${marker}`);
  return source.slice(start, end);
}

const requiredEdgeHeaders = [
  /X-Content-Type-Options "nosniff"/,
  /X-Frame-Options "DENY"/,
  /Referrer-Policy "same-origin"/,
  /Permissions-Policy "camera=\(\), microphone=\(\)/,
  /Content-Security-Policy .*frame-ancestors 'none'/
];

test("cleartext development servers do not emit HSTS and keep health headers", async () => {
  const [proxy, web] = await Promise.all([
    readFile("docker/nginx/proxy.conf", "utf8"),
    readFile("docker/nginx/web.conf", "utf8")
  ]);
  for (const [name, source] of [["proxy", proxy], ["web", web]] as const) {
    assert.doesNotMatch(source, /Strict-Transport-Security/i, `${name} must remain cleartext-only`);
    const health = block(source, "location = /healthz {");
    for (const header of requiredEdgeHeaders) assert.match(health, header, `${name} healthz lost a security header`);
    assert.match(health, /Cache-Control "no-store"/);
  }
  const assets = block(web, "location /assets/ {");
  for (const header of requiredEdgeHeaders) assert.match(assets, header, "web assets lost a security header");
});

test("TLS edge emits HSTS only from the TLS server and protects healthz", async () => {
  const source = await readFile("docker/nginx/proxy.tls.conf", "utf8");
  const tlsStart = source.indexOf("server {\n    listen 8443 ssl");
  assert.ok(tlsStart >= 0);
  assert.doesNotMatch(source.slice(0, tlsStart), /Strict-Transport-Security/i, "HTTP redirect must not emit HSTS");
  const tls = source.slice(tlsStart);
  assert.match(tls, /Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"/);
  assert.match(tls, /proxy_cookie_flags ~ secure httponly samesite=strict/);
  const health = block(tls, "location = /healthz {");
  for (const header of requiredEdgeHeaders) assert.match(health, header, "TLS healthz lost a security header");
  assert.match(health, /Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"/);
});
