import { ControllerMeta } from "../extraction/controller-meta";
import {
  controllerToResultSdkClassName,
  controllerToSdkClassName,
  controllerToSdkFileName,
} from "../utils";

export function generateSdkModule(controllers: ControllerMeta[]): string {
  const sdkClassNames = controllers.map((c) =>
    controllerToSdkClassName(c.className),
  );
  const resultSdkClassNames = controllers.map((c) =>
    controllerToResultSdkClassName(c.className),
  );
  const sdkFileNames = controllers.map((c) =>
    controllerToSdkFileName(c.className).replace(".ts", ""),
  );

  const lines: string[] = [];

  lines.push(`import { DynamicModule, Module } from '@nestjs/common';`);
  lines.push(
    `import { SDK_ERROR_MAPPER_TOKEN } from '@nestjs-sdk-tools/core';`,
  );
  lines.push(`import { HttpModule } from '@nestjs/axios';`);
  lines.push(
    `import { ConfigAdapterSdkBase, ConfigAdapterSdkOptions, ConfigAdapterSdkAsyncOptions } from './sdk-base.service';`,
  );
  for (let i = 0; i < sdkClassNames.length; i++) {
    lines.push(
      `import { ${sdkClassNames[i]}, ${resultSdkClassNames[i]} } from './${sdkFileNames[i]}';`,
    );
  }
  lines.push("");

  lines.push(`const SDK_SERVICES = [`);
  lines.push(`  ConfigAdapterSdkBase,`);
  for (let i = 0; i < sdkClassNames.length; i++) {
    lines.push(`  ${sdkClassNames[i]},`);
    lines.push(`  ${resultSdkClassNames[i]},`);
  }
  lines.push(`];`);
  lines.push("");

  lines.push(`@Module({})`);
  lines.push(`export class ConfigAdapterSdkModule {`);
  lines.push(
    `  static forRoot(options: ConfigAdapterSdkOptions): DynamicModule {`,
  );
  lines.push(`    return {`);
  lines.push(`      module: ConfigAdapterSdkModule,`);
  lines.push(`      imports: [HttpModule],`);
  lines.push(`      providers: [`);
  lines.push(
    `        { provide: 'CONFIG_ADAPTER_SDK_OPTIONS', useValue: options },`,
  );
  lines.push(`        ...(options.errorMapper`);
  lines.push(
    `          ? [{ provide: SDK_ERROR_MAPPER_TOKEN, useValue: options.errorMapper }]`,
  );
  lines.push(`          : []),`);
  lines.push(`        ...SDK_SERVICES,`);
  lines.push(`      ],`);
  lines.push(`      exports: SDK_SERVICES,`);
  lines.push(`    };`);
  lines.push(`  }`);
  lines.push("");
  lines.push(
    `  static forRootAsync(options: ConfigAdapterSdkAsyncOptions): DynamicModule {`,
  );
  lines.push(`    return {`);
  lines.push(`      module: ConfigAdapterSdkModule,`);
  lines.push(`      imports: [HttpModule, ...(options.imports ?? [])],`);
  lines.push(`      providers: [`);
  lines.push(`        {`);
  lines.push(`          provide: 'CONFIG_ADAPTER_SDK_OPTIONS',`);
  lines.push(`          useFactory: options.useFactory,`);
  lines.push(`          inject: options.inject ?? [],`);
  lines.push(`        },`);
  lines.push(`        ...(options.errorMapper`);
  lines.push(
    `          ? [{ provide: SDK_ERROR_MAPPER_TOKEN, useValue: options.errorMapper }]`,
  );
  lines.push(`          : []),`);
  lines.push(`        ...SDK_SERVICES,`);
  lines.push(`      ],`);
  lines.push(`      exports: SDK_SERVICES,`);
  lines.push(`    };`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push("");

  return lines.join("\n");
}
