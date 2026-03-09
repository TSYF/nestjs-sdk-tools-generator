import { Project } from "ts-morph";
import { SRC_DIR } from "../config";

export function discoverControllerFiles(project: Project): string[] {
  const allFiles = project.getSourceFiles();
  const controllerFiles: string[] = [];
  const srcPrefix = SRC_DIR + "/";

  for (const sf of allFiles) {
    const filePath = sf.getFilePath();
    if (
      filePath.startsWith(srcPrefix) &&
      !filePath.includes("/client-lib/") &&
      !filePath.includes("/client-sdk/") &&
      !filePath.includes("/dist/") &&
      !filePath.includes("/node_modules/") &&
      filePath.endsWith(".controller.ts") &&
      !filePath.includes("/health/")
    ) {
      controllerFiles.push(filePath);
    }
  }

  return controllerFiles.sort();
}
