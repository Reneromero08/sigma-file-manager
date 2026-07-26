use std::{io, path::PathBuf, process::ExitCode};

use anyhow::Result;
use clap::{Parser, Subcommand};
use serde::Serialize;
use serde_json::json;
use universal_library_catalog::{AssetQuery, Catalog, ScanOptions, default_database_path};

#[derive(Debug, Parser)]
#[command(name = "ulib", version, about = "Universal Library local catalog CLI")]
struct Cli {
    /// Override the catalog path. ULIB_DATABASE is used when this option is absent.
    #[arg(long, global = true)]
    database: Option<PathBuf>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Create or migrate the catalog and return its health record.
    Init,
    /// Return catalog status and counts.
    Health,
    /// Manage non-destructive library roots.
    Root {
        #[command(subcommand)]
        command: RootCommand,
    },
    /// Search and inspect indexed assets.
    Asset {
        #[command(subcommand)]
        command: AssetCommand,
    },
    /// Manage reusable asset tags.
    Tag {
        #[command(subcommand)]
        command: TagCommand,
    },
    /// Manage virtual mixed-media collections.
    Collection {
        #[command(subcommand)]
        command: CollectionCommand,
    },
    /// Manage arbitrary namespaced asset metadata.
    Metadata {
        #[command(subcommand)]
        command: MetadataCommand,
    },
    /// Create a consistent SQLite backup without touching source files.
    Backup {
        #[arg(long)]
        output: PathBuf,
    },
}

#[derive(Debug, Subcommand)]
enum RootCommand {
    /// Register an existing directory as a library root.
    Add {
        path: PathBuf,
        #[arg(long)]
        name: Option<String>,
    },
    /// List configured roots.
    List,
    /// Recursively index a registered root without modifying source files.
    Scan {
        /// Root ID or registered root path.
        reference: String,
        /// Include dot-prefixed entries.
        #[arg(long)]
        include_hidden: bool,
        /// Include default cache, dependency, VCS, and build directories.
        #[arg(long)]
        include_ignored: bool,
    },
}

#[derive(Debug, Subcommand)]
enum AssetCommand {
    /// Search indexed assets by name, path, media kind, and online state.
    List {
        #[arg(long)]
        query: Option<String>,
        #[arg(long)]
        kind: Option<String>,
        #[arg(long)]
        include_offline: bool,
        #[arg(long, default_value_t = 200)]
        limit: u32,
    },
    /// List tags assigned to an asset ID or indexed path.
    Tags { reference: String },
}

#[derive(Debug, Subcommand)]
enum TagCommand {
    /// Create a tag or update its color.
    Create {
        name: String,
        #[arg(long)]
        color: Option<String>,
    },
    /// List all tags.
    List,
    /// Assign a tag by ID or name to an asset ID or indexed path.
    Add { asset: String, tag: String },
    /// Remove a tag from an asset.
    Remove { asset: String, tag: String },
}

#[derive(Debug, Subcommand)]
enum CollectionCommand {
    /// Create a virtual collection. No files are moved or copied.
    Create {
        name: String,
        #[arg(long, default_value = "manual")]
        kind: String,
    },
    /// List collections.
    List,
    /// Add or reposition an asset in a collection.
    Add {
        collection: String,
        asset: String,
        #[arg(long)]
        position: Option<f64>,
        #[arg(long)]
        section: Option<String>,
        #[arg(long)]
        note: Option<String>,
    },
    /// Remove an asset from a collection without touching the source file.
    Remove { collection: String, asset: String },
    /// List collection items in playlist order.
    Items { collection: String },
}

#[derive(Debug, Subcommand)]
enum MetadataCommand {
    /// Set a JSON metadata value on an asset.
    Set {
        asset: String,
        namespace: String,
        key: String,
        value: String,
        #[arg(long, default_value = "cli")]
        source: String,
    },
    /// List all metadata for an asset.
    List { asset: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupRecord {
    output_path: String,
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            let payload = json!({
                "ok": false,
                "error": {
                    "message": format!("{error:#}"),
                },
            });
            eprintln!("{payload}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<()> {
    let cli = Cli::parse();
    let database = cli.database.unwrap_or(default_database_path()?);
    let mut catalog = Catalog::open(database)?;

    match cli.command {
        Command::Init | Command::Health => print_success(catalog.health()?),
        Command::Root { command } => match command {
            RootCommand::Add { path, name } => {
                print_success(catalog.add_root(path, name.as_deref())?)
            }
            RootCommand::List => print_success(catalog.list_roots()?),
            RootCommand::Scan {
                reference,
                include_hidden,
                include_ignored,
            } => print_success(catalog.scan_root(
                &reference,
                ScanOptions {
                    include_hidden,
                    include_ignored,
                },
            )?),
        },
        Command::Asset { command } => match command {
            AssetCommand::List {
                query,
                kind,
                include_offline,
                limit,
            } => print_success(catalog.query_assets(AssetQuery {
                text: query,
                media_kind: kind,
                include_offline,
                limit,
            })?),
            AssetCommand::Tags { reference } => {
                print_success(catalog.list_asset_tags(&reference)?)
            }
        },
        Command::Tag { command } => match command {
            TagCommand::Create { name, color } => {
                print_success(catalog.create_tag(&name, color.as_deref())?)
            }
            TagCommand::List => print_success(catalog.list_tags()?),
            TagCommand::Add { asset, tag } => {
                print_success(catalog.assign_tag(&asset, &tag)?)
            }
            TagCommand::Remove { asset, tag } => {
                print_success(catalog.remove_tag_from_asset(&asset, &tag)?)
            }
        },
        Command::Collection { command } => match command {
            CollectionCommand::Create { name, kind } => {
                print_success(catalog.create_collection(&name, &kind)?)
            }
            CollectionCommand::List => print_success(catalog.list_collections()?),
            CollectionCommand::Add {
                collection,
                asset,
                position,
                section,
                note,
            } => print_success(catalog.add_collection_item(
                &collection,
                &asset,
                position,
                section.as_deref(),
                note.as_deref(),
            )?),
            CollectionCommand::Remove { collection, asset } => {
                print_success(catalog.remove_collection_item(&collection, &asset)?)
            }
            CollectionCommand::Items { collection } => {
                print_success(catalog.list_collection_items(&collection)?)
            }
        },
        Command::Metadata { command } => match command {
            MetadataCommand::Set {
                asset,
                namespace,
                key,
                value,
                source,
            } => print_success(catalog.set_asset_metadata(
                &asset,
                &namespace,
                &key,
                &value,
                &source,
            )?),
            MetadataCommand::List { asset } => {
                print_success(catalog.list_asset_metadata(&asset)?)
            }
        },
        Command::Backup { output } => {
            let output = catalog.backup(output)?;
            print_success(BackupRecord {
                output_path: output.to_string_lossy().into_owned(),
            })
        }
    }
}

fn print_success<T: Serialize>(data: T) -> Result<()> {
    let payload = json!({
        "ok": true,
        "data": data,
    });
    serde_json::to_writer_pretty(io::stdout().lock(), &payload)?;
    println!();
    Ok(())
}
