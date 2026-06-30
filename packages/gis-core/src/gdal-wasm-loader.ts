import { gunzipSync } from 'fflate';
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function decompressGzip(input: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).arrayBuffer();
    } catch {
      // e.g. format unsupported — fall back to fflate
    }
  }
  return toArrayBuffer(gunzipSync(new Uint8Array(input)));
}

/** Fetch GDAL wasm bytes — prefers gzip sidecar (.wasm.gz) used on Cloudflare Pages. */
export async function fetchGdalWasmBinary(paths: GdalPaths): Promise<ArrayBuffer | null> {
  if (typeof window === 'undefined') return null;

  const wasmUrl = resolveAssetUrl(paths.wasm);
  const gzUrl = wasmUrl.replace(/\.wasm$/i, '.wasm.gz');

  try {
    const gzResponse = await fetch(gzUrl);
    if (gzResponse.ok) {
      const compressed = await gzResponse.arrayBuffer();
      return decompressGzip(compressed);
    }
  } catch {
    // fall through to plain wasm (local dev)
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
