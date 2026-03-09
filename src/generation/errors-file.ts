import { ERROR_CODE_INTERFACE_MAP } from "@nestjs-sdk-tools/core";
import { ControllerMeta } from "../extraction/controller-meta";
import { customTagToInterfaceName } from "../utils";

/**
 * Generate the errors.ts file with per-method error type aliases and
 * re-exports of the relevant error interfaces from @nestjs-sdk-tools/core.
 *
 * For known ErrorCode strings, re-exports existing interfaces (e.g. NotFoundError).
 * For custom tags (e.g. 'DATABASE_UNAVAILABLE'), auto-generates interfaces:
 *   export interface DatabaseUnavailableError extends ServiceError {
 *     code: 'DATABASE_UNAVAILABLE';
 *   }
 */
export function generateErrorsFile(controllerMetas: ControllerMeta[]): string {
  // Collect all unique error codes across all methods
  const allCodes = new Set<string>();
  for (const meta of controllerMetas) {
    for (const method of meta.methods) {
      for (const code of method.errorCodes) {
        allCodes.add(code);
      }
    }
  }

  // Separate known codes (re-export from @nestjs-sdk-tools/core) from custom tags (generate)
  const knownInterfaces = new Set<string>();
  const customTags = new Set<string>();
  // Build a map: code → interface name (for both known and custom)
  const codeToInterface = new Map<string, string>();

  for (const code of allCodes) {
    const ifaceName = (ERROR_CODE_INTERFACE_MAP as Record<string, string>)[
      code
    ];
    if (ifaceName) {
      knownInterfaces.add(ifaceName);
      codeToInterface.set(code, ifaceName);
    } else {
      customTags.add(code);
      const customIfaceName = customTagToInterfaceName(code);
      codeToInterface.set(code, customIfaceName);
    }
  }

  const lines: string[] = [];

  // Import all needed types locally so they're available in type aliases below
  const localImports = new Set<string>(["ServiceError"]);
  for (const iface of knownInterfaces) {
    localImports.add(iface);
  }
  lines.push(
    `import type { ${[...localImports].sort().join(", ")} } from '@nestjs-sdk-tools/core';`,
  );
  lines.push("");

  // Re-export the known error interfaces consumers will need
  if (knownInterfaces.size > 0) {
    lines.push(
      `export type { ${[...knownInterfaces].sort().join(", ")} } from '@nestjs-sdk-tools/core';`,
    );
    lines.push("");
  }

  // Re-export common types consumers will need
  lines.push(`export type { ServiceError } from '@nestjs-sdk-tools/core';`);
  lines.push(
    `export { matchError, assertNever } from '@nestjs-sdk-tools/core';`,
  );
  lines.push("");

  // Generate interfaces for custom tags
  if (customTags.size > 0) {
    lines.push(
      `// ─── Custom error interfaces (auto-generated from @Errors tags) ──────────`,
    );
    lines.push("");
    for (const tag of [...customTags].sort()) {
      const ifaceName = codeToInterface.get(tag)!;
      lines.push(`export interface ${ifaceName} extends ServiceError {`);
      lines.push(`  code: '${tag}';`);
      lines.push(`}`);
      lines.push("");
    }
  }

  // Emit per-method error type aliases
  const emittedAliases = new Set<string>();

  for (const meta of controllerMetas) {
    for (const method of meta.methods) {
      const aliasName = methodErrorTypeName(method.name);
      if (emittedAliases.has(aliasName)) continue;
      emittedAliases.add(aliasName);

      const unionMembers = method.errorCodes
        .map((code) => codeToInterface.get(code))
        .filter(Boolean) as string[];

      if (unionMembers.length === 0) {
        lines.push(`export type ${aliasName} = ServiceError;`);
      } else {
        lines.push(`export type ${aliasName} = ${unionMembers.join(" | ")};`);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Build the error type alias name for a method.
 * e.g. findOne → FindOneErrors
 */
export function methodErrorTypeName(methodName: string): string {
  return methodName.charAt(0).toUpperCase() + methodName.slice(1) + "Errors";
}
