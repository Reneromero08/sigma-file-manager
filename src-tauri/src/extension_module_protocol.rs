// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::http::{header, Request, Response, StatusCode};

use crate::extensions::paths::{get_extension_dir, get_extensions_base_dir};
use crate::extensions::security::validate_binary_path_component;
use crate::extensions::types::EXTENSION_MANIFEST_FILE;

const MAX_EXTENSION_MODULE_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
struct ExtensionModuleRequest {
    extension_id: String,
    extension_version: String,
    module_path: PathBuf,
}

#[derive(Debug)]
struct ProtocolError {
    status: StatusCode,
    message: &'static str,
}

impl ProtocolError {
    fn new(status: StatusCode, message: &'static str) -> Self {
        Self { status, message }
    }
}

fn decode_safe_component(value: &str, label: &'static str) -> Result<String, ProtocolError> {
    let decoded = urlencoding::decode(value)
        .map_err(|_| ProtocolError::new(StatusCode::BAD_REQUEST, "Invalid module URL"))?
        .into_owned();

    if decoded.contains(['/', '\\', '\0']) || decoded == "." || decoded == ".." {
        return Err(ProtocolError::new(
            StatusCode::FORBIDDEN,
            "Module path rejected",
        ));
    }

    validate_binary_path_component(&decoded, label)
        .map_err(|_| ProtocolError::new(StatusCode::FORBIDDEN, "Module path rejected"))?;
    Ok(decoded)
}

fn parse_extension_module_request(path: &str) -> Result<ExtensionModuleRequest, ProtocolError> {
    let encoded_segments = path
        .strip_prefix('/')
        .unwrap_or(path)
        .split('/')
        .collect::<Vec<_>>();

    if encoded_segments.len() < 3 {
        return Err(ProtocolError::new(
            StatusCode::BAD_REQUEST,
            "Invalid extension module URL",
        ));
    }

    let extension_id = decode_safe_component(encoded_segments[0], "extension id")?;
    let extension_version = decode_safe_component(encoded_segments[1], "extension version")?;
    let mut module_path = PathBuf::new();

    for segment in &encoded_segments[2..] {
        module_path.push(decode_safe_component(segment, "module path component")?);
    }

    let is_javascript_module = module_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("js") || extension.eq_ignore_ascii_case("mjs")
        });

    if !is_javascript_module {
        return Err(ProtocolError::new(
            StatusCode::FORBIDDEN,
            "Only JavaScript modules are available",
        ));
    }

    Ok(ExtensionModuleRequest {
        extension_id,
        extension_version,
        module_path,
    })
}

fn validate_manifest_identity(
    extension_root: &Path,
    extension_id: &str,
    extension_version: &str,
) -> Result<(), ProtocolError> {
    let manifest_bytes = fs::read(extension_root.join(EXTENSION_MANIFEST_FILE))
        .map_err(|_| ProtocolError::new(StatusCode::NOT_FOUND, "Extension is unavailable"))?;
    let manifest: serde_json::Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| ProtocolError::new(StatusCode::NOT_FOUND, "Extension is unavailable"))?;

    let manifest_id = manifest.get("id").and_then(serde_json::Value::as_str);
    let manifest_version = manifest.get("version").and_then(serde_json::Value::as_str);

    if manifest_id != Some(extension_id) || manifest_version != Some(extension_version) {
        return Err(ProtocolError::new(
            StatusCode::NOT_FOUND,
            "Extension version is unavailable",
        ));
    }

    Ok(())
}

