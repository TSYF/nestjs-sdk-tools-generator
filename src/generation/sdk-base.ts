export function generateSdkBase(): string {
  return `import { HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ResultAsync } from 'neverthrow';
import { lastValueFrom } from 'rxjs';
import { parseServiceErrorGeneric, SDK_ERROR_MAPPER_TOKEN } from '@nestjs-sdk-tools/core';
import type { ServiceError, SdkErrorMapper } from '@nestjs-sdk-tools/core';

export interface ConfigAdapterSdkOptions {
  baseUrl: string;
  /** Override the error mapper for this SDK instance. Takes precedence over a globally provided mapper. */
  errorMapper?: SdkErrorMapper;
}

export interface ConfigAdapterSdkAsyncOptions {
  useFactory: (...args: any[]) => ConfigAdapterSdkOptions | Promise<ConfigAdapterSdkOptions>;
  inject?: any[];
  imports?: any[];
  /**
   * Override the error mapper for this SDK instance.
   * Declared here (not inside useFactory) so the module can register it as a
   * DI token, taking precedence over any globally provided mapper.
   */
  errorMapper?: SdkErrorMapper;
}

@Injectable()
export class ConfigAdapterSdkBase {
  private readonly _errorMapper: SdkErrorMapper;

  constructor(
    protected readonly httpService: HttpService,
    @Inject('CONFIG_ADAPTER_SDK_OPTIONS')
    protected readonly options: ConfigAdapterSdkOptions,
    @Optional() @Inject(SDK_ERROR_MAPPER_TOKEN)
    errorMapper?: SdkErrorMapper,
  ) {
    this._errorMapper = errorMapper ?? parseServiceErrorGeneric;
  }

  protected request<T>(
    method: string,
    path: string,
    opts?: {
      body?: any;
      query?: Record<string, any>;
      headers?: Record<string, string>;
    },
  ): ResultAsync<T, HttpException> {
    const url = \`\${this.options.baseUrl}/\${path}\`;
    return ResultAsync.fromPromise(
      lastValueFrom(
        this.httpService.request<T>({
          method,
          url,
          data: opts?.body,
          params: opts?.query,
          headers: {
            'Content-Type': 'application/json',
            ...opts?.headers,
          },
        }),
      ).then((r) => r.data),
      (e: any) =>
        e instanceof HttpException
          ? e
          : new HttpException(
              e?.response?.data ?? 'Unknown error',
              e?.response?.status ?? 500,
            ),
    );
  }

  protected typedRequest<T, E extends ServiceError = ServiceError>(
    method: string,
    path: string,
    opts?: {
      body?: any;
      query?: Record<string, any>;
      headers?: Record<string, string>;
    },
  ): ResultAsync<T, E> {
    return this.request<T>(method, path, opts).mapErr(
      (e) => this._errorMapper(e) as E,
    );
  }
}
`;
}
