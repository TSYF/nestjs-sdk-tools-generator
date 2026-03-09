import {
  ERROR_CODE_STATUS_MAP,
  EXCEPTION_CLASS_CODE_MAP,
} from "@nestjs-sdk-tools/core";
import { MethodDeclaration } from "ts-morph";

/**
 * Reverse map from HttpStatus numeric values to their member name.
 * e.g. 404 → 'NOT_FOUND', 409 → 'CONFLICT'
 */
const HTTP_STATUS_VALUE_TO_CODE: Record<number, string> = (() => {
  const map: Record<number, string> = {};
  for (const [code, status] of Object.entries(ERROR_CODE_STATUS_MAP)) {
    map[status as number] = code;
  }
  return map;
})();

/**
 * Extracts error codes from the @Errors(...) decorator on a controller method.
 *
 * Handles all ErrorIdentifier forms:
 * - String literals: @Errors('NOT_FOUND', 'DATABASE_UNAVAILABLE')
 * - HttpStatus property access: @Errors(HttpStatus.NOT_FOUND)
 * - Exception class identifiers: @Errors(NotFoundException)
 *
 * Falls back to ['INTERNAL_SERVER_ERROR'] if no @Errors decorator is present.
 */
export function extractMethodErrors(method: MethodDeclaration): string[] {
  const errorsDec = method
    .getDecorators()
    .find((d) => d.getName() === "Errors");
  if (!errorsDec) return ["INTERNAL_SERVER_ERROR"];

  const codes: string[] = [];
  for (const arg of errorsDec.getArguments()) {
    const text = arg.getText();

    // 1. String literal: 'NOT_FOUND' or 'DATABASE_UNAVAILABLE'
    const stringMatch = text.match(/^['"](.+)['"]$/);
    if (stringMatch) {
      codes.push(stringMatch[1]);
      continue;
    }

    // 2. HttpStatus property access: HttpStatus.NOT_FOUND
    const httpStatusMatch = text.match(/^HttpStatus\.(.+)$/);
    if (httpStatusMatch) {
      // The property name IS the error code (HttpStatus enum uses same naming)
      const statusName = httpStatusMatch[1];
      if (statusName in ERROR_CODE_STATUS_MAP) {
        codes.push(statusName);
      } else {
        // Try to resolve numeric value
        console.warn(`   ⚠ Unknown HttpStatus.${statusName}, using as-is`);
        codes.push(statusName);
      }
      continue;
    }

    // 3. Exception class identifier: NotFoundException, ConflictException, etc.
    const exceptionCode = (EXCEPTION_CLASS_CODE_MAP as Record<string, string>)[
      text
    ];
    if (exceptionCode) {
      codes.push(exceptionCode);
      continue;
    }

    // 4. Numeric literal (unlikely but handle it)
    const numericMatch = text.match(/^(\d+)$/);
    if (numericMatch) {
      const statusNum = parseInt(numericMatch[1], 10);
      const mappedCode = HTTP_STATUS_VALUE_TO_CODE[statusNum];
      if (mappedCode) {
        codes.push(mappedCode);
      } else {
        console.warn(`   ⚠ Unknown numeric status ${statusNum}, skipping`);
      }
      continue;
    }

    // 5. Unknown — warn and skip
    console.warn(`   ⚠ Could not resolve @Errors argument: ${text}`);
  }

  return codes.length > 0 ? codes : ["INTERNAL_SERVER_ERROR"];
}