fn read_extension_module(
    extensions_base: &Path,
    extension_root: &Path,
    request: &ExtensionModuleRequest,
) -> Result<Vec<u8>, ProtocolError> {
    let canonical_base = extensions_base
        .canonicalize()
        .map_err(|_| ProtocolError::new(StatusCode::NOT_FOUND, "Extension is unavailable"))?;
    let canonical_root = extension_root
        .canonicalize()
        .map_err(|_| ProtocolError::new(StatusCode::NOT_FOUND, "Extension is unavailable"))?;

    if !canonical_root.starts_with(&canonical_base) {
        return Err(ProtocolError::new(
            StatusCode::FORBIDDEN,
            "Extension root rejected",
        ));
    }

    validate_manifest_identity(
        &canonical_root,
        &request.extension_id,
        &request.extension_version,
    )?;

    let mut candidate = canonical_root.clone();
    for component in request.module_path.components() {
        candidate.push(component);
        let metadata = fs::symlink_metadata(&candidate)
            .map_err(|_| ProtocolError::new(StatusCode::NOT_FOUND, "Module not found"))?;

        if metadata.file_type().is_symlink() {
            return Err(ProtocolError::new(
                StatusCode::FORBIDDEN,
                "Symbolic links are not available",
            ));
        }
    }

    let canonical_candidate = candidate
        .canonicalize()
        .map_err(|_| ProtocolError::new(StatusCode::NOT_FOUND, "Module not found"))?;

    if !canonical_candidate.starts_with(&canonical_root) || !canonical_candidate.is_file() {
        return Err(ProtocolError::new(
            StatusCode::FORBIDDEN,
            "Module path rejected",
        ));
    }

    let metadata = canonical_candidate
        .metadata()
        .map_err(|_| ProtocolError::new(StatusCode::NOT_FOUND, "Module not found"))?;

    if metadata.len() > MAX_EXTENSION_MODULE_BYTES {
        return Err(ProtocolError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Module is too large",
        ));
    }

    fs::read(canonical_candidate)
        .map_err(|_| ProtocolError::new(StatusCode::NOT_FOUND, "Module not found"))
}

fn response(status: StatusCode, content_type: &'static str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .header("X-Content-Type-Options", "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .expect("extension module response should be valid")
}

fn error_response(error: ProtocolError) -> Response<Vec<u8>> {
    response(
        error.status,
        "text/plain; charset=utf-8",
        error.message.as_bytes().to_vec(),
    )
}

