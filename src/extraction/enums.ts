import { SourceFile } from "ts-morph";

export interface ExtractedEnum {
  name: string;
  text: string;
}

export interface ExtractedFunction {
  name: string;
  text: string;
  enumDeps: string[];
}

export function extractEnums(
  sf: SourceFile,
  visited: Set<string>,
): { enums: ExtractedEnum[]; functions: ExtractedFunction[] } {
  const enums: ExtractedEnum[] = [];
  const functions: ExtractedFunction[] = [];
  const filePath = sf.getFilePath();

  if (visited.has(filePath)) return { enums, functions };
  visited.add(filePath);

  for (const enumDecl of sf.getEnums()) {
    if (enumDecl.isExported()) {
      enums.push({ name: enumDecl.getName(), text: enumDecl.getText() });
    }
  }

  for (const funcDecl of sf.getFunctions()) {
    if (funcDecl.isExported()) {
      const funcText = funcDecl.getText();
      const enumDeps = enums
        .filter((e) => funcText.includes(e.name))
        .map((e) => e.name);
      if (enumDeps.length > 0) {
        functions.push({
          name: funcDecl.getName() || "anonymous",
          text: funcText,
          enumDeps,
        });
      }
    }
  }

  for (const importDecl of sf.getImportDeclarations()) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();
    if (
      !moduleSpecifier.includes("entities/") &&
      !moduleSpecifier.includes("entity")
    ) {
      continue;
    }
    const resolved = importDecl.getModuleSpecifierSourceFile();
    if (!resolved) continue;

    const importedNames = importDecl
      .getNamedImports()
      .map((ni) => ni.getName());
    for (const enumDecl of resolved.getEnums()) {
      if (importedNames.includes(enumDecl.getName())) {
        enums.push({ name: enumDecl.getName(), text: enumDecl.getText() });
      }
    }
  }

  return { enums, functions };
}
