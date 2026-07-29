// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.

use std::num::NonZeroUsize;
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Path as AxumPath, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use lru::LruCache;
use serde::Serialize;
use tokio::sync::{Mutex, OnceCell};
use uuid::Uuid;

use crate::lan_share::streaming::stream_file_response;

const MEDIA_STREAM_CAPACITY: usize = 512;

type MediaRegistry = Arc<Mutex<LruCache<String, PathBuf>>>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaStreamLease {
    url: String,
    token: String,
}

pub struct MediaStreamState {
    port: OnceCell<u16>,
    registry: MediaRegistry,
}

impl Default for MediaStreamState {
    fn default() -> Self {
        Self {
            port: OnceCell::new(),
            registry: Arc::new(Mutex::new(LruCache::new(
                NonZeroUsize::new(MEDIA_STREAM_CAPACITY).expect("media stream capacity is nonzero"),
            ))),
        }
    }
}

impl MediaStreamState {
    async fn ensure_server(&self) -> Result<u16, String> {
        let registry = self.registry.clone();
        let port = self
            .port
            .get_or_try_init(|| async move {
                let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
                    .await
                    .map_err(|error| format!("Failed to bind local media server: {error}"))?;
                let port = listener
                    .local_addr()
                    .map_err(|error| format!("Failed to read local media server address: {error}"))?
                    .port();
                let router = Router::new()
                    .route("/media/{token}", get(stream_media))
                    .with_state(registry);

                tokio::spawn(async move {
                    if let Err(error) = axum::serve(listener, router).await {
                        log::error!("Local media server stopped: {error}");
                    }
                });

                Ok::<u16, String>(port)
            })
            .await?;

        Ok(*port)
    }

    async fn create_lease(&self, path: String) -> Result<MediaStreamLease, String> {
        let canonical_path = tokio::fs::canonicalize(&path)
            .await
            .map_err(|error| format!("Failed to resolve media path: {error}"))?;
        let metadata = tokio::fs::metadata(&canonical_path)
            .await
            .map_err(|error| format!("Failed to inspect media path: {error}"))?;

        if !metadata.is_file() {
            return Err("Media path must reference a regular file".to_string());
        }

        let port = self.ensure_server().await?;
        let token = Uuid::new_v4().simple().to_string();
        self.registry
            .lock()
            .await
            .put(token.clone(), canonical_path);

        Ok(MediaStreamLease {
            url: format!("http://127.0.0.1:{port}/media/{token}"),
            token,
        })
    }

    async fn release(&self, token: &str) -> bool {
        self.registry.lock().await.pop(token).is_some()
    }
}

fn secure_media_response(mut response: Response) -> Response {
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    response
}

async fn stream_media(
    State(registry): State<MediaRegistry>,
    AxumPath(token): AxumPath<String>,
    headers: HeaderMap,
) -> Response {
    let path = registry.lock().await.get(&token).cloned();

    match path {
        Some(path) if path.is_file() => {
            secure_media_response(stream_file_response(&path, &headers).await)
        }
        _ => secure_media_response((StatusCode::NOT_FOUND, "Media not found").into_response()),
    }
}

#[tauri::command]
pub async fn create_media_stream_url(
    state: tauri::State<'_, MediaStreamState>,
    path: String,
) -> Result<MediaStreamLease, String> {
    state.create_lease(path).await
}

#[tauri::command]
pub async fn release_media_stream(
    state: tauri::State<'_, MediaStreamState>,
    token: String,
) -> Result<bool, String> {
    Ok(state.release(&token).await)
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use axum::http::StatusCode;

    use super::MediaStreamState;

    #[tokio::test]
    async fn streams_only_registered_files_with_byte_ranges() {
        let state = MediaStreamState::default();
        let mut file = tempfile::NamedTempFile::new().expect("temp file");
        file.write_all(b"0123456789").expect("write fixture");

        let lease = state
            .create_lease(file.path().to_string_lossy().into_owned())
            .await
            .expect("create media lease");
        assert!(lease.url.starts_with("http://127.0.0.1:"));
        assert!(!lease.url.contains(file.path().to_string_lossy().as_ref()));

        let response = reqwest::Client::new()
            .get(&lease.url)
            .header("Range", "bytes=2-5")
            .send()
            .await
            .expect("range response");
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()["content-range"], "bytes 2-5/10");
        assert_eq!(
            response.bytes().await.expect("range body"),
            b"2345".as_slice()
        );

        assert!(state.release(&lease.token).await);
        let released = reqwest::get(&lease.url).await.expect("released response");
        assert_eq!(released.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn rejects_directories_and_unknown_tokens() {
        let state = MediaStreamState::default();
        let directory = tempfile::tempdir().expect("temp directory");
        let error = state
            .create_lease(directory.path().to_string_lossy().into_owned())
            .await
            .err()
            .expect("directory should be rejected");
        assert!(error.contains("regular file"));

        let file = tempfile::NamedTempFile::new().expect("temp file");
        let lease = state
            .create_lease(file.path().to_string_lossy().into_owned())
            .await
            .expect("create media lease");
        let port = lease
            .url
            .split(':')
            .nth(2)
            .and_then(|segment| segment.split('/').next())
            .expect("server port");
        let response = reqwest::get(format!(
            "http://127.0.0.1:{port}/media/00000000000000000000000000000000"
        ))
        .await
        .expect("unknown token response");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
