import { createHash } from "node:crypto";
import type { FastifyInstance, HTTPMethods, onRouteHookHandler } from "fastify";
import { API_ROUTE_CATALOG, type ApiRouteDescriptor } from "@cvg/contracts";
import { applicationPolicyFor } from "@cvg/agent-policy";

export interface RuntimeRouteDescriptor {
  readonly method: HTTPMethods;
  readonly path: string;
  readonly operation: string;
  readonly auth: string;
  readonly kind: "API" | "INFRASTRUCTURE" | "DERIVED_HEAD";
}

export interface RuntimeRouteInventory {
  readonly schemaVersion: 1;
  readonly status: "VERIFIED";
  readonly scope: "REGISTRATION_ONLY";
  readonly digest: string;
  readonly routes: readonly RuntimeRouteDescriptor[];
}

export class RouteCatalogError extends Error {
  readonly code = "ROUTE_CATALOG_VIOLATION";
  constructor(detail: string) { super(`Route catalog rejected startup: ${detail}`); this.name = "RouteCatalogError"; }
}

const infrastructure: readonly RuntimeRouteDescriptor[] = [
  { method: "OPTIONS", path: "*", operation: "cors.preflight", auth: "CORS_PREFLIGHT", kind: "INFRASTRUCTURE" },
  { method: "GET", path: "/internal/metrics", operation: "metrics.scrape", auth: "INTERNAL_NETWORK", kind: "INFRASTRUCTURE" }
];

/** Build expected metadata from the canonical contract, never from observed routes. */
export function runtimeRouteCatalog(api: readonly ApiRouteDescriptor[] = API_ROUTE_CATALOG, includeInfrastructure = true): readonly RuntimeRouteDescriptor[] {
  const result: RuntimeRouteDescriptor[] = [];
  for (const route of api) {
    if (route.auth !== "PUBLIC" && !applicationPolicyFor(route.operation)) throw new RouteCatalogError(`missing policy for ${route.operation}`);
    result.push({ method: route.method, path: `/api/v1${route.path}`, operation: route.operation, auth: route.auth, kind: "API" });
  }
  if (includeInfrastructure) result.push(...infrastructure);
  for (const route of [...result]) if (route.method === "GET") result.push({ ...route, method: "HEAD", kind: "DERIVED_HEAD" });
  return Object.freeze(result.map((route) => Object.freeze(route)));
}

type ObservedOptions = Parameters<onRouteHookHandler>[0];
interface Observation {
  options: ObservedOptions;
  path: string;
  methods: readonly HTTPMethods[];
  handler: ObservedOptions["handler"];
}

/**
 * Install immediately after Fastify creation. Registration membership is an
 * invariant distinct from request authorization; existing PDP remains required.
 */
export function installRuntimeRouteCatalog(app: FastifyInstance, catalog: readonly RuntimeRouteDescriptor[] = runtimeRouteCatalog()): { snapshot: () => RuntimeRouteInventory } {
  const expected = new Map<string, RuntimeRouteDescriptor>();
  for (const descriptor of catalog) {
    const key = `${descriptor.method} ${descriptor.path}`;
    if (expected.has(key)) throw new RouteCatalogError(`duplicate contract ${key}`);
    expected.set(key, Object.freeze({ ...descriptor }));
  }
  const observed = new Map<string, Observation>();
  let rejection: RouteCatalogError | null = null;
  let ready = false;
  const reject = (detail: string): never => { rejection ??= new RouteCatalogError(detail); throw rejection; };
  const methodsOf = (options: ObservedOptions): HTTPMethods[] => Array.isArray(options.method) ? [...options.method] : [options.method];
  const validateOptions = (options: ObservedOptions): void => {
    if (options.constraints && Reflect.ownKeys(options.constraints).length > 0) reject(`constraints are not cataloged for ${options.url}`);
    if (options.routePath === "/" && options.prefix && options.prefixTrailingSlash !== "no-slash") reject(`implicit prefix-root alias is not cataloged for ${options.url}`);
  };

  app.addHook("onRoute", (options) => {
    if (rejection) throw rejection;
    if (ready) reject("registration after inventory was sealed");
    validateOptions(options);
    const methods = methodsOf(options);
    // Process GET first so GET+HEAD arrays obey the same derivation invariant.
    for (const method of [...methods].sort((left, right) => left === "GET" ? -1 : right === "GET" ? 1 : left.localeCompare(right))) {
      const key = `${method} ${options.url}`;
      const descriptor = expected.get(key) ?? reject(`unregistered ${key}`);
      if (observed.has(key)) reject(`duplicate registration ${key}`);
      if (descriptor.kind === "DERIVED_HEAD") {
        const get = observed.get(`GET ${options.url}`);
        if (!get || get.handler !== options.handler) reject(`HEAD does not derive from its GET handler: ${options.url}`);
      }
      observed.set(key, { options, path: options.url, methods, handler: options.handler });
    }
  });

  const verify = (): void => {
    if (rejection) throw rejection;
    for (const [key, record] of observed) {
      const { options } = record;
      validateOptions(options);
      if (options.url !== record.path || options.path !== record.path || options.handler !== record.handler || JSON.stringify(methodsOf(options)) !== JSON.stringify(record.methods)) reject(`declaration changed after admission: ${key}`);
      const descriptor = expected.get(key)!;
      // find-my-way stores Fastify's bare '*' CORS registration as '/*'.
      const routerPath = descriptor.path === "*" ? "/*" : descriptor.path;
      if (!app.hasRoute({ method: descriptor.method, url: routerPath })) reject(`router did not register ${key}`);
    }
    for (const key of expected.keys()) if (!observed.has(key)) reject(`missing registration ${key}`);
  };
  app.addHook("onReady", async () => { verify(); ready = true; });
  // A plugin catching a registration error must not serve a partly built router.
  app.addHook("onRequest", async () => { if (rejection) throw rejection; });

  return {
    snapshot: () => {
      if (!ready) throw new RouteCatalogError("inventory is not ready");
      verify();
      const routes = Object.freeze([...expected.values()].sort((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`)));
      return Object.freeze({ schemaVersion: 1, status: "VERIFIED", scope: "REGISTRATION_ONLY", digest: createHash("sha256").update(JSON.stringify(routes)).digest("hex"), routes });
    }
  };
}
