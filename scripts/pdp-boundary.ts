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
  special: ReadonlySet<string>;
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

type CallableMember = ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.PropertyDeclaration;

function isPublicMethod(node: ts.ClassElement): node is CallableMember {
  return (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isPropertyDeclaration(node))
    && !hasModifier(node, ts.SyntaxKind.PrivateKeyword)
    && !hasModifier(node, ts.SyntaxKind.ProtectedKeyword)
    && !(node.name && ts.isPrivateIdentifier(node.name));
}

function hasPdpExemption(path: string, className: string, node: CallableMember): boolean {
  if (path === "apps/api/src/application/read-services.ts" && className === "ReadApplicationService" && ts.isMethodDeclaration(node) && !hasModifier(node, ts.SyntaxKind.StaticKeyword)) {
    const method = memberName(node);
    const body = node.body?.getText().replace(/\s+/g, "");
    // These are the only pre-context reads. Authentication and initial
    // context selection cannot evaluate the application PDP until a valid
    // actor/context exists; keep the allowlist exact and delegation-only.
    const preContextBodies: Record<string, string> = {
      getUserForAuthentication: "{returnthis.identityContext.getUser(userId);}",
      listContextOptionsForAuthentication: "{returnthis.identityContext.listContextOptions(userId);}",
      resolveContext: "{returnthis.identityContext.resolveContext(userId,selector,purpose,correlationId,patientId,encounterId,sessionId);}"
    };
    if (method && body === preContextBodies[method]) return true;
  }
  if (!ts.isMethodDeclaration(node) || memberName(node) !== "health" || node.parameters.length !== 0 || hasModifier(node, ts.SyntaxKind.StaticKeyword)) return false;
  // Pin the audited readiness implementations, not an opt-out annotation. Any
  // new access or changed body must go through the normal policy boundary.
  const body = node.body?.getText().replace(/\s+/g, "");
  return (path === "apps/api/src/application/agent-service.ts" && className === "AgentApplicationService" && body === "{returnthis.runtime.health();}")
    || (path === "packages/harness/src/index.ts" && className === "GovernedHarness" && body === '{return{engine:"READY",provider:"LOCAL_STUB_ONLY",engineCommit:DSH_ENGINE_COMMIT,manifestVersion:DSH_MANIFEST_VERSION,tools:TOOL_REGISTRY.length,profileDigest:this.profileDigest};}');
}

function readPolicyBindings(sourceFile: ts.SourceFile): PolicyBindings {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  const special = new Set<string>();
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
      if (imported === "assertIntegrationCallbackAllowed" || imported === "assertInternalMetricsPolicy") special.add(element.name.text);
    }
  }
  return { direct, namespaces, special };
}

function isPolicyCall(expression: ts.Expression, bindings: PolicyBindings): boolean {
  if (ts.isIdentifier(expression)) return bindings.direct.has(expression.text);
  return ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && bindings.namespaces.has(expression.expression.text)
    && expression.name.text === "enforceApplicationPolicy";
}

function isSpecialPolicyCall(expression: ts.Expression, bindings: PolicyBindings): boolean {
  return ts.isIdentifier(expression) && bindings.special.has(expression.text);
}

function staticOperation(expression: ts.Expression | undefined): OperationResolution {
  if (!expression) return { kind: "missing" };
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return { kind: "static", value: expression.text };
  if (ts.isParenthesizedExpression(expression)) return staticOperation(expression.expression);
  if (ts.isTemplateExpression(expression) && expression.head.text === "ai.turn." && expression.templateSpans.length === 1 && expression.templateSpans[0]?.literal.text === "" && expression.templateSpans[0].expression.getText() === "input.purpose") return { kind: "static", value: "ai.turn.SYNTHETIC" };
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
    if (ts.isMethodDeclaration(current) || ts.isGetAccessorDeclaration(current) || ts.isSetAccessorDeclaration(current) || ts.isPropertyDeclaration(current)) return memberName(current);
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

function callableBody(member: CallableMember): ts.Block | ts.Expression | undefined {
  if (!ts.isPropertyDeclaration(member)) return member.body;
  const initializer = member.initializer;
  return initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) ? initializer.body : undefined;
}

function immediateCall(statement: ts.Statement | ts.Expression): ts.CallExpression | null {
  const expression = ts.isExpressionStatement(statement) || ts.isReturnStatement(statement) ? statement.expression : statement;
  return expression && ts.isCallExpression(expression) && !expression.questionDotToken ? expression : null;
}

function hasEagerEffect(node: ts.Node): boolean {
  // Creating a callback does not execute its body. Its enclosing call must
  // still be an audited authorization delegate to establish the boundary.
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return false;
  if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isAwaitExpression(node)
    || ts.isDeleteExpression(node) || ts.isPostfixUnaryExpression(node)
    || (ts.isPrefixUnaryExpression(node) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken))
    || (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment)) return true;
  return ts.forEachChild(node, hasEagerEffect) ?? false;
}

function hasShadowedPolicyBinding(member: CallableMember, bindings: PolicyBindings): boolean {
  const names = new Set([...bindings.direct, ...bindings.namespaces]);
  const boundNames = (name: ts.BindingName | ts.Identifier): boolean => ts.isIdentifier(name)
    ? names.has(name.text)
    : name.elements.some((element) => ts.isBindingElement(element) && boundNames(element.name));
  const visit = (node: ts.Node): boolean => {
    if ((ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name) {
      if (boundNames(node.name)) return true;
    }
    return ts.forEachChild(node, visit) ?? false;
  };
  if (visit(member)) return true;
  // Import spelling alone is not provenance: a containing factory/function or
  // block may bind the same name. Inspect enclosing scopes without treating
  // parameters inside unrelated sibling functions/classes as visible here.
  const scopeBindings = (node: ts.Node): boolean => {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name && boundNames(node.name)) return true;
    if (ts.isFunctionLike(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)) return false;
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && boundNames(node.name)) return true;
    return ts.forEachChild(node, scopeBindings) ?? false;
  };
  for (let scope: ts.Node | undefined = member.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope)) {
      if (scope.parameters.some((parameter) => boundNames(parameter.name))) return true;
      if (ts.isFunctionExpression(scope) && scope.name && boundNames(scope.name)) return true;
    } else if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isCaseBlock(scope)
      || ts.isCatchClause(scope) || ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) {
      if (scopeBindings(scope)) return true;
    } else if ((ts.isClassDeclaration(scope) || ts.isClassExpression(scope)) && scope.name && boundNames(scope.name)) return true;
  }
  return false;
}

