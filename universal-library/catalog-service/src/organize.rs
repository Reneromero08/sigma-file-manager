use std::{path::Path, time::SystemTime};

use anyhow::{Context, Result, bail};
use rusqlite::{
    Connection, OptionalExtension, Row, Transaction, params, params_from_iter, types::Value,
};
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use super::{Catalog, now_ms};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetQuery {
    pub text: Option<String>,
    pub media_kind: Option<String>,
    pub include_offline: bool,
    pub limit: u32,
}

impl Default for AssetQuery {
    fn default() -> Self {
        Self {
            text: None,
            media_kind: None,
            include_offline: false,
            limit: 200,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssetRecord {
    pub id: String,
    pub media_kind: String,
    pub canonical_name: String,
    pub extension: Option<String>,
    pub size_bytes: Option<i64>,
    pub created_at_ns: Option<i64>,
    pub modified_at_ns: Option<i64>,
    pub is_online: bool,
    pub primary_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagRecord {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub parent_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssetTagRecord {
    pub asset_id: String,
    pub tag_id: String,
    pub name: String,
    pub color: Option<String>,
    pub assigned_at_ms: i64,
    pub assigned_by: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CollectionItemRecord {
    pub collection_id: String,
    pub asset_id: String,
    pub position: f64,
    pub section_name: Option<String>,
    pub note: Option<String>,
    pub added_at_ms: i64,
    pub canonical_name: String,
    pub media_kind: String,
    pub primary_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssetMetadataRecord {
    pub asset_id: String,
    pub namespace: String,
    pub key: String,
    pub value_json: String,
    pub source: String,
    pub confidence: Option<String>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemovalRecord {
    pub removed: bool,
}

impl Catalog {
    pub fn query_assets(&self, query: AssetQuery) -> Result<Vec<AssetRecord>> {
        let mut sql = String::from(
            "SELECT
                a.id,
                a.media_kind,
                a.canonical_name,
                a.extension,
                a.size_bytes,
                a.created_at_ns,
                a.modified_at_ns,
                EXISTS(
                    SELECT 1 FROM locations online
                    WHERE online.asset_id = a.id AND online.is_online = 1
                ) AS is_online,
                (
                    SELECT preferred.path
                    FROM locations preferred
                    WHERE preferred.asset_id = a.id
                    ORDER BY preferred.is_online DESC, preferred.is_primary DESC,
                             preferred.last_seen_at_ms DESC
                    LIMIT 1
                ) AS primary_path
             FROM assets a
             WHERE a.deleted_at_ms IS NULL",
        );
        let mut values = Vec::<Value>::new();

        if !query.include_offline {
            sql.push_str(
                " AND EXISTS(
                    SELECT 1 FROM locations online
                    WHERE online.asset_id = a.id AND online.is_online = 1
                )",
            );
        }
        if let Some(kind) = query.media_kind.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
            sql.push_str(" AND a.media_kind = ?");
            values.push(Value::Text(kind.to_ascii_lowercase()));
        }
        if let Some(text) = query.text.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
            let pattern = format!("%{}%", escape_like(text));
            sql.push_str(
                " AND (
                    a.canonical_name LIKE ? ESCAPE '\\'
                    OR EXISTS(
                        SELECT 1 FROM locations searched
                        WHERE searched.asset_id = a.id
                          AND searched.path LIKE ? ESCAPE '\\'
                    )
                )",
            );
            values.push(Value::Text(pattern.clone()));
            values.push(Value::Text(pattern));
        }

        sql.push_str(" ORDER BY a.modified_at_ns DESC, a.canonical_name COLLATE NOCASE LIMIT ?");
        values.push(Value::Integer(i64::from(query.limit.clamp(1, 1000))));

        let mut statement = self.connection.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(values), asset_from_row)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to query assets")
    }

    pub fn create_tag(&mut self, name: &str, color: Option<&str>) -> Result<TagRecord> {
        let name = non_empty(name, "tag name")?;
        let color = trimmed_optional(color);
        let now = now_ms()?;
        let transaction = self.connection.transaction()?;

        let tag_id = if let Some(existing) = find_tag_by_reference(&transaction, name)? {
            transaction.execute(
                "UPDATE tags
                 SET color = COALESCE(?1, color), updated_at_ms = ?2
                 WHERE id = ?3",
                params![color, now, existing.id],
            )?;
            existing.id
        }
        else {
            let id = Uuid::new_v4().to_string();
            transaction.execute(
                "INSERT INTO tags (id, name, color, created_at_ms, updated_at_ms)
                 VALUES (?1, ?2, ?3, ?4, ?4)",
                params![id, name, color, now],
            )?;
            id
        };

        record_audit(
            &transaction,
            "cli",
            "tag.upsert",
            "tag",
            Some(&tag_id),
            &json!({ "name": name, "color": color }),
        )?;
        let tag = find_tag_by_reference(&transaction, &tag_id)?
            .context("tag disappeared after upsert")?;
        transaction.commit()?;
        Ok(tag)
    }

    pub fn list_tags(&self) -> Result<Vec<TagRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, color, parent_id, created_at_ms, updated_at_ms
             FROM tags
             ORDER BY name COLLATE NOCASE",
        )?;
        let rows = statement.query_map([], tag_from_row)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to list tags")
    }

    pub fn assign_tag(&mut self, asset_reference: &str, tag_reference: &str) -> Result<AssetTagRecord> {
        let now = now_ms()?;
        let transaction = self.connection.transaction()?;
        let asset_id = resolve_asset_id(&transaction, asset_reference)?;
        let tag = find_tag_by_reference(&transaction, tag_reference)?
            .with_context(|| format!("unknown tag: {tag_reference}"))?;

        transaction.execute(
            "INSERT INTO asset_tags (asset_id, tag_id, assigned_at_ms, assigned_by)
             VALUES (?1, ?2, ?3, 'cli')
             ON CONFLICT(asset_id, tag_id) DO UPDATE SET
                 assigned_at_ms = excluded.assigned_at_ms,
                 assigned_by = excluded.assigned_by",
            params![asset_id, tag.id, now],
        )?;
        record_audit(
            &transaction,
            "cli",
            "asset.tag.assign",
            "asset",
            Some(&asset_id),
            &json!({ "tagId": tag.id }),
        )?;
        let record = find_asset_tag(&transaction, &asset_id, &tag.id)?
            .context("asset tag disappeared after assignment")?;
        transaction.commit()?;
        Ok(record)
    }

    pub fn remove_tag_from_asset(
        &mut self,
        asset_reference: &str,
        tag_reference: &str,
    ) -> Result<RemovalRecord> {
        let transaction = self.connection.transaction()?;
        let asset_id = resolve_asset_id(&transaction, asset_reference)?;
        let tag = find_tag_by_reference(&transaction, tag_reference)?
            .with_context(|| format!("unknown tag: {tag_reference}"))?;
        let removed = transaction.execute(
            "DELETE FROM asset_tags WHERE asset_id = ?1 AND tag_id = ?2",
            params![asset_id, tag.id],
        )? > 0;
        if removed {
            record_audit(
                &transaction,
                "cli",
                "asset.tag.remove",
                "asset",
                Some(&asset_id),
                &json!({ "tagId": tag.id }),
            )?;
        }
        transaction.commit()?;
        Ok(RemovalRecord { removed })
    }

    pub fn list_asset_tags(&self, asset_reference: &str) -> Result<Vec<AssetTagRecord>> {
        let asset_id = resolve_asset_id(&self.connection, asset_reference)?;
        let mut statement = self.connection.prepare(
            "SELECT at.asset_id, t.id, t.name, t.color, at.assigned_at_ms, at.assigned_by
             FROM asset_tags at
             JOIN tags t ON t.id = at.tag_id
             WHERE at.asset_id = ?1
             ORDER BY t.name COLLATE NOCASE",
        )?;
        let rows = statement.query_map([asset_id], asset_tag_from_row)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to list asset tags")
    }

    pub fn add_collection_item(
        &mut self,
        collection_reference: &str,
        asset_reference: &str,
        position: Option<f64>,
        section_name: Option<&str>,
        note: Option<&str>,
    ) -> Result<CollectionItemRecord> {
        if position.is_some_and(|value| !value.is_finite()) {
            bail!("collection position must be finite");
        }
        let transaction = self.connection.transaction()?;
        let collection_id = resolve_collection_id(&transaction, collection_reference)?;
        let asset_id = resolve_asset_id(&transaction, asset_reference)?;
        let position = match position {
            Some(position) => position,
            None => transaction.query_row(
                "SELECT COALESCE(MAX(position), 0.0) + 1.0
                 FROM collection_items WHERE collection_id = ?1",
                [&collection_id],
                |row| row.get(0),
            )?,
        };
        let now = now_ms()?;
        let section_name = trimmed_optional(section_name);
        let note = trimmed_optional(note);

        transaction.execute(
            "INSERT INTO collection_items (
                collection_id, asset_id, position, section_name, note, added_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(collection_id, asset_id) DO UPDATE SET
                 position = excluded.position,
                 section_name = excluded.section_name,
                 note = excluded.note",
            params![collection_id, asset_id, position, section_name, note, now],
        )?;
        record_audit(
            &transaction,
            "cli",
            "collection.item.upsert",
            "collection",
            Some(&collection_id),
            &json!({ "assetId": asset_id, "position": position }),
        )?;
        let item = find_collection_item(&transaction, &collection_id, &asset_id)?
            .context("collection item disappeared after upsert")?;
        transaction.commit()?;
        Ok(item)
    }

    pub fn remove_collection_item(
        &mut self,
        collection_reference: &str,
        asset_reference: &str,
    ) -> Result<RemovalRecord> {
        let transaction = self.connection.transaction()?;
        let collection_id = resolve_collection_id(&transaction, collection_reference)?;
        let asset_id = resolve_asset_id(&transaction, asset_reference)?;
        let removed = transaction.execute(
            "DELETE FROM collection_items WHERE collection_id = ?1 AND asset_id = ?2",
            params![collection_id, asset_id],
        )? > 0;
        if removed {
            record_audit(
                &transaction,
                "cli",
                "collection.item.remove",
                "collection",
                Some(&collection_id),
                &json!({ "assetId": asset_id }),
            )?;
        }
        transaction.commit()?;
        Ok(RemovalRecord { removed })
    }

    pub fn list_collection_items(
        &self,
        collection_reference: &str,
    ) -> Result<Vec<CollectionItemRecord>> {
        let collection_id = resolve_collection_id(&self.connection, collection_reference)?;
        let mut statement = self.connection.prepare(
            "SELECT
                ci.collection_id,
                ci.asset_id,
                ci.position,
                ci.section_name,
                ci.note,
                ci.added_at_ms,
                a.canonical_name,
                a.media_kind,
                (
                    SELECT preferred.path FROM locations preferred
                    WHERE preferred.asset_id = a.id
                    ORDER BY preferred.is_online DESC, preferred.is_primary DESC,
                             preferred.last_seen_at_ms DESC
                    LIMIT 1
                ) AS primary_path
             FROM collection_items ci
             JOIN assets a ON a.id = ci.asset_id
             WHERE ci.collection_id = ?1
             ORDER BY ci.position, ci.added_at_ms, a.canonical_name COLLATE NOCASE",
        )?;
        let rows = statement.query_map([collection_id], collection_item_from_row)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to list collection items")
    }

    pub fn set_asset_metadata(
        &mut self,
        asset_reference: &str,
        namespace: &str,
        key: &str,
        value_json: &str,
        source: &str,
    ) -> Result<AssetMetadataRecord> {
        let namespace = non_empty(namespace, "metadata namespace")?;
        let key = non_empty(key, "metadata key")?;
        let source = non_empty(source, "metadata source")?;
        let value: serde_json::Value = serde_json::from_str(value_json)
            .with_context(|| format!("metadata value is not valid JSON: {value_json}"))?;
        let normalized = serde_json::to_string(&value)?;
        let now = now_ms()?;
        let transaction = self.connection.transaction()?;
        let asset_id = resolve_asset_id(&transaction, asset_reference)?;

        transaction.execute(
            "INSERT INTO asset_metadata (
                asset_id, namespace, key, value_json, source, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(asset_id, namespace, key) DO UPDATE SET
                 value_json = excluded.value_json,
                 source = excluded.source,
                 confidence = NULL,
                 updated_at_ms = excluded.updated_at_ms",
            params![asset_id, namespace, key, normalized, source, now],
        )?;
        record_audit(
            &transaction,
            source,
            "asset.metadata.set",
            "asset",
            Some(&asset_id),
            &json!({ "namespace": namespace, "key": key }),
        )?;
        let record = find_asset_metadata(&transaction, &asset_id, namespace, key)?
            .context("metadata disappeared after upsert")?;
        transaction.commit()?;
        Ok(record)
    }

    pub fn list_asset_metadata(&self, asset_reference: &str) -> Result<Vec<AssetMetadataRecord>> {
        let asset_id = resolve_asset_id(&self.connection, asset_reference)?;
        let mut statement = self.connection.prepare(
            "SELECT asset_id, namespace, key, value_json, source,
                    CAST(confidence AS TEXT), updated_at_ms
             FROM asset_metadata
             WHERE asset_id = ?1
             ORDER BY namespace COLLATE NOCASE, key COLLATE NOCASE",
        )?;
        let rows = statement.query_map([asset_id], asset_metadata_from_row)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to list asset metadata")
    }
}

fn resolve_asset_id(connection: &Connection, reference: &str) -> Result<String> {
    if let Some(id) = connection
        .query_row("SELECT id FROM assets WHERE id = ?1", [reference], |row| row.get(0))
        .optional()?
    {
        return Ok(id);
    }
    if let Some(id) = connection
        .query_row(
            "SELECT asset_id FROM locations WHERE path = ?1",
            [reference],
            |row| row.get(0),
        )
        .optional()?
    {
        return Ok(id);
    }
    if Path::new(reference).exists() {
        let canonical = std::fs::canonicalize(reference)?;
        let path = canonical.to_string_lossy();
        if let Some(id) = connection
            .query_row(
                "SELECT asset_id FROM locations WHERE path = ?1",
                [path.as_ref()],
                |row| row.get(0),
            )
            .optional()?
        {
            return Ok(id);
        }
    }
    bail!("unknown asset ID or path: {reference}")
}

fn resolve_collection_id(connection: &Connection, reference: &str) -> Result<String> {
    if let Some(id) = connection
        .query_row(
            "SELECT id FROM collections WHERE id = ?1",
            [reference],
            |row| row.get(0),
        )
        .optional()?
    {
        return Ok(id);
    }
    let mut statement = connection.prepare(
        "SELECT id FROM collections WHERE name = ?1 COLLATE NOCASE ORDER BY created_at_ms",
    )?;
    let matches = statement
        .query_map([reference], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    match matches.as_slice() {
        [id] => Ok(id.clone()),
        [] => bail!("unknown collection ID or name: {reference}"),
        _ => bail!("collection name is ambiguous; use its ID: {reference}"),
    }
}

fn find_tag_by_reference(connection: &Connection, reference: &str) -> Result<Option<TagRecord>> {
    connection
        .query_row(
            "SELECT id, name, color, parent_id, created_at_ms, updated_at_ms
             FROM tags
             WHERE id = ?1 OR name = ?1 COLLATE NOCASE
             ORDER BY CASE WHEN id = ?1 THEN 0 ELSE 1 END
             LIMIT 1",
            [reference],
            tag_from_row,
        )
        .optional()
        .context("failed to resolve tag")
}

fn find_asset_tag(
    connection: &Connection,
    asset_id: &str,
    tag_id: &str,
) -> Result<Option<AssetTagRecord>> {
    connection
        .query_row(
            "SELECT at.asset_id, t.id, t.name, t.color, at.assigned_at_ms, at.assigned_by
             FROM asset_tags at
             JOIN tags t ON t.id = at.tag_id
             WHERE at.asset_id = ?1 AND at.tag_id = ?2",
            params![asset_id, tag_id],
            asset_tag_from_row,
        )
        .optional()
        .context("failed to resolve asset tag")
}

fn find_collection_item(
    connection: &Connection,
    collection_id: &str,
    asset_id: &str,
) -> Result<Option<CollectionItemRecord>> {
    connection
        .query_row(
            "SELECT
                ci.collection_id,
                ci.asset_id,
                ci.position,
                ci.section_name,
                ci.note,
                ci.added_at_ms,
                a.canonical_name,
                a.media_kind,
                (
                    SELECT preferred.path FROM locations preferred
                    WHERE preferred.asset_id = a.id
                    ORDER BY preferred.is_online DESC, preferred.is_primary DESC,
                             preferred.last_seen_at_ms DESC
                    LIMIT 1
                ) AS primary_path
             FROM collection_items ci
             JOIN assets a ON a.id = ci.asset_id
             WHERE ci.collection_id = ?1 AND ci.asset_id = ?2",
            params![collection_id, asset_id],
            collection_item_from_row,
        )
        .optional()
        .context("failed to resolve collection item")
}

fn find_asset_metadata(
    connection: &Connection,
    asset_id: &str,
    namespace: &str,
    key: &str,
) -> Result<Option<AssetMetadataRecord>> {
    connection
        .query_row(
            "SELECT asset_id, namespace, key, value_json, source,
                    CAST(confidence AS TEXT), updated_at_ms
             FROM asset_metadata
             WHERE asset_id = ?1 AND namespace = ?2 AND key = ?3",
            params![asset_id, namespace, key],
            asset_metadata_from_row,
        )
        .optional()
        .context("failed to resolve asset metadata")
}

fn record_audit(
    transaction: &Transaction<'_>,
    actor: &str,
    action: &str,
    target_kind: &str,
    target_id: Option<&str>,
    details: &serde_json::Value,
) -> Result<()> {
    transaction.execute(
        "INSERT INTO audit_log (
            occurred_at_ms, actor, action, target_kind, target_id, details_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            now_ms()?,
            actor,
            action,
            target_kind,
            target_id,
            serde_json::to_string(details)?,
        ],
    )?;
    Ok(())
}

fn non_empty<'a>(value: &'a str, field: &str) -> Result<&'a str> {
    let value = value.trim();
    if value.is_empty() {
        bail!("{field} cannot be empty");
    }
    Ok(value)
}

