import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as ts from "typescript";
import { API_ROUTE_CATALOG } from "@cvg/contracts";
import { applicationPolicyFor, WORKER_POLICY_REGISTRY } from "@cvg/agent-policy";
import { inspectRouteIdentityContextReads } from "./identity-context-boundary.ts";

export type UniversalPdpFinding = {
  code: "ROUTE_POLICY_MISSING" | "WORKER_POLICY_REGISTRY_MISSING" | "DIRECT_ROUTE_PERSISTENCE" | "DIRECT_ROUTE_READ" | "DIRECT_STORE_MUTATION" | "DOMAIN_STORE_ENCAPSULATION_MISSING" | "DOMAIN_STORE_REGISTRY_DRIFT" | "SOURCE_ANALYSIS_INCOMPLETE" | "PROOF_STATUS_PARTIAL";
  severity: "HIGH";
  detail: string;
};

const modulePath = fileURLToPath(import.meta.url);
const root = resolve(dirname(modulePath), "..");

const governedCollections = [
  "organizations", "units", "workspaces", "users", "roleAssignments", "sessions", "auditRecords", "commandReceipts", "guardians", "patients", "providers", "services", "resources", "appointments", "queueEntries", "encounters", "clinicalDocuments", "clinicalAddenda", "diagnosticRequests", "specimens", "diagnosticResults", "hospitalEpisodes", "beds", "medicationOrders", "dispensations", "products", "lots", "stockLocations", "stockMovements", "charges", "payments", "ledgerEntries", "messages", "knowledgeDocuments", "aiSessions", "aiTurns", "aiDrafts", "aiApprovals", "budgetReservations", "administrationOccurrences", "authChallenges"
] as const;
const memoryStoreMutation = new RegExp(`(?:this\\.)?store\\.(${governedCollections.join("|")})\\.(set|delete|clear)\\s*\\(`, "g");

type MutationOperation = "set" | "delete" | "clear";

export type DirectStoreMutation = {
  collection: string;
  operation: MutationOperation;
  line: number;
  expression: string;
};

type CollectionReference = { kind: "collection"; collection: string };
type UnknownCollectionReference = { kind: "unknown-collection" };
type StoreReference = { kind: "store" };
type MutationReference = { kind: "mutation"; collection: string; operation: MutationOperation };
type StaticReference = CollectionReference | UnknownCollectionReference | StoreReference | MutationReference;

const governedCollectionSet = new Set<string>(governedCollections);
const mutationOperations = new Set<MutationOperation>(["set", "delete", "clear"]);

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current)) {
    current = current.expression;
  }
  return current;
}

function staticName(expression: ts.Expression): string | undefined {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return current.text;
  if (ts.isStringLiteral(current) || ts.isNumericLiteral(current)) return current.text;
  return undefined;
}

type FunctionModel = {
  parameters: ts.BindingName[];
  body: ts.ConciseBody;
  returnExpressions: ts.Expression[];
};

function propertyName(expression: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  const argument = expression.argumentExpression;
  if (!argument) return undefined;
  const unwrapped = unwrapExpression(argument);
  return ts.isStringLiteral(unwrapped) || ts.isNumericLiteral(unwrapped) ? unwrapped.text : undefined;
}

/**
 * Resolve common CvgStore aliases as syntax nodes. This is a structural guard
 * rather than a text search: comments, strings, bracket access, casts and
 * common local aliases are inspected before a mutator is admitted.
 */
