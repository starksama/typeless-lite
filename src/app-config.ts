import appConfig from '../app.config.json';

export const APP_BRAND = {
  displayName: appConfig.displayName,
  legalName: appConfig.legalName,
  storagePrefix: appConfig.storagePrefix,
  iconUrl: new URL('../src-tauri/icons/32x32.png', import.meta.url).href
} as const;
