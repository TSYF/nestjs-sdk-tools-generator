import { Project } from "ts-morph";
import { getPropertyTypeText, pascalCase, toKebab } from "../utils";
import * as path from "path";
import * as fs from "fs";

// Map of synthesized DTO name -> { entityName, filePath }
export const synthesizeEntityMap = new Map<
  string,
  { entityName: string; filePath: string }
>();

export function synthesizeEntityDtos(
  project: Project,
  dtosDir: string,
  generatedDtoNames: Set<string>,
): void {
  for (const [synthName, info] of synthesizeEntityMap) {
    if (generatedDtoNames.has(synthName)) continue;
    const sf = project.getSourceFile(info.filePath);
    if (!sf) continue;
    const classDecl =
      sf.getClass(info.entityName) ||
      sf.getClass((c) => c.getName() === info.entityName);
    if (!classDecl) continue;

    const lines: string[] = [];
    for (const prop of classDecl.getProperties()) {
      const name = prop.getName();
      const isOptional =
        prop.hasQuestionToken() ||
        prop.getDecorators().some((d) => d.getName() === "IsOptional");

      let propType = getPropertyTypeText(prop);

      try {
        const propSym = prop.getType().getSymbol && prop.getType().getSymbol();
        if (propSym) {
          const decls = propSym.getDeclarations();
          for (const d of decls) {
            const kind = (d as any).getKindName && (d as any).getKindName();
            if (kind === "ClassDeclaration") {
              const src =
                (d as any).getSourceFile && (d as any).getSourceFile();
              const fp = src && src.getFilePath && src.getFilePath();
              const otherName = (d as any).getName && (d as any).getName();
              if (fp && (fp.includes("/entities/") || fp.includes("/entity"))) {
                const childSynth = pascalCase(otherName) + "Dto";
                synthesizeEntityMap.set(childSynth, {
                  entityName: otherName,
                  filePath: fp,
                });
                propType = propType.replace(
                  new RegExp("\\b" + otherName + "\\b", "g"),
                  childSynth,
                );
              }
            }
          }
        }
      } catch {}

      const optionalMark = isOptional ? "?" : "";
      lines.push(`  ${name}${optionalMark}: ${propType};`);
    }

    const content = `export interface ${synthName} {\n${lines.join("\n")}\n}\n`;
    const fileName = toKebab(synthName) + ".dtos.ts";
    fs.writeFileSync(path.join(dtosDir, fileName), content);
    const indexPath = path.join(dtosDir, "index.ts");
    try {
      fs.appendFileSync(
        indexPath,
        `export * from './${fileName.replace(".ts", "")}';\n`,
      );
    } catch {}

    generatedDtoNames.add(synthName);
    console.log(`   ✓ Synthesized ${synthName} from entity ${info.entityName}`);
  }
}
