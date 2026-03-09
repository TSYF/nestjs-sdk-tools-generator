import { ClassDeclaration, SourceFile } from "ts-morph";
import { getPropertyTypeText } from "../utils";

export function collectUnresolvableNames(
  sf: SourceFile,
  knownEnums: Set<string>,
  localClassNames: Set<string>,
): Set<string> {
  const unresolvable = new Set<string>();

  for (const importDecl of sf.getImportDeclarations()) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();

    if (
      moduleSpecifier.includes("entities/") ||
      moduleSpecifier.includes("entity")
    ) {
      for (const ni of importDecl.getNamedImports()) {
        const name = ni.getName();
        if (!knownEnums.has(name)) {
          unresolvable.add(name);
        }
      }
      continue;
    }

    if (moduleSpecifier.startsWith(".") || moduleSpecifier.startsWith("@/")) {
      for (const ni of importDecl.getNamedImports()) {
        const name = ni.getName();
        if (!knownEnums.has(name) && !localClassNames.has(name)) {
          unresolvable.add(name);
        }
      }
    }

    // Treat self-referential SDK imports as unresolvable
    if (
      moduleSpecifier.includes("client-sdk") ||
      moduleSpecifier.includes("client-lib")
    ) {
      for (const ni of importDecl.getNamedImports()) {
        const name = ni.getName();
        if (!knownEnums.has(name) && !localClassNames.has(name)) {
          unresolvable.add(name);
        }
      }
    }
  }

  return unresolvable;
}

export function rewriteTypeForInterface(
  typeText: string,
  localClassNames: Set<string>,
  knownEnums: Set<string>,
  unresolvableNames: Set<string>,
): string {
  let result = typeText;

  for (const className of localClassNames) {
    if (!knownEnums.has(className)) {
      result = result.replace(
        new RegExp(`\\b${className}\\b`, "g"),
        `I${className}`,
      );
    }
  }

  for (const name of unresolvableNames) {
    result = result.replace(new RegExp(`\\b${name}\\b`, "g"), "any");
  }

  return result;
}

export function generateInterface(
  classDecl: ClassDeclaration,
  knownEnums: Set<string>,
  localClassNames: Set<string>,
  unresolvableNames: Set<string>,
): { name: string; text: string; enumImports: string[] } | null {
  const className = classDecl.getName() || "Unknown";
  const interfaceName = `I${className}`;
  const enumImports: string[] = [];

  const typeParams = classDecl.getTypeParameters();
  const genericSuffix =
    typeParams.length > 0
      ? `<${typeParams.map((tp) => tp.getText()).join(", ")}>`
      : "";

  const properties = classDecl.getProperties();
  if (properties.length === 0 && !classDecl.isAbstract()) return null;

  const lines: string[] = [];

  for (const prop of properties) {
    const name = prop.getName();
    const isOptional =
      prop.hasQuestionToken() ||
      prop.getDecorators().some((d) => d.getName() === "IsOptional");

    let propType = getPropertyTypeText(prop);
    propType = rewriteTypeForInterface(
      propType,
      localClassNames,
      knownEnums,
      unresolvableNames,
    );

    for (const enumName of knownEnums) {
      if (propType.includes(enumName) && !enumImports.includes(enumName)) {
        enumImports.push(enumName);
      }
    }

    const optionalMark = isOptional ? "?" : "";
    lines.push(`  ${name}${optionalMark}: ${propType};`);
  }

  const text = `export interface ${interfaceName}${genericSuffix} {\n${lines.join("\n")}\n}`;
  return { name: interfaceName, text, enumImports };
}
