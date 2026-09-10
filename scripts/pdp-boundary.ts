import * as ts from "typescript";
import { applicationPolicyFor } from "@cvg/agent-policy";

export interface PdpBoundarySource {
  path: string;
  source: string;
}

export type PdpBoundaryFindingCode =
  | "MISSING_PDP_IMPORT"
  | "MISSING_ENFORCEMENT"
  | "METHOD_BYPASS"
  | "DYNAMIC_OPERATION"
  | "MISSING_OPERATION"
  | "UNKNOWN_OPERATION";

export interface PdpBoundaryFinding {
  code: PdpBoundaryFindingCode;
  path: string;
  className: string;
  detail: string;
  operation?: string;
  method?: string;
}

export interface PdpBoundaryInspection {
  boundaryCount: number;
  boundaries: string[];
  operations: string[];
  findings: PdpBoundaryFinding[];
}

interface PolicyBindings {
  direct: ReadonlySet<string>;
  namespaces: ReadonlySet<string>;
}

interface ClassCall {
  call: ts.CallExpression;
  method: string | null;
}

type OperationResolution =
  | { kind: "static"; value: string }
  | { kind: "dynamic" }
  | { kind: "missing" };

function isThisExpression(node: ts.Expression): boolean {
  return node.kind === ts.SyntaxKind.ThisKeyword;
}

function classNameOf(node: ts.ClassDeclaration): string | null {
  return node.name?.text ?? null;
}

function memberName(node: ts.ClassElement): string | null {
  if (!("name" in node) || !node.name) return null;
  return ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : null;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some((modifier) => modifier.kind === kind) ?? false;
}

function isPublicMethod(node: ts.ClassElement): node is ts.MethodDeclaration {
  return ts.isMethodDeclaration(node)
    && memberName(node) !== null
    && !hasModifier(node, ts.SyntaxKind.PrivateKeyword)
    && !hasModifier(node, ts.SyntaxKind.ProtectedKeyword)
    && !hasModifier(node, ts.SyntaxKind.StaticKeyword);
}

function hasPdpExemption(sourceFile: ts.SourceFile, node: ts.MethodDeclaration): boolean {
  const leadingText = sourceFile.text.slice(node.getFullStart(), node.end);
  return /@pdp-exempt\s+health\b/.test(leadingText);
}

function readPolicyBindings(sourceFile: ts.SourceFile): PolicyBindings {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "@cvg/agent-policy") continue;
    const clause = statement.importClause;
    if (!clause?.namedBindings) continue;
    if (ts.isNamespaceImport(clause.namedBindings)) {
      namespaces.add(clause.namedBindings.name.text);
      continue;
    }
    for (const element of clause.namedBindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported === "enforceApplicationPolicy") direct.add(element.name.text);
    }
  }
  return { direct, namespaces };
}

function isPolicyCall(expression: ts.Expression, bindings: PolicyBindings): boolean {
  if (ts.isIdentifier(expression)) return bindings.direct.has(expression.text);
  return ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && bindings.namespaces.has(expression.expression.text)
    && expression.name.text === "enforceApplicationPolicy";
}

function staticOperation(expression: ts.Expression | undefined): OperationResolution {
  if (!expression) return { kind: "missing" };
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return { kind: "static", value: expression.text };
  if (ts.isParenthesizedExpression(expression)) return staticOperation(expression.expression);
  if (ts.isTemplateExpression(expression)) return { kind: "static", value: `${expression.head.text}SYNTHETIC` };
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticOperation(expression.left);
    const right = staticOperation(expression.right);
    if (left.kind === "static" && right.kind === "static") return { kind: "static", value: left.value + right.value };
  }
  return { kind: "dynamic" };
}

function methodNameForNode(node: ts.Node): string | null {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isMethodDeclaration(current)) return memberName(current);
    if (ts.isConstructorDeclaration(current)) return "constructor";
    current = current.parent;
  }
  return null;
}

function collectClassCalls(classNode: ts.ClassDeclaration): ClassCall[] {
  const calls: ClassCall[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== classNode && ts.isClassDeclaration(node)) return;
    if (ts.isCallExpression(node)) calls.push({ call: node, method: methodNameForNode(node) });
    ts.forEachChild(node, visit);
  };
  for (const member of classNode.members) visit(member);
  return calls;
}

function thisMethodCallName(call: ts.CallExpression): string | null {
  if (!ts.isPropertyAccessExpression(call.expression) || !isThisExpression(call.expression.expression)) return null;
  return call.expression.name.text;
}

function finding(
  code: PdpBoundaryFindingCode,
  path: string,
  className: string,
  detail: string,
  extras: { operation?: string; method?: string } = {}
): PdpBoundaryFinding {
  return { code, path, className, detail, ...extras };
}

