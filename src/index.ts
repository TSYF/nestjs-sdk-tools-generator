import { Project } from "ts-morph";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import {
  CLIENT_LIB_DIR,
  CLIENT_LIB_SRC,
  configureRoot,
  ROOT,
  SRC_DIR,
} from "./config";
import { discoverControllerFiles, discoverDtoFiles } from "./discovery";
import {
  clearDir,
  controllerToSdkClassName,
  controllerToSdkFileName,
  deriveModuleKey,
  ensureDir,
  toKebab,
} from "./utils";
import { extractEnums } from "./extraction";
import { ExtractedEnum, ExtractedFunction } from "./extraction/enums";
import {
  collectUnresolvableNames,
  generateInterface,
} from "./generation/interfaces";
import {
  buildClassLocationMap,
  generateDtoClassFile,
} from "./generation/dto-classes";
import {
  analyzeController,
  ControllerMeta,
} from "./extraction/controller-meta";
import {
  synthesizeEntityDtos,
  synthesizeEntityMap,
} from "./generation/entity-synth";
import { generateSdkBase } from "./generation/sdk-base";
import { generateErrorsFile } from "./generation/errors-file";
import { generateSdkFile } from "./generation/sdk-file";
import { generateSdkModule } from "./generation/sdk-module";
import { generateSdkBarrel } from "./generation/sdk-barrel";

