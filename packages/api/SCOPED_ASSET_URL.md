# Scoped asset URLs

`fs.scoped.toAssetUrl(path)` converts an already-authorized local path into a Tauri asset URL suitable for streaming media or rendering previews in extension UI.

The method does not add a new permission. It requires the extension manifest's existing `fs.read` permission and verifies persistent scoped-directory access before calling Tauri's `convertFileSrc` helper.

Security order:

1. require `fs.read`;
2. verify `hasScopedAccess(extensionId, path, 'read')`;
3. reject unauthorized paths;
4. convert only the approved path to an asset URL.

The method is exposed consistently to API extensions, extension workers, and sandboxed embedded pages. It does not widen `assetProtocol.scope`, create a local server, copy file bytes through postMessage, or grant access to neighboring files.

Primary intended uses are local audio audition, video playback, image previews, and other streaming reads from folders the user explicitly approved.
