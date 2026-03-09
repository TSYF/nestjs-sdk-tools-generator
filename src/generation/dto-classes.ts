import { ClassDeclaration, Project, SourceFile } from "ts-morph";
import { SRC_DIR } from "../config";
import { deriveModuleKey } from "../utils";
import * as path from "path";

/**
 * Removes decorator lines/blocks from class text that reference any symbol in `symbols`.
 * Handles multi-line decorators (e.g. @Matches(CONST, {\n  message: '...'\n})) via paren tracking.
 */
function stripDecoratorsReferencing(
  text: string,
  symbols: Set<string>,
): string {
  if (symbols.size === 0) return text;

  const lines = text.split("\n");
  const output: string[] = [];
  let parenDepth = 0;
  let skipping = false;

  for (const line of lines) {
    if (skipping) {
      for (const ch of line) {
        if (ch === "(") parenDepth++;
        else if (ch === ")") {
          parenDepth--;
          if (parenDepth <= 0) {
            skipping = false;
            parenDepth = 0;
          }
        }
      }
      continue;
    }

    const trimmed = line.trimStart();
    if (trimmed.startsWith("@")) {
      let shouldSkip = false;
      for (const sym of symbols) {
        if (new RegExp(`\\b${sym}\\b`).test(trimmed)) {
          shouldSkip = true;
          break;
        }
      }
      if (shouldSkip) {
        parenDepth = 0;
        for (const ch of line) {
          if (ch === "(") parenDepth++;
          else if (ch === ")") parenDepth--;
        }
        if (parenDepth > 0) {
          skipping = true;
        }
        continue;
      }
    }

    output.push(line);
  }

  return output.join("\n");
}

