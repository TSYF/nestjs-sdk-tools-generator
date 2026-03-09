# @nestjs-sdk-tools/generator

CLI that reads a NestJS service's source code via ts-morph and generates a fully-typed `client-sdk/` — including DTO classes, TypeScript interfaces, enums, typed SDK service classes, and a plug-and-play NestJS module. No hand-written HTTP plumbing.

## Install

```bash
npm install --save-dev @nestjs-sdk-tools/generator
```

> This is a dev/build-time tool. Install it as a `devDependency` in the service that **exposes** the SDK (the adapter), not in the consuming BFF.

## Usage

Add a script to your NestJS service's `package.json`:

```json
{
  "scripts": {
    "build:client-sdk": "generate-nestjs-sdk"
  }
}
```

Then run:

```bash
npm run build:client-sdk
```

The generator resolves paths relative to `process.cwd()` (the project root), reads `src/` for controllers and DTOs, and writes output to `client-sdk/`.

### Custom paths

```bash
generate-nestjs-sdk [projectRoot] [clientDirName]
```

| Argument        | Default         | Description                                       |
| --------------- | --------------- | ------------------------------------------------- |
| `projectRoot`   | `process.cwd()` | Absolute path to the NestJS service root          |
| `clientDirName` | `client-sdk`    | Output directory name (relative to `projectRoot`) |

Example — output to `client-lib/` instead:

```bash
generate-nestjs-sdk . client-lib
```

---

## What gets generated

Given a service with this structure:

```
src/
  users/
    controllers/users.controller.ts   ← @Get, @Post, @Delete decorated methods
    dtos/users.dto.ts                  ← class-validator DTOs with @Errors() decorators
```

The generator produces:

```
client-sdk/
  src/
    enums/                    # extracted TypeScript enums + helper functions
    interfaces/               # I-prefixed interfaces for every DTO class
    dtos/                     # DTO classes (decorators stripped, local types inlined)
    sdk-base.service.ts       # base HTTP client (request/typedRequest via Axios)
    {module}.sdk.ts           # convenience SDK (returns unwrapped data or throws)
    errors.ts                 # ServiceError union for each controller's @Errors
    sdk.module.ts             # NestJS DynamicModule (forRoot / forRootAsync)
    sdk/index.ts              # barrel re-export of everything
  dist/                       # compiled output (tsc)
  tsconfig.json
  package.json
```

### SDK classes per controller

For each controller, two classes are generated:

| Class            | Return type                 | When to use                                    |
| ---------------- | --------------------------- | ---------------------------------------------- |
| `UsersSdk`       | plain `T` (throws on error) | Simple cases — use with `@MapResult` decorator |
| `UsersResultSdk` | `ResultAsync<T, E>`         | Full control — explicit error handling         |

---

## Consuming the generated SDK

### 1. Register the module in the consuming BFF

```ts
// app.module.ts
import { ConfigAdapterSdkModule } from "config-adapter/client-sdk";

@Module({
  imports: [
    ConfigAdapterSdkModule.forRoot({
      baseUrl: process.env.CONFIG_ADAPTER_URL,
    }),
  ],
})
export class AppModule {}
```

Async configuration (e.g. pulling `baseUrl` from `ConfigService`):

```ts
ConfigAdapterSdkModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    baseUrl: config.get("CONFIG_ADAPTER_URL"),
  }),
});
```

### 2. Inject and call SDK methods

**Simple style** — use `UsersSdk` + `@MapResult`:

```ts
import { MapResult } from "@nestjs-sdk-tools/core";
import { UsersSdk } from "config-adapter/client-sdk";

@Controller("users")
export class UsersController {
  constructor(private readonly sdk: UsersSdk) {}

  @Get(":id")
  @MapResult()
  find(@Param() p: FindUserDto, @Headers() h: HeaderDto) {
    return this.sdk.find(p, h); // returns T, throws on error
  }
}
```

**ResultAsync style** — use `UsersResultSdk` for exhaustive error handling:

