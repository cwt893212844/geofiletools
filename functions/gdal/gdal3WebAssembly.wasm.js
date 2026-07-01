/**
 * Serve decompressed GDAL WASM at /gdal/gdal3WebAssembly.wasm
 * (static deploy only ships gdal3WebAssembly.wasm.gz to stay under the 25 MiB Pages limit).
 */
export async function onRequest(context) {
  const gzUrl = new URL('/gdal/gdal3WebAssembly.wasm.gz', context.request.url);
  const gzResponse = await context.env.ASSETS.fetch(new Request(gzUrl, context.request));
  if (!gzResponse.ok) {
    return new Response('GIS engine asset not found', { status: 404 });
  }

  const compressed = await gzResponse.arrayBuffer();
  let wasm;
  try {
    wasm = await new Response(
      new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).arrayBuffer();
  } catch {
    return new Response('Failed to decompress GIS engine', { status: 500 });
  }

  return new Response(wasm, {
    headers: {
      'Content-Type': 'application/wasm',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
