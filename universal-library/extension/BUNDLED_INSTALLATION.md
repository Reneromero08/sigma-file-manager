# Bundled Universal Library installation

The custom Sigma build packages the Universal Library runtime as a Tauri resource at:

```text
bundled-extensions/reneromero08.universal-library
```

Only runtime files are bundled: the extension manifest, source modules, embedded workspace, and locales. Tests, release custody files, and development documentation remain in the repository but are not copied into the application resource bundle.

On main-window startup, Sigma completes its normal extension initialization first. The bundled synchronizer then uses Sigma's existing local-extension installation and refresh paths. This preserves manifest validation, engine and platform checks, managed-binary consent, rollback, activation, disabled state, and dependency custody.

Bundled ownership is stored separately from the installed extension record. This allows the synchronizer to distinguish a fork-managed copy from a manually installed development copy with the same extension ID.

Lifecycle rules:

- a missing extension is offered once for installation;
- cancelling dependency consent does not claim ownership;
- a matching bundled version remains unchanged, including across AppImage mount paths;
- a newer bundled version refreshes through Sigma's existing local refresh path;
- a manually installed same-ID extension is never overwritten;
- a user-disabled bundled extension stays disabled after refresh;
- an intentionally uninstalled bundled extension stays uninstalled;
- a failed refresh restores the previous source path and extension snapshot.

The managed `ulib` archive remains independently versioned and SHA-256 verified before extraction. No source-file write permission is introduced by bundling the extension.

This boundary is the installable-alpha contract: future creative adapters may update the bundled extension and managed catalog independently without relocating indexed files or resetting the catalog.
