import { MethodDeclaration } from "ts-morph";
import { pascalCase } from "../utils";

const synthesizeEntityMap = new Map<
  string,
  { entityName: string; filePath: string }
>();

export function resolveReturnType(
  method: MethodDeclaration,
  allDtoClassNames: Set<string>,
): { typeName: string | null; isArray: boolean } {
  const decorators = method.getDecorators();
  const apiResponseDec = decorators.find((d) =>
    ["ApiOkResponse", "ApiCreatedResponse"].includes(d.getName()),
  );

  if (apiResponseDec) {
    const args = apiResponseDec.getArguments();
    if (args.length > 0) {
      const argText = args[0].getText();
      const typeMatch = argText.match(/type:\s*(\w+)/);
      const isArray = /isArray:\s*true/.test(argText);
      if (typeMatch) {
        const typeName = typeMatch[1];
        if (allDtoClassNames.has(typeName)) {
          return { typeName, isArray };
        }
      }
    }
  }

  const returnTypeNode = method.getReturnTypeNode();
  if (returnTypeNode) {
    let typeText = returnTypeNode.getText();
    const promiseMatch = typeText.match(/^Promise<(.+)>$/);
    if (promiseMatch) {
      typeText = promiseMatch[1];
    }
    const arrayMatch = typeText.match(/^(\w+)\[\]$/);
    if (arrayMatch) {
      return { typeName: arrayMatch[1], isArray: true };
    }
    if (allDtoClassNames.has(typeText) || typeText === "any") {
      return { typeName: typeText, isArray: false };
    }
  }

  try {
    const inferredType = method.getReturnType();
    let typeText = inferredType.getText(method);
    typeText = typeText.replace(/import\([^\)]+\)\./g, "");
    const promiseMatch = typeText.match(/^Promise<(.+)>$/s);
    if (promiseMatch) {
      typeText = promiseMatch[1].trim();
    }
    const arrayMatch = typeText.match(/^(\w+)\[\]$/);
    if (arrayMatch && allDtoClassNames.has(arrayMatch[1])) {
      return { typeName: arrayMatch[1], isArray: true };
    }
    if (allDtoClassNames.has(typeText)) {
      return { typeName: typeText, isArray: false };
    }
    try {
      const returnTypeSym = inferredType.getSymbol && inferredType.getSymbol();
      if (returnTypeSym) {
        const decls = returnTypeSym.getDeclarations();
        for (const d of decls) {
          try {
            const kind = (d as any).getKindName && (d as any).getKindName();
            if (kind === "ClassDeclaration") {
              const src =
                (d as any).getSourceFile && (d as any).getSourceFile();
              const fp = src && src.getFilePath && src.getFilePath();
              if (fp && (fp.includes("/entities/") || fp.includes("/entity"))) {
                const entityName = (d as any).getName && (d as any).getName();
                if (entityName) {
                  const synthName = pascalCase(method.getName()) + "Dto";
                  synthesizeEntityMap.set(synthName, {
                    entityName,
                    filePath: fp,
                  });
                  return { typeName: synthName, isArray: false };
                }
              }
            }
          } catch {}
        }
      }
    } catch {}
  } catch {}

  return { typeName: null, isArray: false };
}