pub fn handle_request(
    context: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    if context.webview_label() != "main" {
        return error_response(ProtocolError::new(
            StatusCode::FORBIDDEN,
            "Extension modules are unavailable in this webview",
        ));
    }

    if request.method() != tauri::http::Method::GET {
        return error_response(ProtocolError::new(
            StatusCode::METHOD_NOT_ALLOWED,
            "Method not allowed",
        ));
    }

    let parsed_request = match parse_extension_module_request(request.uri().path()) {
        Ok(parsed_request) => parsed_request,
        Err(error) => return error_response(error),
    };
    let extensions_base = match get_extensions_base_dir(context.app_handle()) {
        Ok(path) => path,
        Err(_) => {
            return error_response(ProtocolError::new(
                StatusCode::NOT_FOUND,
                "Extension is unavailable",
            ));
        }
    };
    let extension_root = match get_extension_dir(context.app_handle(), &parsed_request.extension_id)
    {
        Ok(path) => path,
        Err(_) => {
            return error_response(ProtocolError::new(
                StatusCode::FORBIDDEN,
                "Extension root rejected",
            ));
        }
    };

    match read_extension_module(&extensions_base, &extension_root, &parsed_request) {
        Ok(bytes) => response(
            StatusCode::OK,
            "application/javascript; charset=utf-8",
            bytes,
        ),
        Err(error) => error_response(error),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        parse_extension_module_request, read_extension_module, ExtensionModuleRequest,
        ProtocolError,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use tauri::http::StatusCode;

    fn write_extension(root: &Path) {
        fs::create_dir_all(root.join("ui/nested")).expect("create UI directories");
        fs::create_dir_all(root.join("src")).expect("create provider directory");
        fs::write(
            root.join("package.json"),
            br#"{"id":"example.extension","version":"0.8.0"}"#,
        )
        .expect("write manifest");
        fs::write(
            root.join("ui/workspace.js"),
            b"import './audio-player.js'; import './audio-ui.js'; import './image-preview.js'; import './nested/provider.js';",
        )
        .expect("write entry module");
        fs::write(
            root.join("ui/audio-player.js"),
            b"export const audio = true;",
        )
        .expect("write sibling module");
        fs::write(
            root.join("ui/audio-ui.js"),
            b"export const waveform = true;",
        )
        .expect("write waveform module");
        fs::write(
            root.join("ui/image-preview.js"),
            b"export const thumbnail = true;",
        )
        .expect("write thumbnail module");
        fs::write(
            root.join("ui/nested/provider.js"),
            b"export const provider = true;",
        )
        .expect("write nested module");
        fs::write(
            root.join("src/workspace-provider.js"),
            b"export const workspaceProvider = true;",
        )
        .expect("write workspace provider module");
    }

    fn request(path: &str) -> ExtensionModuleRequest {
        ExtensionModuleRequest {
            extension_id: "example.extension".to_string(),
            extension_version: "0.8.0".to_string(),
            module_path: PathBuf::from(path),
        }
    }

    fn assert_status(result: Result<Vec<u8>, ProtocolError>, expected: StatusCode) {
        assert_eq!(result.expect_err("request should fail").status, expected);
    }

    #[test]
    fn parses_nested_module_paths() {
        assert_eq!(
            parse_extension_module_request(
                "/example.extension/0.8.0/ui/nested/workspace%20provider.js"
            )
            .expect("request should parse"),
            ExtensionModuleRequest {
                extension_id: "example.extension".to_string(),
                extension_version: "0.8.0".to_string(),
                module_path: PathBuf::from("ui/nested/workspace provider.js"),
            },
        );
    }

    #[test]
    fn rejects_traversal_and_encoded_separators() {
        for path in [
            "/example.extension/0.8.0/ui/%2e%2e/outside.js",
            "/example.extension/0.8.0/ui%2foutside.js",
            "/example.extension/0.8.0/ui%5coutside.js",
        ] {
            assert_eq!(
                parse_extension_module_request(path)
                    .expect_err("unsafe request should fail")
                    .status,
                StatusCode::FORBIDDEN,
            );
        }
    }

    #[test]
    fn serves_entry_sibling_and_nested_modules() {
        let base = tempfile::tempdir().expect("temp extensions base");
        let root = base.path().join("example.extension");
        write_extension(&root);

        for path in [
            "ui/workspace.js",
            "ui/audio-player.js",
            "ui/audio-ui.js",
            "ui/image-preview.js",
            "ui/nested/provider.js",
            "src/workspace-provider.js",
        ] {
            assert!(!read_extension_module(base.path(), &root, &request(path))
                .expect("module should load")
                .is_empty());
        }
    }

    #[test]
    fn returns_bounded_not_found_for_missing_modules() {
        let base = tempfile::tempdir().expect("temp extensions base");
        let root = base.path().join("example.extension");
        write_extension(&root);

        assert_status(
            read_extension_module(base.path(), &root, &request("ui/missing.js")),
            StatusCode::NOT_FOUND,
        );
    }

    #[test]
    fn requires_exact_manifest_identity() {
        let base = tempfile::tempdir().expect("temp extensions base");
        let root = base.path().join("example.extension");
        write_extension(&root);
        let mut mismatched = request("ui/workspace.js");
        mismatched.extension_version = "0.8.1".to_string();

        assert_status(
            read_extension_module(base.path(), &root, &mismatched),
            StatusCode::NOT_FOUND,
        );
    }

    #[test]
    fn refuses_non_javascript_files() {
        assert_eq!(
            parse_extension_module_request("/example.extension/0.8.0/package.json")
                .expect_err("manifest must not be exposed")
                .status,
            StatusCode::FORBIDDEN,
        );
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symbolic_links() {
        use std::os::unix::fs::symlink;

        let base = tempfile::tempdir().expect("temp extensions base");
        let root = base.path().join("example.extension");
        write_extension(&root);
        symlink(
            root.join("ui/audio-player.js"),
            root.join("ui/linked-player.js"),
        )
        .expect("create symlink");

        assert_status(
            read_extension_module(base.path(), &root, &request("ui/linked-player.js")),
            StatusCode::FORBIDDEN,
        );
    }

    #[test]
    fn refuses_extension_roots_outside_the_managed_directory() {
        let base = tempfile::tempdir().expect("temp extensions base");
        let outside = tempfile::tempdir().expect("outside extension");
        write_extension(outside.path());

        assert_status(
            read_extension_module(base.path(), outside.path(), &request("ui/workspace.js")),
            StatusCode::FORBIDDEN,
        );
    }
}