function verifiedCommandDelegates(classNode: ts.ClassDeclaration, bindings: PolicyBindings): ReadonlySet<string> {
  if (classNameOf(classNode) !== "DomainCommandService") return new Set();
  const methods = classNode.members.filter(ts.isMethodDeclaration);
  const authorize = methods.find((method) => memberName(method) === "authorize");
  const run = methods.find((method) => memberName(method) === "run");
  const validSignature = (method: ts.MethodDeclaration | undefined): method is ts.MethodDeclaration => !!method
    && hasModifier(method, ts.SyntaxKind.PrivateKeyword) && !hasModifier(method, ts.SyntaxKind.AsyncKeyword)
    && !hasModifier(method, ts.SyntaxKind.StaticKeyword) && !method.asteriskToken
    && method.parameters[0]?.name.getText() === "context" && method.parameters[1]?.name.getText() === "operation"
    && !method.parameters.some(hasEagerEffect)
    && !hasShadowedPolicyBinding(method, bindings);
  const firstCall = authorize?.body?.statements[0] && immediateCall(authorize.body.statements[0]);
  if (!validSignature(authorize) || !firstCall || !isPolicyCall(firstCall.expression, bindings)
    || firstCall.arguments.length !== 2 || firstCall.arguments[0]?.getText() !== "context" || firstCall.arguments[1]?.getText() !== "operation") return new Set();
  const verified = new Set(["authorize"]);
  const runCall = run?.body?.statements[0] && immediateCall(run.body.statements[0]);
  if (validSignature(run) && runCall && thisMethodCallName(runCall) === "authorize"
    && runCall.arguments.length === 2 && runCall.arguments[0]?.getText() === "context" && runCall.arguments[1]?.getText() === "operation") verified.add("run");
  return verified;
}

function hasExecutedBoundary(member: CallableMember, path: string, className: string, bindings: PolicyBindings, delegates: ReadonlySet<string>): boolean {
  const body = callableBody(member);
  if (!body || hasShadowedPolicyBinding(member, bindings)) return false;
  const callable = ts.isPropertyDeclaration(member) ? member.initializer : member;
  if (callable && (ts.isArrowFunction(callable) || ts.isFunctionExpression(callable) || ts.isMethodDeclaration(callable) || ts.isGetAccessorDeclaration(callable) || ts.isSetAccessorDeclaration(callable))
    && callable.parameters.some(hasEagerEffect)) return false;
  const statements: readonly (ts.Statement | ts.Expression)[] = ts.isBlock(body) ? body.statements : [body];
  let index = 0;
  // These exact production services validate an actor context without effects
  // before enforcing policy. No other arbitrary call is accepted as a prelude.
  if (((path === "apps/api/src/application/agent-service.ts" && className === "AgentApplicationService")
    || (path === "apps/api/src/application/export-service.ts" && className === "ExportApplicationService"))
    && statements[0]?.getText().replace(/\s+/g, "") === "this.store.validateContext(context);") index++;
  const statement = statements[index];
  const call = statement && immediateCall(statement);
  if (!call || call.arguments.some(hasEagerEffect)) return false;
  if (isPolicyCall(call.expression, bindings) || isSpecialPolicyCall(call.expression, bindings)) return true;
  const delegated = thisMethodCallName(call);
  return delegated !== null && delegates.has(delegated);
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
      const specialPolicyCalls = calls.filter(({ call }) => isSpecialPolicyCall(call.expression, bindings));
      const delegatedOperations = new Set<string>();
      const isDomainCommand = className === "DomainCommandService";
      const verifiedDelegates = verifiedCommandDelegates(classNode, bindings);

      if (policyCalls.length === 0 && specialPolicyCalls.length === 0) {
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
        if (ts.isConstructorDeclaration(member)) {
          for (const parameter of member.parameters) {
            // Parameter properties expose injected values as public members.
            // Their callable behavior cannot be verified at this boundary.
            if (!hasModifier(parameter, ts.SyntaxKind.PrivateKeyword) && !hasModifier(parameter, ts.SyntaxKind.ProtectedKeyword)
              && (hasModifier(parameter, ts.SyntaxKind.PublicKeyword) || hasModifier(parameter, ts.SyntaxKind.ReadonlyKeyword))) {
              findings.push(finding("METHOD_BYPASS", path, className, "public constructor parameter property exposes an unverified application entry", { method: parameter.name.getText() }));
            }
          }
        }
        if (!isPublicMethod(member)) continue;
        const method = memberName(member) ?? member.name?.getText() ?? "<computed>";
        if (hasPdpExemption(path, className, member)) continue;
        if (!hasExecutedBoundary(member, path, className, bindings, verifiedDelegates)) findings.push(finding("METHOD_BYPASS", path, className, "public application entry must execute PDP enforcement or a verified synchronous delegate before effects; unsupported control flow fails closed", { method }));
      }
    }
  }

  return { boundaryCount: boundaries.length, boundaries, operations: [...operations].sort(), findings };
}
