import { SourceFile } from "ts-morph";
import { extractMethodErrors } from "./errors";
import { resolveReturnType } from "./return-types";

export const HTTP_VERBS = ["Get", "Post", "Put", "Patch", "Delete"] as const;

export function extractDecoratorStringArg(dec: {
  getArguments(): import("ts-morph").Node[];
}): string | null {
  const args = dec.getArguments();
  if (args.length === 0) return null;
  const text = args[0].getText();
  const match = text.match(/^['"](.*)['"]$/);
  return match ? match[1] : null;
}

export function analyzeController(
  sf: SourceFile,
  allDtoClassNames: Set<string>,
): ControllerMeta | null {
  const classes = sf.getClasses();
  const controllerClass = classes.find((c) =>
    c.getDecorators().some((d) => d.getName() === "Controller"),
  );
  if (!controllerClass) return null;

  const controllerDec = controllerClass
    .getDecorators()
    .find((d) => d.getName() === "Controller")!;
  const basePath = extractDecoratorStringArg(controllerDec) ?? "";
  const className = controllerClass.getName() || "Unknown";

  const methods: MethodMeta[] = [];

  for (const method of controllerClass.getMethods()) {
    const decorators = method.getDecorators();

    const httpDec = decorators.find((d) =>
      HTTP_VERBS.includes(d.getName() as any),
    );
    if (!httpDec) continue;

    const hasUploadedFile = method
      .getParameters()
      .some((p) =>
        p.getDecorators().some((d) => d.getName() === "UploadedFile"),
      );
    if (hasUploadedFile) continue;

    const httpVerb = httpDec.getName().toUpperCase() as MethodMeta["httpVerb"];
    const routePath = extractDecoratorStringArg(httpDec) ?? "";

    const errorCodes = extractMethodErrors(method);

    const params: ParamMeta[] = [];
    for (const param of method.getParameters()) {
      const paramDecorators = param.getDecorators();
      const paramName = param.getName();
      const typeNode = param.getTypeNode();
      const typeName = typeNode?.getText() ?? "any";

      const paramDec = paramDecorators.find((d) => d.getName() === "Param");
      const queryDec = paramDecorators.find((d) => d.getName() === "Query");
      const bodyDec = paramDecorators.find((d) => d.getName() === "Body");
      const headersDec = paramDecorators.find((d) => d.getName() === "Headers");

      if (paramDec) {
        const routeParamName = extractDecoratorStringArg(paramDec);
        const isPrimitive = ["number", "string", "boolean"].includes(typeName);
        params.push({
          kind: "param",
          name: paramName,
          typeName,
          routeParamName:
            routeParamName ?? (isPrimitive ? paramName : undefined),
        });
      } else if (queryDec) {
        const queryParamName = extractDecoratorStringArg(queryDec);
        params.push({
          kind: "query",
          name: paramName,
          typeName,
          routeParamName: queryParamName ?? undefined,
        });
      } else if (bodyDec) {
        params.push({
          kind: "body",
          name: paramName,
          typeName,
        });
      } else if (headersDec) {
        params.push({
          kind: "headers",
          name: paramName,
          typeName,
        });
      }
    }

    const { typeName: returnType, isArray } = resolveReturnType(
      method,
      allDtoClassNames,
    );

    methods.push({
      name: method.getName(),
      httpVerb,
      routePath,
      params,
      returnType: returnType,
      isArrayResponse: isArray,
      errorCodes,
    });
  }

  if (methods.length === 0) return null;

  return { className, basePath, methods };
}

export interface ControllerMeta {
  className: string;
  basePath: string;
  methods: MethodMeta[];
}

export interface MethodMeta {
  name: string;
  httpVerb: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  routePath: string;
  params: ParamMeta[];
  returnType: string | null;
  isArrayResponse: boolean;
  errorCodes: string[];
}

export interface ParamMeta {
  kind: "param" | "query" | "body" | "headers";
  name: string;
  typeName: string;
  routeParamName?: string;
}
