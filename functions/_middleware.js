/**
 * Decompress GDAL WASM on the edge — static deploy only ships .wasm.gz (Pages 25 MiB limit).
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.pathname !== '/gdal/gdal3WebAssembly.wasm') {
    return context.next();
  }

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
