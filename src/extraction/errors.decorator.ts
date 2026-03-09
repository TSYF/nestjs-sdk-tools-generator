import "reflect-metadata";
import { type ErrorIdentifier, normalizeToCode } from "@nestjs-sdk-tools/core";

export const SDK_ERRORS_METADATA_KEY = "sdk:errors";

/**
 * Declares which errors a controller method can emit.
 * Accepts any mix of ErrorIdentifiers:
 * - String codes: 'NOT_FOUND', 'BAD_REQUEST'
 * - Custom tags: 'DATABASE_UNAVAILABLE', 'CART_EXPIRED'
 * - HttpStatus numbers: HttpStatus.NOT_FOUND, HttpStatus.CONFLICT
 * - Exception classes: NotFoundException, ConflictException
 *
 * The SDK generator reads these statically via ts-morph.
 * At runtime, stores normalized codes as metadata for potential reflection use.
 *
 * @example
 * @Errors('NOT_FOUND', 'BAD_REQUEST')
 * @Errors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
 * @Errors(NotFoundException, 'DATABASE_UNAVAILABLE')
 * @Get(':id')
 * findOne(@Param('id') id: string) { ... }
 */
export function Errors(...identifiers: ErrorIdentifier[]): MethodDecorator {
  // Normalize all identifiers to code strings at decoration time
  const codes = identifiers.map(normalizeToCode);

  return (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(SDK_ERRORS_METADATA_KEY, codes, target, propertyKey);
    return descriptor;
  };
}