```ts
import { UsersResultSdk } from 'config-adapter/client-sdk';

@Get(':id')
async find(@Param() p: FindUserDto, @Headers() h: HeaderDto) {
  return this.sdk.find(p, h).match(
    (user) => user,
    {
      NOT_FOUND:   (e) => { throw new NotFoundException(e.message); },
      UNAUTHORIZED:(e) => { throw new UnauthorizedException(e.message); },
    },
  );
}
```

---

## Error mapping

The generated SDK base service uses `parseServiceErrorGeneric` by default to convert `HttpException` into `ServiceError`. You can override this at two levels:

### Per-SDK (in `forRoot` / `forRootAsync`)

```ts
ConfigAdapterSdkModule.forRoot({
  baseUrl: process.env.CONFIG_ADAPTER_URL,
  errorMapper: (error) => ({
    ...parseServiceErrorGeneric(error),
    provider: "config-adapter",
  }),
});
```

### Application-wide via DI token

Register a global provider for `SDK_ERROR_MAPPER_TOKEN` in your root `AppModule`. All SDKs that don't provide their own mapper will fall back to it.

```ts
import {
  SDK_ERROR_MAPPER_TOKEN,
  parseServiceErrorGeneric,
} from "@nestjs-sdk-tools/core";

@Module({
  providers: [
    {
      provide: SDK_ERROR_MAPPER_TOKEN,
      useValue: (error) => ({
        ...parseServiceErrorGeneric(error),
        provider: "my-app",
      }),
      global: true,
    },
  ],
})
export class AppModule {}
```

Priority: per-SDK `errorMapper` → global `SDK_ERROR_MAPPER_TOKEN` → `parseServiceErrorGeneric`.

---

## `@Errors` decorator — typed error codes per endpoint

Annotate controller methods with `@Errors(...)` so the generator can produce a precisely-typed `ResultAsync` error union for each SDK method.

```ts
import { Errors } from "@nestjs-sdk-tools/core"; // or from wherever you re-export it

@Controller("users")
export class UsersController {
  @Get(":id")
  @Errors("NOT_FOUND", "UNAUTHORIZED")
  find(@Param() p: FindUserDto) {
    /* ... */
  }

  @Post()
  @Errors("CONFLICT", "UNPROCESSABLE_ENTITY")
  create(@Body() dto: CreateUserDto) {
    /* ... */
  }
}
```

The generated `UsersResultSdk.find()` will return `ResultAsync<User, NotFoundError | UnauthorizedError>`.

Without `@Errors`, the error type falls back to `ServiceError` (untyped).

---

## DTO handling

The generator copies DTO class bodies into `client-sdk/src/dtos/`. It handles several edge cases automatically:

| Source pattern                                                          | What the generator does                        |
| ----------------------------------------------------------------------- | ---------------------------------------------- |
| Locally defined non-exported `type` (e.g. `type JsonValue = ...`)       | Inlines the type alias into the generated file |
| Locally defined non-exported validator `class` used in `@Validate(Cls)` | Strips the `@Validate` decorator               |
| Locally defined non-exported `const` used in `@Matches(CONST)`          | Strips the `@Matches` decorator                |
| Imported custom decorator (e.g. `@IsUUIDOrNumericString()`)             | Strips the decorator                           |
| Entity imports (`entities/`)                                            | Replaces type with `Object` / `any`            |
| `PartialType` / `OmitType` / `PickType` subclasses                      | Skipped (only concrete classes are emitted)    |
| Cross-DTO references (same service)                                     | Resolved via cross-file imports                |

---

## Source conventions the generator relies on

- **DTO files** must be named `*.dto.ts` or `*.dtos.ts` and live under `src/`
- **Controller files** must be named `*.controller.ts`
- **NestJS HTTP decorators** (`@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`) mark methods for SDK generation
- **Path prefix** is read from `@Controller('prefix')` on the class
- **Route params / query / body** are read from method parameter decorators

---

## Version compatibility

| Generator | Core  | ts-morph | NestJS     |
| --------- | ----- | -------- | ---------- |
| 0.0.3     | 1.0.0 | ^24.0.0  | ^10 or ^11 |
