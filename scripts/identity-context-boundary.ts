import * as ts from "typescript";

export const ROUTE_IDENTITY_CONTEXT_READ_METHODS = ["getUser", "resolveContext", "contextOptions", "listUsers"] as const;
export type RouteIdentityContextReadMethod = typeof ROUTE_IDENTITY_CONTEXT_READ_METHODS[number];

export interface IdentityContextBoundaryFinding {
  path: string;
  line: number;
  method: RouteIdentityContextReadMethod;
  detail: string;
}

function propertyName(expression: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  const argument = expression.argumentExpression;
  return argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) ? argument.text : undefined;
}

function isStoreReference(expression: ts.Expression, aliases: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(expression)) return aliases.has(expression.text);
  if (!ts.isPropertyAccessExpression(expression)) return false;
  return expression.name.text === "store" && (expression.expression.kind === ts.SyntaxKind.ThisKeyword || aliases.has(expression.expression.getText()));
}

/**
 * Route-level structural guard for identity/context reads. Authentication
 * lookups such as getUserByLogin and challenge/session validation are outside
 * this list because they establish the pre-context authentication boundary.
 */
export function inspectRouteIdentityContextReads(path: string, source: string): IdentityContextBoundaryFinding[] {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const aliases = new Set<string>(["store"]);
  let previousSize = -1;
  while (previousSize !== aliases.size) {
    previousSize = aliases.size;
    const collect = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isStoreReference(node.initializer, aliases)) aliases.add(node.name.text);
      ts.forEachChild(node, collect);
    };
    collect(sourceFile);
  }

  const findings: IdentityContextBoundaryFinding[] = [];
  const methodSet = new Set<string>(ROUTE_IDENTITY_CONTEXT_READ_METHODS);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))) {
      const access = node.expression;
      const method = propertyName(access);
      if (method && methodSet.has(method) && isStoreReference(access.expression, aliases)) {
        findings.push({
          path,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          method: method as RouteIdentityContextReadMethod,
          detail: `route code calls store.${method} directly; use ReadApplicationService`
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}