export function collectDirectStoreMutations(source: string, fileName = "inline.ts"): DirectStoreMutation[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const references = new Map<string, StaticReference>();
  const mutations: DirectStoreMutation[] = [];
  const functionModels = new Map<string, FunctionModel>();
  references.set("store", { kind: "store" });

  const mergeReferences = (values: StaticReference[]): StaticReference | undefined => {
    const first = values[0];
    if (!first) return undefined;
    const sameReference = (left: StaticReference, right: StaticReference): boolean => {
      if (left.kind !== right.kind) return false;
      if (left.kind === "collection" && right.kind === "collection") return left.collection === right.collection;
      if (left.kind === "mutation" && right.kind === "mutation") return left.collection === right.collection && left.operation === right.operation;
      return true;
    };
    if (values.every((value) => sameReference(value, first))) return first;
    return values.some((value) => value.kind === "collection" || value.kind === "mutation" || value.kind === "unknown-collection") ? { kind: "unknown-collection" } : undefined;
  };

  const bindingReference = (receiver: StaticReference | undefined, property: string): StaticReference | undefined => {
    if (receiver?.kind === "store" && governedCollectionSet.has(property)) return { kind: "collection", collection: property };
    if (receiver?.kind === "collection" && mutationOperations.has(property as MutationOperation)) {
      return { kind: "mutation", collection: receiver.collection, operation: property as MutationOperation };
    }
    if (receiver?.kind === "unknown-collection" && mutationOperations.has(property as MutationOperation)) {
      return { kind: "mutation", collection: "<dynamic>", operation: property as MutationOperation };
    }
    return undefined;
  };

  const bindPatternReference = (binding: ts.BindingName, receiver: StaticReference | undefined, target: Map<string, StaticReference>): void => {
    if (ts.isIdentifier(binding)) {
      if (receiver) target.set(binding.text, receiver);
      return;
    }
    for (const element of binding.elements) {
      if (ts.isOmittedExpression(element)) continue;
      const property = element.propertyName
        ? staticName(element.propertyName as ts.Expression)
        : ts.isIdentifier(element.name)
          ? element.name.text
          : undefined;
      if (!property) continue;
      bindPatternReference(element.name, bindingReference(receiver, property), target);
    }
  };

  const referenceFor = (expression: ts.Expression, localReferences: ReadonlyMap<string, StaticReference> = references, resolvingFunctions: ReadonlySet<string> = new Set()): StaticReference | undefined => {
    const current = unwrapExpression(expression);
    if (ts.isIdentifier(current)) return localReferences.get(current.text) ?? references.get(current.text);
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
      const functionName = current.expression.text;
      const model = functionModels.get(functionName);
      if (!model || resolvingFunctions.has(functionName)) return undefined;
      const nestedReferences = new Map(localReferences);
      for (let index = 0; index < model.parameters.length; index += 1) {
        const argument = current.arguments[index];
        if (!argument) continue;
        const argumentReference = referenceFor(argument, localReferences, new Set([...resolvingFunctions, functionName]));
        bindPatternReference(model.parameters[index]!, argumentReference, nestedReferences);
      }
      const returns = model.returnExpressions
        .map((returnExpression) => referenceFor(returnExpression, nestedReferences, new Set([...resolvingFunctions, functionName])))
        .filter((reference): reference is StaticReference => reference !== undefined);
      return mergeReferences(returns);
    }
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      const name = propertyName(current);
      if (!name) {
        const receiverReference = referenceFor(current.expression, localReferences, resolvingFunctions);
        return receiverReference?.kind === "store" ? { kind: "unknown-collection" } : undefined;
      }
      const receiverReference = referenceFor(current.expression, localReferences, resolvingFunctions);
      if (governedCollectionSet.has(name) && receiverReference?.kind === "store") return { kind: "collection", collection: name };
      if (name === "store" && (receiverReference?.kind === "store" || current.expression.kind === ts.SyntaxKind.ThisKeyword || ts.isIdentifier(current.expression) || ts.isPropertyAccessExpression(current.expression))) return { kind: "store" };
      if (receiverReference?.kind === "collection" && mutationOperations.has(name as MutationOperation)) {
        return { kind: "mutation", collection: receiverReference.collection, operation: name as MutationOperation };
      }
      if (receiverReference?.kind === "unknown-collection" && mutationOperations.has(name as MutationOperation)) {
        return { kind: "mutation", collection: "<dynamic>", operation: name as MutationOperation };
      }
    }
    return undefined;
  };

  const registerFunction = (name: string, declaration: ts.FunctionLikeDeclaration): void => {
    const returnExpressions: ts.Expression[] = [];
    if (declaration.body && ts.isBlock(declaration.body)) {
      const visitReturns = (node: ts.Node): void => {
        if (ts.isReturnStatement(node) && node.expression) returnExpressions.push(node.expression);
        if (node !== declaration.body && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) return;
        ts.forEachChild(node, visitReturns);
      };
      visitReturns(declaration.body);
    } else if (declaration.body) returnExpressions.push(declaration.body);
    functionModels.set(name, {
      parameters: declaration.parameters.map((parameter) => parameter.name),
      body: declaration.body!,
      returnExpressions
    });
  };
  const discoverFunctions = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) registerFunction(node.name.text, node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer))) registerFunction(node.name.text, node.initializer);
    ts.forEachChild(node, discoverFunctions);
  };
  discoverFunctions(sourceFile);

  /**
   * Bind object patterns one property at a time. Keeping the receiver reference
   * while descending is important for nested forms such as
   * `{ patients: { set } } = store`; flattening binding names loses the fact
   * that `set` is a mutator belonging to the `patients` collection.
   */
  const rememberBinding = (binding: ts.BindingName, initializer: ts.Expression | undefined, referenceOverride?: StaticReference): void => {
    bindPatternReference(binding, referenceOverride ?? (initializer ? referenceFor(initializer) : undefined), references);
  };

  const visitDeclarations = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) rememberBinding(node.name, node.initializer);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
      const reference = referenceFor(node.right);
      if (reference) references.set(node.left.text, reference);
    }
    ts.forEachChild(node, visitDeclarations);
  };
  for (let pass = 0; pass < 3; pass += 1) visitDeclarations(sourceFile);

  const visitCalls = (node: ts.Node, localReferences: ReadonlyMap<string, StaticReference> = references, resolvingFunctions: ReadonlySet<string> = new Set()): void => {
    if (ts.isCallExpression(node)) {
      const reference = referenceFor(node.expression, localReferences, resolvingFunctions);
      if (reference?.kind === "mutation") {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        mutations.push({ collection: reference.collection, operation: reference.operation, line: position, expression: node.getText(sourceFile) });
      }
      if (ts.isIdentifier(node.expression)) {
        const functionName = node.expression.text;
        const model = functionModels.get(functionName);
        if (model && !resolvingFunctions.has(functionName)) {
          const nestedReferences = new Map(localReferences);
          for (let index = 0; index < model.parameters.length; index += 1) {
            const argument = node.arguments[index];
            if (!argument) continue;
            const argumentReference = referenceFor(argument, localReferences, new Set([...resolvingFunctions, functionName]));
            bindPatternReference(model.parameters[index]!, argumentReference, nestedReferences);
          }
          visitCalls(model.body, nestedReferences, new Set([...resolvingFunctions, functionName]));
        }
      }
    }
    ts.forEachChild(node, (child) => visitCalls(child, localReferences, resolvingFunctions));
  };
  visitCalls(sourceFile);
  return mutations;
}

