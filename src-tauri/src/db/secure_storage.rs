//! 插件敏感数据存储（P1.5 / ADR-0003）：单表 secure_storage，密文以
//! base64(nonce ‖ ciphertext) 存储，明文永不落库。密钥派生与加解密
//! 在 `crate::crypto`，repo 层只负责密文 CRUD。

use rusqlite::{params, Connection, Result};

/// 写入（或覆盖）一条密文。幂等 upsert。
pub fn upsert_secret(
    conn: &Connection,
    plugin_id: &str,
    key: &str,
    ciphertext: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO secure_storage (plugin_id, key, ciphertext, updated_at)
         VALUES (?1, ?2, ?3, datetime('now','localtime'))
         ON CONFLICT(plugin_id, key) DO UPDATE SET
            ciphertext = excluded.ciphertext,
            updated_at = datetime('now','localtime')",
        params![plugin_id, key, ciphertext],
    )?;
    Ok(())
}

/// 读取一条密文。缺失返回 None（调用方据此返回 null / 空值）。
pub fn read_secret(
    conn: &Connection,
    plugin_id: &str,
    key: &str,
) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT ciphertext FROM secure_storage WHERE plugin_id = ?1 AND key = ?2",
    )?;
    let mut rows = stmt.query(params![plugin_id, key])?;
    match rows.next()? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

/// 删除一条密文。幂等：不存在的键不报错。
pub fn delete_secret(conn: &Connection, plugin_id: &str, key: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM secure_storage WHERE plugin_id = ?1 AND key = ?2",
        params![plugin_id, key],
    )?;
    Ok(())
}

/// 列出某插件的全部键名（字典序，输出确定）。不含密文。
pub fn list_secret_keys(conn: &Connection, plugin_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT key FROM secure_storage WHERE plugin_id = ?1 ORDER BY key ASC",
    )?;
    let rows = stmt.query_map(params![plugin_id], |row| row.get::<_, String>(0))?;
    let mut keys = Vec::new();
    for row in rows {
        keys.push(row?);
    }
    Ok(keys)
}

/// 删除某插件的全部密文（卸载勾选 delete_data 时连带删）。幂等。
pub fn drop_secure_storage_for(conn: &Connection, plugin_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM secure_storage WHERE plugin_id = ?1",
        params![plugin_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// in-memory 连接 + 生产 DDL 镜像，测试同款列类型/约束。
    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE secure_storage (
                plugin_id TEXT NOT NULL,
                key TEXT NOT NULL,
                ciphertext TEXT NOT NULL,
                updated_at DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
                PRIMARY KEY (plugin_id, key)
            )",
        )
        .unwrap();
        c
    }

    #[test]
    fn upsert_and_read_round_trip() {
        let c = conn();
        upsert_secret(&c, "p1", "apiKey", "cipher-a").unwrap();
        assert_eq!(read_secret(&c, "p1", "apiKey").unwrap().unwrap(), "cipher-a");
    }

    #[test]
    fn read_missing_returns_none() {
        let c = conn();
        assert!(read_secret(&c, "p1", "nope").unwrap().is_none());
    }

    #[test]
    fn upsert_overwrites_same_key() {
        let c = conn();
        upsert_secret(&c, "p1", "apiKey", "old").unwrap();
        upsert_secret(&c, "p1", "apiKey", "new").unwrap();
        assert_eq!(read_secret(&c, "p1", "apiKey").unwrap().unwrap(), "new");
        // 覆盖不产生重复行
        let keys = list_secret_keys(&c, "p1").unwrap();
        assert_eq!(keys.len(), 1);
    }

    #[test]
    fn same_key_isolated_across_plugins() {
        // 同 key 名在不同插件命名空间下互不干扰（密文不同由 crypto 层保证）
        let c = conn();
        upsert_secret(&c, "p1", "apiKey", "cipher-p1").unwrap();
        upsert_secret(&c, "p2", "apiKey", "cipher-p2").unwrap();
        assert_eq!(read_secret(&c, "p1", "apiKey").unwrap().unwrap(), "cipher-p1");
        assert_eq!(read_secret(&c, "p2", "apiKey").unwrap().unwrap(), "cipher-p2");
        // p1 删除不影响 p2
        delete_secret(&c, "p1", "apiKey").unwrap();
        assert!(read_secret(&c, "p1", "apiKey").unwrap().is_none());
        assert_eq!(read_secret(&c, "p2", "apiKey").unwrap().unwrap(), "cipher-p2");
    }

    #[test]
    fn list_keys_sorted_and_scoped() {
        let c = conn();
        upsert_secret(&c, "p1", "b", "x").unwrap();
        upsert_secret(&c, "p1", "a", "x").unwrap();
        upsert_secret(&c, "p1", "c", "x").unwrap();
        upsert_secret(&c, "p2", "z", "x").unwrap();
        let keys = list_secret_keys(&c, "p1").unwrap();
        assert_eq!(keys, vec!["a".to_string(), "b".to_string(), "c".to_string()]);
    }

    #[test]
    fn delete_is_idempotent() {
        let c = conn();
        upsert_secret(&c, "p1", "k", "v").unwrap();
        delete_secret(&c, "p1", "k").unwrap();
        // 再删一次不报错
        delete_secret(&c, "p1", "k").unwrap();
        assert!(read_secret(&c, "p1", "k").unwrap().is_none());
    }

    #[test]
    fn drop_for_plugin_clears_all_and_is_idempotent() {
        let c = conn();
        upsert_secret(&c, "p1", "a", "x").unwrap();
        upsert_secret(&c, "p1", "b", "x").unwrap();
        upsert_secret(&c, "p2", "keep", "x").unwrap();
        drop_secure_storage_for(&c, "p1").unwrap();
        assert!(list_secret_keys(&c, "p1").unwrap().is_empty());
        assert_eq!(list_secret_keys(&c, "p2").unwrap(), vec!["keep".to_string()]);
        // 再 drop 一次不报错
        drop_secure_storage_for(&c, "p1").unwrap();
    }
}
