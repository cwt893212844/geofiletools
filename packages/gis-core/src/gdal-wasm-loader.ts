import type { GdalPaths } from './types';

function resolveAssetUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  if (typeof window !== 'undefined') {
    return new URL(path, window.location.origin).toString();
  }
  return path;
}

function isWasmMagic(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer, 0, 4);
  return bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d;
}

async function decompressBrotli(input: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress the GIS engine (Brotli unsupported).');
  }
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('br'));
  return new Response(stream).arrayBuffer();
}

/** Fetch GDAL wasm bytes — prefers brotli sidecar (.wasm.br) used on Cloudflare Pages. */
export async function fetchGdalWasmBinary(paths: GdalPaths): Promise<ArrayBuffer | null> {
  if (typeof window === 'undefined') return null;

  const wasmUrl = resolveAssetUrl(paths.wasm);
  const brUrl = wasmUrl.replace(/\.wasm$/i, '.wasm.br');

  try {
    const brResponse = await fetch(brUrl);
    if (brResponse.ok) {
      const compressed = await brResponse.arrayBuffer();
      return decompressBrotli(compressed);
    }
  } catch {
    // fall through to plain wasm
  }

  try {
    const response = await fetch(wasmUrl);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    return isWasmMagic(buffer) ? buffer : null;
  } catch {
    return null;
  }
}