export function inspectApplicationPdpBoundaries(sources: readonly PdpBoundarySource[]): PdpBoundaryInspection {
  const findings: PdpBoundaryFinding[] = [];
  const boundaries: string[] = [];
  const operations = new Set<string>();

  for (const { path, source } of sources) {
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const bindings = readPolicyBindings(sourceFile);
    const classes: ts.ClassDeclaration[] = [];
    const collectClasses = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node)) {
        const name = classNameOf(node);
        if (name && (name.endsWith("ApplicationService") || name === "DomainCommandService" || name === "GovernedHarness")) classes.push(node);
      }
      ts.forEachChild(node, collectClasses);
    };
    collectClasses(sourceFile);

    for (const classNode of classes) {
      const className = classNameOf(classNode) as string;
      const boundary = `${path}:${className}`;
      boundaries.push(boundary);
      const calls = collectClassCalls(classNode);
      const policyCalls = calls.filter(({ call }) => isPolicyCall(call.expression, bindings));
      const delegatedOperations = new Set<string>();
      const isDomainCommand = className === "DomainCommandService";

      if (policyCalls.length === 0) {
        if (bindings.direct.size === 0 && bindings.namespaces.size === 0) findings.push(finding("MISSING_PDP_IMPORT", path, className, "boundary has no import of enforceApplicationPolicy"));
        findings.push(finding("MISSING_ENFORCEMENT", path, className, "boundary has no direct enforceApplicationPolicy call"));
      }

      for (const { call, method } of policyCalls) {
        const resolution = staticOperation(call.arguments[1]);
        if (resolution.kind === "missing") {
          findings.push(finding("MISSING_OPERATION", path, className, "enforceApplicationPolicy must receive an operation", method ? { method } : {}));
          continue;
        }
        if (resolution.kind === "dynamic") {
          const operationArgument = call.arguments[1];
          const delegated = isDomainCommand && method === "authorize" && operationArgument !== undefined && ts.isIdentifier(operationArgument) && operationArgument.text === "operation";
          if (!delegated) findings.push(finding("DYNAMIC_OPERATION", path, className, "PDP operation must be statically enumerable or a canonical template", method ? { method } : {}));
          continue;
        }
        operations.add(resolution.value);
        if (!applicationPolicyFor(resolution.value)) findings.push(finding("UNKNOWN_OPERATION", path, className, `operation ${resolution.value} is absent from the application policy registry`, { operation: resolution.value, ...(method ? { method } : {}) }));
      }

      for (const { call, method } of calls) {
        const delegatedMethod = thisMethodCallName(call);
        if (delegatedMethod !== "run" && delegatedMethod !== "authorize") continue;
        if (isDomainCommand && method === "run") continue;
        const resolution = staticOperation(call.arguments[1]);
        if (resolution.kind === "missing") {
          findings.push(finding("MISSING_OPERATION", path, className, `this.${delegatedMethod} must receive an operation`, method ? { method } : {}));
          continue;
        }
        if (resolution.kind === "dynamic") {
          findings.push(finding("DYNAMIC_OPERATION", path, className, `this.${delegatedMethod} operation must be statically enumerable`, method ? { method } : {}));
          continue;
        }
        delegatedOperations.add(resolution.value);
        operations.add(resolution.value);
        if (!applicationPolicyFor(resolution.value)) findings.push(finding("UNKNOWN_OPERATION", path, className, `operation ${resolution.value} is absent from the application policy registry`, { operation: resolution.value, ...(method ? { method } : {}) }));
      }

      if (isDomainCommand && policyCalls.some(({ call, method }) => method === "authorize" && staticOperation(call.arguments[1]).kind === "dynamic") && delegatedOperations.size === 0) {
        findings.push(finding("DYNAMIC_OPERATION", path, className, "DomainCommandService dynamic authorize has no statically enumerated callers"));
      }

      for (const member of classNode.members) {
        if (!isPublicMethod(member)) continue;
        const method = memberName(member) as string;
        if (hasPdpExemption(sourceFile, member)) continue;
        const methodCallsInClass = calls.filter(({ call }) => methodNameForNode(call) === method);
        const hasDirectPolicy = methodCallsInClass.some(({ call }) => isPolicyCall(call.expression, bindings));
        const hasDelegatedPolicy = methodCallsInClass.some(({ call }) => {
          const delegatedMethod = thisMethodCallName(call);
          return delegatedMethod === "run" || delegatedMethod === "authorize";
        });
        if (!hasDirectPolicy && !hasDelegatedPolicy) findings.push(finding("METHOD_BYPASS", path, className, "public application method has no direct PDP enforcement or explicit authorized delegation", { method }));
      }
    }
  }

  return { boundaryCount: boundaries.length, boundaries, operations: [...operations].sort(), findings };
}
