import { ControllerMeta, ParamMeta } from "../extraction/controller-meta";
import {
  controllerToResultSdkClassName,
  controllerToSdkClassName,
} from "../utils";
import { methodErrorTypeName } from "./errors-file";

export function buildRoutePath(
  basePath: string,
  routePath: string,
  params: ParamMeta[],
): string {
  const cleanRoutePath = routePath.startsWith("/")
    ? routePath.substring(1)
    : routePath;
  const fullPath = cleanRoutePath ? `${basePath}/${cleanRoutePath}` : basePath;

  let pathExpr = fullPath;

  const placeholders = fullPath.match(/:(\w+)/g);
  if (!placeholders) {
    return `'${pathExpr}'`;
  }

  let needsTemplate = false;
  for (const placeholder of placeholders) {
    const paramName = placeholder.substring(1);
    const paramMeta = params.find(
      (p) =>
        p.kind === "param" &&
        (p.routeParamName === paramName || p.name === paramName),
    );
    if (paramMeta) {
      needsTemplate = true;
      if (paramMeta.routeParamName) {
        pathExpr = pathExpr.replace(`:${paramName}`, `\${${paramMeta.name}}`);
      } else {
        pathExpr = pathExpr.replace(
          `:${paramName}`,
          `\${${paramMeta.name}.${paramName}}`,
        );
      }
    } else {
      const dtoParam = params.find(
        (p) => p.kind === "param" && !p.routeParamName,
      );
      if (dtoParam) {
        needsTemplate = true;
        pathExpr = pathExpr.replace(
          `:${paramName}`,
          `\${${dtoParam.name}.${paramName}}`,
        );
      }
    }
  }

  return needsTemplate ? `\`${pathExpr}\`` : `'${pathExpr}'`;
}

interface MethodSignature {
  name: string;
  paramsStr: string;
  returnTypeStr: string;
  httpVerb: string;
  routeExpr: string;
  optsStr: string;
  errorTypeName: string;
}

function buildMethodSignature(
  method: ControllerMeta["methods"][number],
  meta: ControllerMeta,
  resolveType: (t: string) => string,
): MethodSignature {
  const returnTypeStr = method.returnType
    ? method.isArrayResponse
      ? `${method.returnType}[]`
      : method.returnType
    : "any";

  const sdkParams: string[] = [];
  let hasBody = false;
  let bodyParamName = "";
  let hasQuery = false;
  let queryParamName = "";

  for (const param of method.params) {
    const resolvedType = resolveType(param.typeName);
    switch (param.kind) {
      case "param":
        sdkParams.push(`${param.name}: ${resolvedType}`);
        break;
      case "query":
        hasQuery = true;
        sdkParams.push(`${param.name}: ${resolvedType}`);
        queryParamName = param.name;
        break;
      case "body":
        hasBody = true;
        bodyParamName = param.name;
        sdkParams.push(`${param.name}: ${resolvedType}`);
        break;
      case "headers":
        break;
    }
  }
  sdkParams.push("headers?: Record<string, string>");

  const routeExpr = buildRoutePath(
    meta.basePath,
    method.routePath,
    method.params,
  );

  const opts: string[] = [];
  if (hasBody) opts.push(`body: ${bodyParamName}`);
  if (hasQuery) {
    if (method.params.find((p) => p.kind === "query" && p.routeParamName)) {
      opts.push(`query: { ${queryParamName} }`);
    } else {
      opts.push(`query: ${queryParamName} as any`);
    }
  }
  opts.push("headers");

  return {
    name: method.name,
    paramsStr: sdkParams.join(", "),
    returnTypeStr,
    httpVerb: method.httpVerb,
    routeExpr,
    optsStr: `{ ${opts.join(", ")} }`,
    errorTypeName: methodErrorTypeName(method.name),
  };
}

export function generateSdkFile(
  meta: ControllerMeta,
  generatedDtoNames: Set<string>,
): string {
  const sdkClassName = controllerToSdkClassName(meta.className);
  const resultSdkClassName = controllerToResultSdkClassName(meta.className);
  const lines: string[] = [];

  const resolveType = (typeName: string): string => {
    if (generatedDtoNames.has(typeName)) return typeName;
    const arrayMatch = typeName.match(/^(\w+)\[\]$/);
    if (arrayMatch && generatedDtoNames.has(arrayMatch[1])) return typeName;
    if (["number", "string", "boolean", "any"].includes(typeName))
      return typeName;
    return "any";
  };

  const dtoImports = new Set<string>();
  for (const method of meta.methods) {
    for (const param of method.params) {
      if (param.kind !== "headers") {
        const resolved = resolveType(param.typeName);
        if (resolved !== "any" && generatedDtoNames.has(resolved)) {
          dtoImports.add(resolved);
        }
        const arrayMatch = param.typeName.match(/^(\w+)\[\]$/);
        if (arrayMatch && generatedDtoNames.has(arrayMatch[1])) {
          dtoImports.add(arrayMatch[1]);
        }
      }
    }
    if (method.returnType && generatedDtoNames.has(method.returnType)) {
      dtoImports.add(method.returnType);
    }
  }

  // Collect error type alias imports
  const errorTypeImports = new Set<string>();
  for (const method of meta.methods) {
    errorTypeImports.add(methodErrorTypeName(method.name));
  }

  lines.push(`import { Injectable } from '@nestjs/common';`);
  lines.push(`import { ResultAsync } from 'neverthrow';`);
  lines.push(`import { ConfigAdapterSdkBase } from './sdk-base.service';`);
  if (dtoImports.size > 0) {
    lines.push(
      `import { ${[...dtoImports].sort().join(", ")} } from '../dtos';`,
    );
  }
  if (errorTypeImports.size > 0) {
    lines.push(
      `import type { ${[...errorTypeImports].sort().join(", ")} } from './errors';`,
    );
  }
  lines.push("");

  const signatures = meta.methods.map((m) =>
    buildMethodSignature(m, meta, resolveType),
  );

  // ── Promise class
  lines.push(`@Injectable()`);
  lines.push(`export class ${sdkClassName} extends ConfigAdapterSdkBase {`);
  for (const sig of signatures) {
    lines.push("");
    lines.push(
      `  async ${sig.name}(${sig.paramsStr}): Promise<${sig.returnTypeStr}> {`,
    );
    lines.push(
      `    return this.request<${sig.returnTypeStr}>('${sig.httpVerb}', ${sig.routeExpr}, ${sig.optsStr})`,
    );
    lines.push(`      .match(`);
    lines.push(`        (v) => v,`);
    lines.push(`        (e) => { throw e; },`);
    lines.push(`      );`);
    lines.push(`  }`);
  }
  lines.push("}");
  lines.push("");

  // ── ResultAsync class
  lines.push(`@Injectable()`);
  lines.push(
    `export class ${resultSdkClassName} extends ConfigAdapterSdkBase {`,
  );
  for (const sig of signatures) {
    lines.push("");
    lines.push(
      `  ${sig.name}(${sig.paramsStr}): ResultAsync<${sig.returnTypeStr}, ${sig.errorTypeName}> {`,
    );
    lines.push(
      `    return this.typedRequest<${sig.returnTypeStr}, ${sig.errorTypeName}>('${sig.httpVerb}', ${sig.routeExpr}, ${sig.optsStr});`,
    );
    lines.push(`  }`);
  }
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}