function main(projectRoot?: string, clientLibName?: string) {
  configureRoot(projectRoot, clientLibName);
  console.log("🔍 Discovering DTO files...");

  const project = new Project({
    tsConfigFilePath: path.join(ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: false,
  });

  const dtoFilePaths = discoverDtoFiles(project);
  console.log(`   Found ${dtoFilePaths.length} DTO files`);

  if (dtoFilePaths.length === 0) {
    console.log("   No DTO files found. Nothing to generate.");
    return;
  }

  clearDir(CLIENT_LIB_SRC);
  const enumsDir = path.join(CLIENT_LIB_SRC, "enums");
  const interfacesDir = path.join(CLIENT_LIB_SRC, "interfaces");
  const dtosDir = path.join(CLIENT_LIB_SRC, "dtos");
  ensureDir(enumsDir);
  ensureDir(interfacesDir);
  ensureDir(dtosDir);

  const allEnums = new Map<string, ExtractedEnum>();
  const allFunctions = new Map<string, ExtractedFunction>();
  const visited = new Set<string>();

  console.log("\n📦 Extracting enums...");
  for (const filePath of dtoFilePaths) {
    const sf = project.getSourceFile(filePath);
    if (!sf) continue;
    const { enums, functions } = extractEnums(sf, visited);
    for (const e of enums) {
      if (!allEnums.has(e.name)) {
        allEnums.set(e.name, e);
        console.log(`   ✓ ${e.name}`);
      }
    }
    for (const f of functions) {
      if (!allFunctions.has(f.name)) {
        allFunctions.set(f.name, f);
        console.log(`   ✓ ${f.name}()`);
      }
    }
  }

  const knownEnums = new Set(allEnums.keys());
  const enumFunctionNames = new Set(allFunctions.keys());

  const enumExports: string[] = [];
  for (const [name, enumDef] of allEnums) {
    const fileName = toKebab(name) + ".enum.ts";
    const relatedFuncs = [...allFunctions.values()].filter((f) =>
      f.enumDeps.includes(name),
    );

    let content = enumDef.text + "\n";
    for (const func of relatedFuncs) {
      content += "\n" + func.text + "\n";
    }

    fs.writeFileSync(path.join(enumsDir, fileName), content);
    const exports = [name, ...relatedFuncs.map((f) => f.name)];
    enumExports.push(
      `export { ${exports.join(", ")} } from './${fileName.replace(".ts", "")}';`,
    );
  }

  fs.writeFileSync(
    path.join(enumsDir, "index.ts"),
    enumExports.join("\n") + "\n",
  );

  console.log("\n📝 Generating interfaces...");
  const interfaceExports: string[] = [];

  for (const filePath of dtoFilePaths) {
    const sf = project.getSourceFile(filePath);
    if (!sf) continue;

    const relPath = path.relative(SRC_DIR, filePath);
    const moduleKey = deriveModuleKey(relPath);
    const classes = sf.getClasses();
    if (classes.length === 0) continue;

    const localClassNames = new Set<string>();
    for (const cls of classes) {
      const name = cls.getName();
      if (name) localClassNames.add(name);
    }

    const unresolvableNames = collectUnresolvableNames(
      sf,
      knownEnums,
      localClassNames,
    );

    const interfaces: {
      name: string;
      text: string;
      enumImports: string[];
    }[] = [];

    for (const classDecl of classes) {
      if (!classDecl.isExported()) continue;

      const heritage = classDecl.getExtends();
      if (heritage) {
        const heritageText = heritage.getText();
        if (
          /PartialType|OmitType|PickType|IntersectionType/.test(heritageText)
        ) {
          continue;
        }
        if (classDecl.getProperties().length === 0) continue;
      }

      const iface = generateInterface(
        classDecl,
        knownEnums,
        localClassNames,
        unresolvableNames,
      );
      if (iface) interfaces.push(iface);
    }

    if (interfaces.length === 0) continue;

    // Collect local type aliases referenced by the interfaces
    // Include both exported and non-exported aliases so all type references compile.
    const localTypeAliases: string[] = [];
    const interfaceTexts = interfaces.map((i) => i.text).join("\n");
    for (const typeAlias of sf.getTypeAliases()) {
      const aliasName = typeAlias.getName();
      if (new RegExp(`\\b${aliasName}\\b`).test(interfaceTexts)) {
        localTypeAliases.push(typeAlias.getText());
      }
    }

    const allEnumImports = [
      ...new Set(interfaces.flatMap((i) => i.enumImports)),
    ];

    const fileName = moduleKey + ".interfaces.ts";
    let content = "";
    if (allEnumImports.length > 0) {
      content += `import { ${allEnumImports.join(", ")} } from '../enums';\n\n`;
    }
    if (localTypeAliases.length > 0) {
      content += localTypeAliases.join("\n") + "\n\n";
    }
    content += interfaces.map((i) => i.text).join("\n\n") + "\n";

    fs.writeFileSync(path.join(interfacesDir, fileName), content);
    const exportNames = interfaces.map((i) => i.name).join(", ");
    interfaceExports.push(
      `export { ${exportNames} } from './${fileName.replace(".ts", "")}';`,
    );
    console.log(`   ✓ ${fileName} (${interfaces.length} interface(s))`);
  }

  fs.writeFileSync(
    path.join(interfacesDir, "index.ts"),
    interfaceExports.join("\n") + "\n",
  );

  console.log("\n🔗 Generating DTO classes...");

  const classLocationMap = buildClassLocationMap(dtoFilePaths, project);
  const allDtoClassNames = new Set(classLocationMap.keys());
  const generatedDtoNames = new Set<string>();
  const dtoExports: string[] = [];

  for (const filePath of dtoFilePaths) {
    const sf = project.getSourceFile(filePath);
    if (!sf) continue;

    const relPath = path.relative(SRC_DIR, filePath);
    const moduleKey = deriveModuleKey(relPath);
    const content = generateDtoClassFile(
      sf,
      knownEnums,
      enumFunctionNames,
      classLocationMap,
      moduleKey,
      allDtoClassNames,
    );

    if (!content) continue;

    const classes = sf.getClasses().filter((c) => c.isExported());
    for (const cls of classes) {
      const name = cls.getName();
      if (!name) continue;
      if (content.includes(`class ${name}`)) {
        generatedDtoNames.add(name);
      }
    }

    const fileName = moduleKey + ".dtos.ts";
    fs.writeFileSync(path.join(dtosDir, fileName), content);
    dtoExports.push(`export * from './${fileName.replace(".ts", "")}';`);
    console.log(`   ✓ ${fileName}`);
  }

  fs.writeFileSync(
    path.join(dtosDir, "index.ts"),
    dtoExports.join("\n") + "\n",
  );

  console.log(
    `   Generated ${generatedDtoNames.size} DTO classes (${allDtoClassNames.size} total in source)`,
  );

  console.log("\n🔧 Generating SDK from controllers...");

  const controllerFilePaths = discoverControllerFiles(project);
  console.log(`   Found ${controllerFilePaths.length} controller files`);

  const controllerMetas: ControllerMeta[] = [];

  for (const filePath of controllerFilePaths) {
    const sf = project.getSourceFile(filePath);
    if (!sf) continue;

    const meta = analyzeController(sf, generatedDtoNames);
    if (meta) {
      controllerMetas.push(meta);
      const methodCount = meta.methods.length;
      console.log(
        `   ✓ ${meta.className} → ${controllerToSdkClassName(meta.className)} (${methodCount} method(s))`,
      );
    }
  }

  if (synthesizeEntityMap.size > 0) {
    console.log(
      `   Synthesizing ${synthesizeEntityMap.size} DTO(s) from entities...`,
    );
    synthesizeEntityDtos(project, dtosDir, generatedDtoNames);
  }

  if (controllerMetas.length > 0) {
    const sdkDir = path.join(CLIENT_LIB_SRC, "sdk");
    ensureDir(sdkDir);

    fs.writeFileSync(
      path.join(sdkDir, "sdk-base.service.ts"),
      generateSdkBase(),
    );
    console.log("   ✓ sdk-base.service.ts");

    fs.writeFileSync(
      path.join(sdkDir, "errors.ts"),
      generateErrorsFile(controllerMetas),
    );
    console.log("   ✓ errors.ts");

    for (const meta of controllerMetas) {
      const fileName = controllerToSdkFileName(meta.className);
      const content = generateSdkFile(meta, generatedDtoNames);
      fs.writeFileSync(path.join(sdkDir, fileName), content);
      console.log(`   ✓ ${fileName}`);
    }

    fs.writeFileSync(
      path.join(sdkDir, "sdk.module.ts"),
      generateSdkModule(controllerMetas),
    );
    console.log("   ✓ sdk.module.ts");

    fs.writeFileSync(
      path.join(sdkDir, "index.ts"),
      generateSdkBarrel(controllerMetas),
    );
    console.log("   ✓ sdk/index.ts");
  }

  const barrelExports = [
    `export * from './enums';`,
    `export * from './interfaces';`,
    `export * from './dtos';`,
  ];
  if (controllerMetas.length > 0) {
    barrelExports.push(`export * from './sdk';`);
  }
  const topBarrel = barrelExports.join("\n") + "\n";
  fs.writeFileSync(path.join(CLIENT_LIB_SRC, "index.ts"), topBarrel);

  console.log("\n🔨 Compiling client-lib...");
  try {
    execSync("npx tsc -p tsconfig.json", {
      cwd: CLIENT_LIB_DIR,
      stdio: "inherit",
    });
    console.log("\n✅ Client library built successfully!");
    console.log(
      `   Output: ${path.relative(ROOT, path.join(CLIENT_LIB_DIR, "dist"))}/`,
    );
  } catch (err) {
    console.error("\n❌ Compilation failed. Check errors above.");
    process.exit(1);
  }
}

export { main };

if (require.main === module) {
  main();
}