fn trimmed_optional(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn escape_like(value: &str) -> String {
    value.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

fn asset_from_row(row: &Row<'_>) -> rusqlite::Result<AssetRecord> {
    Ok(AssetRecord {
        id: row.get(0)?,
        media_kind: row.get(1)?,
        canonical_name: row.get(2)?,
        extension: row.get(3)?,
        size_bytes: row.get(4)?,
        created_at_ns: row.get(5)?,
        modified_at_ns: row.get(6)?,
        is_online: row.get::<_, i64>(7)? != 0,
        primary_path: row.get(8)?,
    })
}

fn tag_from_row(row: &Row<'_>) -> rusqlite::Result<TagRecord> {
    Ok(TagRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        parent_id: row.get(3)?,
        created_at_ms: row.get(4)?,
        updated_at_ms: row.get(5)?,
    })
}

fn asset_tag_from_row(row: &Row<'_>) -> rusqlite::Result<AssetTagRecord> {
    Ok(AssetTagRecord {
        asset_id: row.get(0)?,
        tag_id: row.get(1)?,
        name: row.get(2)?,
        color: row.get(3)?,
        assigned_at_ms: row.get(4)?,
        assigned_by: row.get(5)?,
    })
}

fn collection_item_from_row(row: &Row<'_>) -> rusqlite::Result<CollectionItemRecord> {
    Ok(CollectionItemRecord {
        collection_id: row.get(0)?,
        asset_id: row.get(1)?,
        position: row.get(2)?,
        section_name: row.get(3)?,
        note: row.get(4)?,
        added_at_ms: row.get(5)?,
        canonical_name: row.get(6)?,
        media_kind: row.get(7)?,
        primary_path: row.get(8)?,
    })
}

fn asset_metadata_from_row(row: &Row<'_>) -> rusqlite::Result<AssetMetadataRecord> {
    Ok(AssetMetadataRecord {
        asset_id: row.get(0)?,
        namespace: row.get(1)?,
        key: row.get(2)?,
        value_json: row.get(3)?,
        source: row.get(4)?,
        confidence: row.get(5)?,
        updated_at_ms: row.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::escape_like;

    #[test]
    fn escapes_literal_like_wildcards() {
        assert_eq!(escape_like(r"50%_done\\"), r"50\%\_done\\\\");
    }

    #[test]
    fn system_time_import_remains_used_for_future_metadata_expansion() {
        let _ = SystemTime::UNIX_EPOCH;
    }
}
