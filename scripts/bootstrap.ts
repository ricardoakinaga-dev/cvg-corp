import { mkdir, writeFile } from "node:fs/promises";
import { CvgStore, serializeSnapshot } from "@cvg/domain";

const store = new CvgStore();
await mkdir(".local", { recursive: true });
await writeFile(".local/bootstrap-credentials.json", JSON.stringify({ generatedAt: new Date().toISOString(), mode: "memory-synthetic", login: store.bootstrapCredentials.login, password: store.bootstrapCredentials.password, note: "Local only. Never promote this file or its values to another environment." }, null, 2), { mode: 0o600 });
await writeFile(".local/synthetic-snapshot.json", serializeSnapshot(store.snapshot()), { mode: 0o600 });
process.stdout.write(`Bootstrap sintético criado em .local/\nLogin: ${store.bootstrapCredentials.login}\nSenha gerada: ${store.bootstrapCredentials.password}\n`);
