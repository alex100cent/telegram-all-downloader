export interface BuildInfo {
  version: string;
  id: string;
  commit?: string;
  modified: boolean;
  ciRun?: string;
}

declare const __TAD_BUILD__: BuildInfo;

export const BUILD: BuildInfo = __TAD_BUILD__;
