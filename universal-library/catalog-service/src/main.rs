use std::{io, path::PathBuf, process::ExitCode};

use anyhow::Result;
use clap::{Parser, Subcommand};
use serde::Serialize;
use serde_json::json;
use universal_library_catalog::{Catalog, default_database_path};

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
    /// Manage virtual mixed-media collections.
    Collection {
        #[command(subcommand)]
        command: CollectionCommand,
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
    let catalog = Catalog::open(database)?;

    match cli.command {
        Command::Init | Command::Health => print_success(catalog.health()?),
        Command::Root { command } => match command {
            RootCommand::Add { path, name } => {
                print_success(catalog.add_root(path, name.as_deref())?)
            }
            RootCommand::List => print_success(catalog.list_roots()?),
        },
        Command::Collection { command } => match command {
            CollectionCommand::Create { name, kind } => {
                print_success(catalog.create_collection(&name, &kind)?)
            }
            CollectionCommand::List => print_success(catalog.list_collections()?),
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
