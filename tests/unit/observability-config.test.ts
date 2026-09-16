import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { ALERTMANAGER_TEMPLATE_PATH, renderAlertmanagerConfig, validateAlertmanagerSink } from "../../scripts/render-alertmanager.ts";

test("Alertmanager rendering fails closed without an authority URL", () => {
  assert.throws(() => validateAlertmanagerSink(undefined), /CVG_ALERTMANAGER_WEBHOOK_URL is required/);
  assert.throws(() => validateAlertmanagerSink("https://user:password@alerts.example.test/hook"), /must not embed credentials/);
  assert.throws(() => validateAlertmanagerSink("http://alerts.example.test/hook"), /must use HTTPS/);
  assert.throws(() => validateAlertmanagerSink("http://alerts.example.test/hook", { requireTls: true }), /must use HTTPS/);
});

test("Alertmanager rendering produces an effective governed config for a controlled local sink", async () => {
  const template = await readFile(ALERTMANAGER_TEMPLATE_PATH, "utf8");
  const rendered = renderAlertmanagerConfig(template, "http://127.0.0.1:18080/alerts");
  assert.match(rendered, /receiver: cvg-webhook/);
  assert.match(rendered, /url: http:\/\/127\.0\.0\.1:18080\/alerts/);
  assert.doesNotMatch(rendered, /\$\{CVG_ALERTMANAGER_WEBHOOK_URL/);
  assert.doesNotMatch(rendered, /cvg-null/);
});

test("production Alertmanager rendering requires HTTPS and removes the template token", async () => {
  const template = await readFile(ALERTMANAGER_TEMPLATE_PATH, "utf8");
  const rendered = renderAlertmanagerConfig(template, "https://alerts.example.test/cvg", { requireTls: true });
  assert.match(rendered, /url: https:\/\/alerts\.example\.test\/cvg/);
  assert.doesNotMatch(rendered, /\$\{/);
});
