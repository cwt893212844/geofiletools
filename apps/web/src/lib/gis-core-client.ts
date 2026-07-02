export type GisCoreModule = typeof import('@gis-tools/core');

let loadPromise: Promise<GisCoreModule> | null = null;

export function loadGisCore(): Promise<GisCoreModule> {
  if (!loadPromise) {
    loadPromise = import('@gis-tools/core');
  }
  return loadPromise;
}