export function generateDtoClassFile(
  sf: SourceFile,
  knownEnums: Set<string>,
  enumFunctionNames: Set<string>,
  classLocationMap: Map<string, string>,
  currentModuleKey: string,
  allDtoClassNames: Set<string>,
): string | null {
  const classes = sf.getClasses().filter((c) => c.isExported());
  if (classes.length === 0) return null;

  const copyableClasses: ClassDeclaration[] = [];
  for (const classDecl of classes) {
    if (classDecl.isAbstract()) {
      copyableClasses.push(classDecl);
      continue;
    }

    const heritage = classDecl.getExtends();
    if (heritage) {
      const heritageText = heritage.getText();
      if (/PartialType|OmitType|PickType|IntersectionType/.test(heritageText)) {
        continue;
      }
      if (classDecl.getProperties().length === 0) continue;
    }

    copyableClasses.push(classDecl);
  }

  if (copyableClasses.length === 0) return null;

  const localClassNames = new Set(
    classes.map((c) => c.getName()).filter(Boolean) as string[],
  );

  const entityNames = new Set<string>();
  for (const importDecl of sf.getImportDeclarations()) {
    const moduleSpec = importDecl.getModuleSpecifierValue();
    if (moduleSpec.includes("entities/") || moduleSpec.includes("entity")) {
      for (const ni of importDecl.getNamedImports()) {
        const name = ni.getName();
        if (!knownEnums.has(name)) {
          entityNames.add(name);
        }
      }
    }
  }

  const crossFileImports = new Map<string, Set<string>>();
  for (const importDecl of sf.getImportDeclarations()) {
    const moduleSpec = importDecl.getModuleSpecifierValue();
    if (!moduleSpec.startsWith(".") && !moduleSpec.startsWith("@/")) {
      continue;
    }
    if (moduleSpec.includes("entities/") || moduleSpec.includes("entity")) {
      continue;
    }

    for (const ni of importDecl.getNamedImports()) {
      const name = ni.getName();
      if (knownEnums.has(name) || enumFunctionNames.has(name)) continue;
      const otherModule = classLocationMap.get(name);
      if (otherModule && otherModule !== currentModuleKey) {
        if (!crossFileImports.has(otherModule)) {
          crossFileImports.set(otherModule, new Set());
        }
        crossFileImports.get(otherModule)!.add(name);
      }
    }
  }

  const nonDtoLocalImports = new Set<string>();
  for (const importDecl of sf.getImportDeclarations()) {
    const moduleSpec = importDecl.getModuleSpecifierValue();
    if (
      (moduleSpec.startsWith(".") || moduleSpec.startsWith("@/")) &&
      !moduleSpec.includes("entities/") &&
      !moduleSpec.includes("entity")
    ) {
      for (const ni of importDecl.getNamedImports()) {
        const name = ni.getName();
        if (
          !knownEnums.has(name) &&
          !enumFunctionNames.has(name) &&
          !allDtoClassNames.has(name) &&
          !localClassNames.has(name)
        ) {
          nonDtoLocalImports.add(name);
        }
      }
    }
  }

  const neededEnumImports = new Set<string>();
  const bodyLines: string[] = [];

  for (const classDecl of copyableClasses) {
    const classText = classDecl.getText();
    for (const enumName of knownEnums) {
      if (classText.includes(enumName)) {
        neededEnumImports.add(enumName);
      }
    }
  }

  const npmImports = new Map<string, Set<string>>();
  for (const importDecl of sf.getImportDeclarations()) {
    const moduleSpec = importDecl.getModuleSpecifierValue();
    if (
      moduleSpec.startsWith(".") ||
      moduleSpec.startsWith("@/") ||
      moduleSpec.includes("entities/") ||
      moduleSpec.includes("entity")
    ) {
      continue;
    }
    // Skip self-referential SDK imports — resolve via cross-file imports instead
    if (
      moduleSpec.includes("client-sdk") ||
      moduleSpec.includes("client-lib")
    ) {
      for (const ni of importDecl.getNamedImports()) {
        const name = ni.getName();
        const otherModule = classLocationMap.get(name);
        if (otherModule && otherModule !== currentModuleKey) {
          if (!crossFileImports.has(otherModule)) {
            crossFileImports.set(otherModule, new Set());
          }
          crossFileImports.get(otherModule)!.add(name);
        }
      }
      continue;
    }
    const namedImports = importDecl
      .getNamedImports()
      .map((ni) => ni.getName())
      .filter((n) => !knownEnums.has(n) && !enumFunctionNames.has(n));
    if (namedImports.length > 0) {
      if (!npmImports.has(moduleSpec)) {
        npmImports.set(moduleSpec, new Set());
      }
      for (const n of namedImports) {
        npmImports.get(moduleSpec)!.add(n);
      }
    }
  }

  if (nonDtoLocalImports.size > 0) {
    for (const importDecl of sf.getImportDeclarations()) {
      const resolved = importDecl.getModuleSpecifierSourceFile();
      if (!resolved) continue;
      for (const ni of importDecl.getNamedImports()) {
        if (nonDtoLocalImports.has(ni.getName())) {
          const iface = resolved.getInterface(ni.getName());
          if (iface) {
            const ifaceText = iface.getText();
            for (const [className, modKey] of classLocationMap) {
              if (
                ifaceText.includes(className) &&
                modKey !== currentModuleKey
              ) {
                if (!crossFileImports.has(modKey)) {
                  crossFileImports.set(modKey, new Set());
                }
                crossFileImports.get(modKey)!.add(className);
              }
            }
            bodyLines.push(ifaceText);
            bodyLines.push("");
            nonDtoLocalImports.delete(ni.getName());
          }
          const typeAlias = resolved.getTypeAlias(ni.getName());
          if (typeAlias) {
            // If the source is another DTO file, use cross-file import instead of inlining
            const resolvedPath = resolved.getFilePath();
            const isOtherDtoFile =
              /\.dtos?\.ts$/.test(resolvedPath) &&
              resolvedPath.startsWith(SRC_DIR);
            if (isOtherDtoFile) {
              const otherRelPath = path.relative(SRC_DIR, resolvedPath);
              const otherModKey = deriveModuleKey(otherRelPath);
              if (otherModKey !== currentModuleKey) {
                if (!crossFileImports.has(otherModKey)) {
                  crossFileImports.set(otherModKey, new Set());
                }
                crossFileImports.get(otherModKey)!.add(ni.getName());
                nonDtoLocalImports.delete(ni.getName());
              } else {
                bodyLines.push(typeAlias.getText());
                bodyLines.push("");
                nonDtoLocalImports.delete(ni.getName());
              }
            } else {
              bodyLines.push(typeAlias.getText());
              bodyLines.push("");
              nonDtoLocalImports.delete(ni.getName());
            }
          }
        }
      }
    }
  }

  // Copy exported type aliases defined locally (not imported from elsewhere)
  const importedTypeAliasNames = new Set<string>();
  for (const importDecl of sf.getImportDeclarations()) {
    for (const ni of importDecl.getNamedImports()) {
      importedTypeAliasNames.add(ni.getName());
    }
  }
  for (const typeAlias of sf.getTypeAliases()) {
    if (
      typeAlias.isExported() &&
      !importedTypeAliasNames.has(typeAlias.getName())
    ) {
      bodyLines.push(typeAlias.getText());
      bodyLines.push("");
    }
  }

  // Detect locally-defined non-exported symbols that won't be copied to the output.
  // Type aliases are inlined; classes/consts used as decorator arguments are stripped.
  const localNonExportedTypeAliases = new Map<string, string>();
  for (const ta of sf.getTypeAliases()) {
    if (!ta.isExported() && !importedTypeAliasNames.has(ta.getName())) {
      localNonExportedTypeAliases.set(ta.getName(), ta.getText());
    }
  }

  // Symbols used at value-level in decorators (e.g. @Validate(Cls), @Matches(CONST))
  // that are locally defined but not exported — strip those decorators from class text.
  const unexportedDecoratorSymbols = new Set<string>();
  for (const cls of sf.getClasses()) {
    if (!cls.isExported()) {
      const name = cls.getName();
      if (name) unexportedDecoratorSymbols.add(name);
    }
  }
  for (const varStmt of sf.getVariableStatements()) {
    if (!varStmt.isExported()) {
      for (const decl of varStmt.getDeclarations()) {
        const name = decl.getName();
        if (name) unexportedDecoratorSymbols.add(name);
      }
    }
  }

  // Pre-scan: inline non-exported type aliases referenced by any copyable class
  const allCopyableText = copyableClasses.map((c) => c.getText()).join("\n");
  const addedTypeAliases = new Set<string>();
  for (const [aliasName, aliasText] of localNonExportedTypeAliases) {
    if (new RegExp(`\\b${aliasName}\\b`).test(allCopyableText)) {
      bodyLines.push(aliasText);
      bodyLines.push("");
      addedTypeAliases.add(aliasName);
    }
  }

  for (const classDecl of copyableClasses) {
    let classText = classDecl.getText();

    // Strip decorator lines/blocks that reference unexported local symbols
    // Also strip decorators for unresolvable imported symbols (e.g. imported custom decorators)
    const allDecoratorSymbols = new Set<string>([
      ...unexportedDecoratorSymbols,
      ...nonDtoLocalImports,
    ]);
    if (allDecoratorSymbols.size > 0) {
      classText = stripDecoratorsReferencing(classText, allDecoratorSymbols);
    }

    for (const entityName of entityNames) {
      classText = classText.replace(
        new RegExp(`(type:\\s*)${entityName}\\b`, "g"),
        "$1Object",
      );
      classText = classText.replace(
        new RegExp(`Type\\(\\(\\)\\s*=>\\s*${entityName}\\)`, "g"),
        "Type(() => Object)",
      );
      classText = classText.replace(
        new RegExp(`(:\\s*)${entityName}\\b`, "g"),
        "$1any",
      );
    }

    for (const name of nonDtoLocalImports) {
      classText = classText.replace(
        new RegExp(`(:\\s*)${name}\\b`, "g"),
        "$1any",
      );
      // Also handle union type positions: `Type | Name` and `Name | Type`
      classText = classText.replace(
        new RegExp(`\\|\\s*${name}\\b`, "g"),
        "| any",
      );
      classText = classText.replace(
        new RegExp(`\\b${name}\\s*\\|`, "g"),
        "any |",
      );
    }

    bodyLines.push(classText);
    bodyLines.push("");
  }

  const lines: string[] = [];

  if (neededEnumImports.size > 0) {
    lines.push(
      `import { ${[...neededEnumImports].join(", ")} } from '../enums';`,
    );
  }

  for (const [moduleSpec, names] of npmImports) {
    lines.push(`import { ${[...names].join(", ")} } from '${moduleSpec}';`);
  }

  for (const [otherModule, names] of crossFileImports) {
    lines.push(
      `import { ${[...names].join(", ")} } from './${otherModule}.dtos';`,
    );
  }

  if (lines.length > 0) lines.push("");
  lines.push(...bodyLines);

  return lines.join("\n");
}

export function buildClassLocationMap(
  dtoFilePaths: string[],
  project: Project,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const filePath of dtoFilePaths) {
    const sf = project.getSourceFile(filePath);
    if (!sf) continue;
    const relPath = path.relative(SRC_DIR, filePath);
    const moduleKey = deriveModuleKey(relPath);
    for (const cls of sf.getClasses()) {
      const name = cls.getName();
      if (name && cls.isExported()) {
        map.set(name, moduleKey);
      }
    }
  }
  return map;
}
