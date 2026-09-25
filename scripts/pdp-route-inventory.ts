import * as ts from "typescript";
import { validateApiRouteCatalog, type ApiRouteDescriptor } from "@cvg/contracts";
import type { PdpBoundarySource } from "./pdp-boundary.ts";

export interface RouteFinding { path: string; line: number; code: string; detail: string }
export interface ObservedRoute { method: string; url: string; path: string; line: number; operation: string | null; requestSchema: string | null; responseSchema: string | null }

const verbs = new Set(["get", "post", "put", "patch", "delete", "head", "options", "all", "route"]);
const literal = (node: ts.Node | undefined): string | undefined => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
const placeholderPathPattern = /\b(?:TODO|TBD|PLACEHOLDER|UNKNOWN|UNDEFINED|EXAMPLE|SAMPLE)\b|\$\{|<[^>]+>/i;

function routePathIssue(url: string): { code: "PLACEHOLDER_ROUTE" | "UNEXPECTED_ALIAS"; detail: string } | null {
  if (url !== "/" && url.endsWith("/")) return { code: "UNEXPECTED_ALIAS", detail: `${url}: trailing-slash alias is not cataloged` };
  if (placeholderPathPattern.test(url)) return { code: "PLACEHOLDER_ROUTE", detail: `${url}: placeholder path segment is not admissible` };
  const parameters = new Set<string>();
  for (const segment of url.split("/")) {
    if (!segment.startsWith(":")) continue;
    if (parameters.has(segment)) return { code: "PLACEHOLDER_ROUTE", detail: `${url}: duplicate path parameter ${segment}` };
    parameters.add(segment);
  }
  return null;
}

/** Inventory only: this does not prove runtime authorization or data-flow dominance. */
export function inspectHttpRouteInventory(sources: readonly PdpBoundarySource[], catalog: readonly ApiRouteDescriptor[]) {
  // This analyzer is also used with synthetic route fixtures whose response
  // name is deliberately irrelevant to the PDP question. Runtime admission
  // remains strict through the default validator mode.
  validateApiRouteCatalog(catalog, { requireRegisteredResponseSchemas: false });
  const findings: RouteFinding[] = [];
  const routes: ObservedRoute[] = [];
  const expected = new Map(catalog.map((route) => [`${route.method} /api/v1${route.path}`, route]));
  const expectedMethodsByUrl = new Map<string, string[]>();
  for (const route of catalog) {
    const url = `/api/v1${route.path}`;
    const methods = expectedMethodsByUrl.get(url) ?? [];
    methods.push(route.method);
    expectedMethodsByUrl.set(url, methods);
  }
  const observed = new Set<string>();
  for (const { path, source } of sources) {
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const receivers = new Set<string>();
    const factories = new Set<string>();
    const instanceTypes = new Set<string>();
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) || literal(statement.moduleSpecifier) !== "fastify") continue;
      if (statement.importClause?.name) factories.add(statement.importClause.name.text);
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
        const imported = binding.propertyName?.text ?? binding.name.text;
        if (imported === "fastify" || imported === "default") factories.add(binding.name.text);
        if (imported === "FastifyInstance") instanceTypes.add(binding.name.text);
      }
    }
    const walk = (node: ts.Node, visit: (node: ts.Node) => void): void => { visit(node); ts.forEachChild(node, (child) => walk(child, visit)); };
    const isReceiver = (expression: ts.Expression): boolean => {
      if (ts.isIdentifier(expression)) return receivers.has(expression.text);
      if (ts.isCallExpression(expression) && (ts.isPropertyAccessExpression(expression.expression) || ts.isElementAccessExpression(expression.expression))) return isReceiver(expression.expression.expression);
      return false;
    };
    // Fixed point handles const aliases declared before/after their source.
    let previous = -1;
    while (previous !== receivers.size) {
      previous = receivers.size;
      walk(file, (node) => {
        if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) && isReceiver(node.expression.expression) && (ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : literal(node.expression.argumentExpression)) === "register") {
          const plugin = node.arguments[0];
          if (plugin && (ts.isArrowFunction(plugin) || ts.isFunctionExpression(plugin))) {
            const parameter = plugin.parameters[0];
            if (parameter && ts.isIdentifier(parameter.name)) receivers.add(parameter.name.text);
          }
        }
        if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.type && ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName) && instanceTypes.has(node.type.typeName.text)) receivers.add(node.name.text);
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
          const init = node.initializer;
          if ((ts.isCallExpression(init) && ts.isIdentifier(init.expression) && factories.has(init.expression.text)) || (ts.isIdentifier(init) && receivers.has(init.text))) receivers.add(node.name.text);
        }
      });
    }
    const report = (node: ts.Node, code: string, detail: string): void => { findings.push({ path, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, code, detail }); };
    // CVG-AUD20-007: a locally declared request wrapper that invokes its handler
    // parameter synchronously may wrap an inline route handler.  The wrapper is
    // verified structurally (second parameter consumed by a call), never by a
    // route-name allowlist.
    const verifiedRouteWrappers = new Set<string>();
    {
      const considerWrapper = (name: string, callable: ts.ArrowFunction | ts.FunctionExpression): void => {
        const handlerParam = callable.parameters[1];
        if (!handlerParam || !ts.isIdentifier(handlerParam.name)) return;
        let consumes = false;
        const handlerName = handlerParam.name.text;
        const deferralApis = new Set(["setTimeout", "setInterval", "setImmediate", "queueMicrotask", "nextTick"]);
        const asyncLocalStorageImports = new Set<string>();
        const synchronousCallbackReceivers = new Set<string>();
        for (const statement of file.statements) {
          if (!ts.isImportDeclaration(statement) || !literal(statement.moduleSpecifier) || literal(statement.moduleSpecifier) !== "node:async_hooks") continue;
          const bindings = statement.importClause?.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) {
            for (const binding of bindings.elements) if ((binding.propertyName?.text ?? binding.name.text) === "AsyncLocalStorage") asyncLocalStorageImports.add(binding.name.text);
          }
        }
        const collectSynchronousReceivers = (current: ts.Node): void => {
          if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name) && current.initializer && ts.isNewExpression(current.initializer) && ts.isIdentifier(current.initializer.expression) && asyncLocalStorageImports.has(current.initializer.expression.text)) {
            synchronousCallbackReceivers.add(current.name.text);
          }
          ts.forEachChild(current, collectSynchronousReceivers);
        };
        collectSynchronousReceivers(file);
        const isKnownDeferredCall = (expression: ts.Expression): boolean => {
          const callee = ts.isPropertyAccessExpression(expression) ? expression.name.text : ts.isIdentifier(expression) ? expression.text : "";
          return deferralApis.has(callee) || (ts.isPropertyAccessExpression(expression) && new Set(["then", "catch", "finally"]).has(expression.name.text));
        };
        const isKnownSynchronousCallbackConsumer = (call: ts.CallExpression): boolean => {
          if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "run") return false;
          return ts.isIdentifier(call.expression.expression) && synchronousCallbackReceivers.has(call.expression.expression.text);
        };
        const visit = (current: ts.Node): void => {
          // Deferred consumption (inside a nested callback or a timer/queue
          // API) is not a verified synchronous wrapper: the route decision
          // would be hidden behind an asynchronous boundary.
          if (current !== callable.body && ts.isFunctionLike(current)) return;
          if (ts.isCallExpression(current)) {
            if (!isKnownDeferredCall(current.expression)) {
              if (ts.isIdentifier(current.expression) && current.expression.text === handlerName) consumes = true;
              if (isKnownSynchronousCallbackConsumer(current) && current.arguments.some((argument) => ts.isIdentifier(argument) && argument.text === handlerName)) consumes = true;
            }
          }
          ts.forEachChild(current, visit);
        };
        visit(callable.body);
        if (consumes) verifiedRouteWrappers.add(name);
      };
      const walkDeclarations = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
          considerWrapper(node.name.text, node.initializer);
        }
        if (ts.isFunctionDeclaration(node) && node.name && node.body) {
          const callable = ts.factory.createFunctionExpression(undefined, undefined, node.name.text, undefined, node.parameters, undefined, node.body);
          considerWrapper(node.name.text, callable as unknown as ts.FunctionExpression);
        }
        ts.forEachChild(node, walkDeclarations);
      };
      walkDeclarations(file);
    }
    walk(file, (node) => {
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && ts.isIdentifier(node.initializer) && receivers.has(node.initializer.text)) {
        report(node, "DYNAMIC_REGISTRATION", "destructured Fastify members require explicit inventory support");
      }
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && isReceiver(node.expression) && verbs.has(ts.isPropertyAccessExpression(node) ? node.name.text : literal(node.argumentExpression) ?? "") && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) {
        report(node, "DYNAMIC_REGISTRATION", "aliased Fastify route methods require explicit inventory support");
      }
      if (!ts.isCallExpression(node)) return;
      const access = node.expression;
      if (!ts.isPropertyAccessExpression(access) && !ts.isElementAccessExpression(access)) return;
      const receiver = access.expression;
      const method = ts.isPropertyAccessExpression(access) ? access.name.text : literal(access.argumentExpression);
      if (!isReceiver(receiver)) return;
      if (!method) { report(node, "DYNAMIC_REGISTRATION", "computed Fastify member cannot be inventoried"); return; }
      if (method === "register" && node.arguments[1]) {
        const options = node.arguments[1];
        if (!ts.isObjectLiteralExpression(options) || options.properties.some((property) => ts.isSpreadAssignment(property) || (property.name && (ts.isComputedPropertyName(property.name) || (ts.isIdentifier(property.name) ? property.name.text : literal(property.name)) === "prefix")))) report(node, "DYNAMIC_REGISTRATION", "plugin prefixes or dynamic options require explicit inventory support");
      }
      if (!verbs.has(method)) return;
      let methods: string[] = [method.toUpperCase()];
      let url = literal(node.arguments[0]);
      let handler: ts.Node | undefined = node.arguments.at(-1);
      if (method === "route") {
        const options = node.arguments[0];
        if (!options || !ts.isObjectLiteralExpression(options) || options.properties.some((property) => ts.isSpreadAssignment(property) || (property.name && ts.isComputedPropertyName(property.name)))) { report(node, "DYNAMIC_REGISTRATION", "route options must be a literal object without spreads or computed keys"); return; }
        const property = (name: string): ts.Expression | undefined => {
          const entry = options.properties.find((prop) => prop.name && (ts.isIdentifier(prop.name) ? prop.name.text : literal(prop.name)) === name);
          return entry && ts.isPropertyAssignment(entry) ? entry.initializer : undefined;
        };
        url = literal(property("url"));
        handler = property("handler");
        const value = property("method");
        const values = value && ts.isArrayLiteralExpression(value) ? value.elements : value ? [value] : [];
        methods = values.map((entry) => literal(entry) ?? "");
      }
      if (!url || methods.length === 0 || methods.some((verb) => !verbs.has(verb.toLowerCase()) || verb === "ALL" || verb === "ROUTE")) { report(node, "DYNAMIC_REGISTRATION", "route URL and supported methods must be literal"); return; }
      const pathIssue = routePathIssue(url);
      if (pathIssue) report(node, pathIssue.code, pathIssue.detail);
      for (const verb of methods) {
        const key = `${verb.toUpperCase()} ${url}`;
        const descriptor = expected.get(key);
        routes.push({ method: verb.toUpperCase(), url, path, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, operation: descriptor?.operation ?? null, requestSchema: descriptor?.requestSchema ?? null, responseSchema: descriptor?.responseSchema ?? null });
        if (observed.has(key)) report(node, "DUPLICATE_ROUTE", key);
        observed.add(key);
        // Separately reviewed infrastructure endpoint; never a path-prefix exemption.
        if (!descriptor && key === "GET /internal/metrics" && path === "apps/api/src/app.ts") continue;
        if (!descriptor) {
          const expectedMethods = expectedMethodsByUrl.get(url);
          if (expectedMethods) report(node, "METHOD_MISMATCH", `${key}; catalog expects ${expectedMethods.join(", ")}`);
          else report(node, "UNREGISTERED_ROUTE", key);
          continue;
        }
        if (!handler || (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler))) { report(node, "UNRESOLVED_HANDLER", `${key}: use an inline handler for static inventory`); continue; }
        if (descriptor.auth === "PUBLIC") continue;
        const operations: string[] = [];
        const isVerifiedWrapperCallback = (node: ts.Node): boolean => {
          const parent = node.parent;
          return Boolean(parent && ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && verifiedRouteWrappers.has(parent.expression.text) && parent.arguments.some((argument) => argument === node));
        };
        const visitHandler = (current: ts.Node): void => {
          if (current !== handler && ts.isFunctionLike(current) && !isVerifiedWrapperCallback(current)) return;
          if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
            const name = current.expression.text;
            const argument = current.arguments[name === "requestContext" ? 1 : 2];
            if (name === "requestContext" || name === "enforceApplicationPolicy") {
              if (argument && ts.isTemplateExpression(argument) && argument.head.text === "ai.turn." && argument.templateSpans.length === 1 && argument.templateSpans[0]?.literal.text === "") operations.push("ai.turn");
              else operations.push(literal(argument) ?? "<dynamic>");
            }
          }
          ts.forEachChild(current, visitHandler);
        };
        visitHandler(handler);
        if (!operations.includes(descriptor.operation) || operations.some((operation) => operation !== descriptor.operation)) report(node, "ROUTE_OPERATION_MISMATCH", `${key}: expected ${descriptor.operation}; observed ${operations.join(",") || "none"}`);
      }
    });
  }
  for (const key of expected.keys()) if (!observed.has(key)) findings.push({ path: "packages/contracts/src/api-catalog.ts", line: 1, code: "MISSING_ROUTE", detail: key });
  return { routes, findings };
}
