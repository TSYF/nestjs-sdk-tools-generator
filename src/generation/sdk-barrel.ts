import { ControllerMeta } from "../extraction/controller-meta";
import {
  controllerToResultSdkClassName,
  controllerToSdkClassName,
  controllerToSdkFileName,
} from "../utils";

export function generateSdkBarrel(controllers: ControllerMeta[]): string {
  const lines: string[] = [];
  lines.push(`export { ConfigAdapterSdkModule } from './sdk.module';`);
  lines.push(
    `export { ConfigAdapterSdkBase, ConfigAdapterSdkOptions, ConfigAdapterSdkAsyncOptions } from './sdk-base.service';`,
  );
  lines.push(`export type { AppHttpResult } from '@nestjs-sdk-tools/core';`);
  lines.push(`export * from './errors';`);
  for (const ctrl of controllers) {
    const sdkClassName = controllerToSdkClassName(ctrl.className);
    const resultSdkClassName = controllerToResultSdkClassName(ctrl.className);
    const sdkFileName = controllerToSdkFileName(ctrl.className).replace(
      ".ts",
      "",
    );
    lines.push(
      `export { ${sdkClassName}, ${resultSdkClassName} } from './${sdkFileName}';`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
