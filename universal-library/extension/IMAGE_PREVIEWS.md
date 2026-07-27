# Image preview custody

Universal Library 0.8.0 renders browser-native raster images from approved library roots through `sigma.fs.scoped.toAssetUrl(path)`.

Supported preview extensions are JPG, JPEG, PNG, WebP, GIF, BMP, AVIF, and ICO. Unsupported formats retain the normal media glyph until a dedicated preview adapter exists.

The workspace:

- requests previews only for online assets classified as images;
- limits scoped URL resolution to four concurrent requests;
- caches identical asset and path requests so grid and inspector views share one URL;
- evicts failed requests so a later render can retry;
- removes failed image elements and preserves the fallback glyph;
- disposes queued work when the workspace unmounts.

No preview operation writes, moves, converts, or copies the source file.