function discoverDomainCollections(source: string): { backing: Set<string>; views: Set<string>; snapshot: Set<string> } {
  const sourceFile = ts.createSourceFile("packages/domain/src/index.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const backing = new Set<string>();
  const views = new Set<string>();
  const snapshot = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      if (name.endsWith("Store") && name.length > "Store".length && name !== "quarantinedStore" && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword)) backing.add(name.slice(0, -"Store".length));
      if (node.type && name !== "quarantined" && node.type.getText(sourceFile).startsWith("ReadonlyMap<")) views.add(name);
    }
    if (ts.isInterfaceDeclaration(node) && node.name.text === "StoreSnapshot") {
      for (const member of node.members) if (ts.isPropertySignature(member) && ts.isIdentifier(member.name) && !["quarantined", "healthStatus"].includes(member.name.text)) snapshot.add(member.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { backing, views, snapshot };
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(absolute));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

/**
 * This gate deliberately separates structural admission from universal proof.
 * A green route catalog cannot hide an ungoverned worker or direct persistence
 * call. Until every boundary is registered, the command exits non-zero.
 */
export async function collectUniversalPdpFindings(): Promise<UniversalPdpFinding[]> {
  const findings: UniversalPdpFinding[] = [];
  for (const route of API_ROUTE_CATALOG) {
    if (route.auth !== "PUBLIC" && !applicationPolicyFor(route.operation)) {
      findings.push({ code: "ROUTE_POLICY_MISSING", severity: "HIGH", detail: `${route.method} /api/v1${route.path} -> ${route.operation} has no application policy` });
    }
  }

  const worker = await readFile(resolve(root, "apps/worker/src/worker.ts"), "utf8");
  if (!worker.includes("WORKER_POLICY_REGISTRY") || !worker.includes("enforceWorkerPolicy") || !worker.includes("enforceWorkerPolicy({")) {
    findings.push({ code: "WORKER_POLICY_REGISTRY_MISSING", severity: "HIGH", detail: "worker lanes/jobs do not expose a canonical policy registry and enforcement boundary" });
  }
  const requiredWorkerPolicies = ["outbox/outbox.dispatch", "jobs/storage.verify", "schedule/schedule.tick", "reconciliation/external.reconcile", "notifications/communication.dispatch", "maintenance/maintenance.cleanup"];
  const registeredWorkerPolicies = new Set(WORKER_POLICY_REGISTRY.map((rule) => `${rule.lane}/${rule.jobType}`));
  for (const identity of requiredWorkerPolicies) {
    if (!registeredWorkerPolicies.has(identity)) findings.push({ code: "WORKER_POLICY_REGISTRY_MISSING", severity: "HIGH", detail: `worker policy ${identity} is not registered` });
  }
  if (!worker.includes('enforceWorkerPolicy({ lane: "outbox", jobType: "outbox.dispatch"')) findings.push({ code: "WORKER_POLICY_REGISTRY_MISSING", severity: "HIGH", detail: "outbox dispatch must enforce policy before claiming persistence work" });

  const app = await readFile(resolve(root, "apps/api/src/app.ts"), "utf8");
  for (const finding of inspectRouteIdentityContextReads("apps/api/src/app.ts", app)) {
    findings.push({ code: "DIRECT_ROUTE_READ", severity: "HIGH", detail: `${finding.path}:${finding.line} calls store.${finding.method} directly; use ReadApplicationService` });
  }
  const directPersistence = [
    "persistence.processInboxEvent(",
    "persistence.claimCommandReceipt(",
    "persistence.outboxStats(",
    "persistence.externalEffectStats("
  ];
  for (const fragment of directPersistence) {
    if (app.includes(fragment)) findings.push({ code: "DIRECT_ROUTE_PERSISTENCE", severity: "HIGH", detail: `apps/api/src/app.ts contains ${fragment}; route-to-application-service proof is incomplete` });
  }

  const domain = await readFile(resolve(root, "packages/domain/src/index.ts"), "utf8");
  if (!domain.includes("function readOnlyMap") || !domain.includes("return Object.freeze(view)")) {
    findings.push({ code: "DOMAIN_STORE_ENCAPSULATION_MISSING", severity: "HIGH", detail: "CvgStore must expose frozen defensive collection views through readOnlyMap" });
  }
  const discovered = discoverDomainCollections(domain);
  const discoveredSets: Array<[string, Set<string>]> = [["private backing maps", discovered.backing], ["ReadonlyMap views", discovered.views], ["StoreSnapshot", discovered.snapshot]];
  for (const [kind, names] of discoveredSets) {
    const missingFromRegistry = [...names].filter((name) => !governedCollectionSet.has(name));
    const missingFromDomain = [...governedCollectionSet].filter((name) => !names.has(name));
    if (missingFromRegistry.length > 0 || missingFromDomain.length > 0) {
      findings.push({ code: "DOMAIN_STORE_REGISTRY_DRIFT", severity: "HIGH", detail: `${kind} differs from the canonical governed collection registry; missingFromRegistry=${missingFromRegistry.join(",") || "none"}; missingFromDomain=${missingFromDomain.join(",") || "none"}` });
    }
  }
  for (const collection of governedCollections) {
    if (!new RegExp(`private readonly ${collection}Store\\s*=\\s*new Map`).test(domain) || !new RegExp(`public readonly ${collection}: ReadonlyMap`).test(domain)) {
      findings.push({ code: "DOMAIN_STORE_ENCAPSULATION_MISSING", severity: "HIGH", detail: `CvgStore collection ${collection} must have a private backing map and ReadonlyMap defensive view` });
    }
    if (new RegExp(`public readonly ${collection}:\\s*Map`).test(domain)) {
      findings.push({ code: "DOMAIN_STORE_ENCAPSULATION_MISSING", severity: "HIGH", detail: `CvgStore collection ${collection} exposes a mutable Map type` });
    }
  }

  // The in-memory adapter is a local capability, but application/worker code
  // must still use explicit domain seams so a new caller cannot silently add a
  // persistence bypass that differs from the PostgreSQL path. The domain
  // module owns its backing maps; every other production source is scanned.
  for (const directory of [resolve(root, "apps"), resolve(root, "packages"), resolve(root, "scripts")]) {
    for (const file of await sourceFiles(directory)) {
      if (file.includes("/packages/domain/")) continue;
      const source = await readFile(file, "utf8");
      const analysisFile = file.replace(`${root}/`, "");
      const astMutations = collectDirectStoreMutations(source, analysisFile);
      const syntax = ts.createSourceFile(analysisFile, source, ts.ScriptTarget.Latest, true, analysisFile.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const parseDiagnostics = (syntax as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
      if (parseDiagnostics.length > 0) findings.push({ code: "SOURCE_ANALYSIS_INCOMPLETE", severity: "HIGH", detail: `${analysisFile} has ${parseDiagnostics.length} TypeScript parse diagnostic(s); universal store analysis is fail-closed` });
      if (astMutations.length > 0) {
        for (const mutation of astMutations) findings.push({ code: "DIRECT_STORE_MUTATION", severity: "HIGH", detail: `${analysisFile}:${mutation.line} calls ${mutation.operation} on governed collection ${mutation.collection}; use an explicit CvgStore persistence seam` });
      }
      // Keep a conservative lexical fallback for malformed syntax. AST is the
      // authoritative path; this fallback ensures a parse-unfriendly source
      // cannot silently bypass the gate.
      if (astMutations.length === 0 && memoryStoreMutation.test(source)) findings.push({ code: "DIRECT_STORE_MUTATION", severity: "HIGH", detail: `${analysisFile} contains a governed in-memory mutator pattern; use an explicit CvgStore persistence seam` });
      memoryStoreMutation.lastIndex = 0;
    }
  }

  const proof = await readFile(resolve(root, "docs/pdp-universal-proof.md"), "utf8");
  if (!/^Status:\s*`VERIFIED(?:_LOCAL)?`/m.test(proof)) findings.push({ code: "PROOF_STATUS_PARTIAL", severity: "HIGH", detail: "docs/pdp-universal-proof.md is not marked VERIFIED_LOCAL" });
  return findings;
}

function runStructuralGate(): number {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["run", "verify:pdp"], { cwd: root, stdio: "inherit", env: { ...process.env, VERIFY_PDP_UNIVERSAL_CHILD: "1" } });
  return result.status ?? 1;
}

const invokedAsScript = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(modulePath);
if (invokedAsScript && process.env.VERIFY_PDP_UNIVERSAL_CHILD !== "1") {
  const structuralStatus = runStructuralGate();
  if (structuralStatus !== 0) {
    process.stderr.write("PDP_UNIVERSAL_NOT_PROVEN structural PDP gate failed\n");
    process.exitCode = structuralStatus;
  } else {
    const findings = await collectUniversalPdpFindings();
    if (findings.length > 0) {
      for (const finding of findings) process.stderr.write(`FAIL ${finding.code} ${finding.detail}\n`);
      process.stderr.write("PDP_UNIVERSAL_NOT_PROVEN\n");
      process.exitCode = 1;
    } else {
      process.stdout.write("PDP_UNIVERSAL_VERIFIED\n");
    }
  }
}
