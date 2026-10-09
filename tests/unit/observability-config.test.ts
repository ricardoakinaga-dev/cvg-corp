import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { ALERTMANAGER_TEMPLATE_PATH, renderAlertmanagerConfig, renderAlertmanagerFromEnvironment, validateAlertmanagerSink } from "../../scripts/render-alertmanager.ts";

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

test("Alertmanager sink validation names each rejected URL shape", () => {
  assert.throws(() => validateAlertmanagerSink("${CVG_ALERTMANAGER_WEBHOOK_URL:?required}"), /unresolved template/);
  assert.throws(() => validateAlertmanagerSink("not-a-url"), /must be absolute/);
  assert.throws(() => validateAlertmanagerSink("https://alerts.example.test/hook#fragment"), /must not contain a fragment/);
  const accepted = validateAlertmanagerSink("https://alerts.example.test/hook");
  assert.equal(accepted.hostname, "alerts.example.test");
});

test("Alertmanager rendering rejects templates without exactly one governed placeholder", async () => {
  const template = await readFile(ALERTMANAGER_TEMPLATE_PATH, "utf8");
  assert.throws(() => renderAlertmanagerConfig("receivers: []\n", "https://alerts.example.test/cvg"), /exactly one/);
  const doubled = `${template}\n# extra \${CVG_ALERTMANAGER_WEBHOOK_URL:?required}\n`;
  assert.throws(() => renderAlertmanagerConfig(doubled, "https://alerts.example.test/cvg"), /exactly one/);
});

test("Alertmanager environment rendering reads the process sink and renders the governed receiver", async () => {
  const previous = process.env.CVG_ALERTMANAGER_WEBHOOK_URL;
  process.env.CVG_ALERTMANAGER_WEBHOOK_URL = "https://alerts.example.test/from-env";
  try {
    const rendered = await renderAlertmanagerFromEnvironment({ requireTls: true });
    assert.match(rendered, /url: https:\/\/alerts\.example\.test\/from-env/);
    assert.match(rendered, /receiver: cvg-webhook/);
  } finally {
    if (previous === undefined) delete process.env.CVG_ALERTMANAGER_WEBHOOK_URL;
    else process.env.CVG_ALERTMANAGER_WEBHOOK_URL = previous;
  }
});
