import * as fs from "fs";
import { PropertyDeclaration } from "ts-morph";

export function deriveModuleKey(relPath: string): string {
  const parts = relPath.replace(/\.(dto|dtos)\.ts$/, "").split("/");
  const filtered = parts.filter((p) => p !== "dtos");
  if (filtered.length === 0) return "global";
  if (parts[0] === "dtos") {
    return "global--" + filtered.join("--");
  }
  return filtered.join("--");
}

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function clearDir(dir: string) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  ensureDir(dir);
}

export function toKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

export function pascalCase(input: string): string {
  return input
    .replace(/(^|_|-|\s)+(.)/g, (_m, _p1, p2) => p2.toUpperCase())
    .replace(/[^A-Za-z0-9]/g, "");
}

export function getPropertyTypeText(prop: PropertyDeclaration): string {
  const typeNode = prop.getTypeNode();
  if (typeNode) return typeNode.getText();
  const type = prop.getType();
  return type.getText(prop).replace(/import\([^\)]+\)\./g, "");
}

/**
 * Convert a SCREAMING_SNAKE_CASE custom tag to a PascalCase interface name.
 * e.g. 'DATABASE_UNAVAILABLE' → 'DatabaseUnavailableError'
 */
export function customTagToInterfaceName(tag: string): string {
  const pascal = tag
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  return pascal + "Error";
}

export function controllerToSdkClassName(className: string): string {
  return className.replace(/Controller$/, "Sdk");
}

export function controllerToResultSdkClassName(className: string): string {
  return className.replace(/Controller$/, "ResultSdk");
}

export function controllerToSdkFileName(className: string): string {
  return toKebab(className.replace(/Controller$/, "")) + ".sdk.ts";
}
