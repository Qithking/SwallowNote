use crate::db::Database;
use rusqlite::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiRolePrompt {
    pub id: i64,
    pub role_key: String,
    pub name: String,
    pub prompt: String,
    pub is_builtin: bool,
    pub created_at: String,
    pub updated_at: String,
}

pub fn load_role_prompts(db: &Database) -> Result<Vec<AiRolePrompt>> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, role_key, name, prompt, is_builtin, created_at, updated_at FROM ai_role_prompts ORDER BY id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(AiRolePrompt {
            id: row.get(0)?,
            role_key: row.get(1)?,
            name: row.get(2)?,
            prompt: row.get(3)?,
            is_builtin: row.get::<_, i32>(4)? != 0,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;

    let mut prompts = Vec::new();
    for row in rows {
        prompts.push(row?);
    }
    Ok(prompts)
}

pub fn get_role_prompt(db: &Database, role_key: &str) -> Result<Option<AiRolePrompt>> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, role_key, name, prompt, is_builtin, created_at, updated_at FROM ai_role_prompts WHERE role_key = ?1",
    )?;
    let mut rows = stmt.query_map([role_key], |row| {
        Ok(AiRolePrompt {
            id: row.get(0)?,
            role_key: row.get(1)?,
            name: row.get(2)?,
            prompt: row.get(3)?,
            is_builtin: row.get::<_, i32>(4)? != 0,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;

    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn update_role_prompt(db: &Database, role_key: &str, prompt: &str) -> Result<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "UPDATE ai_role_prompts SET prompt = ?1, updated_at = datetime('now','localtime') WHERE role_key = ?2",
        [prompt, role_key],
    )?;
    Ok(())
}

pub fn add_role_prompt(db: &Database, role_key: &str, name: &str, prompt: &str) -> Result<AiRolePrompt> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO ai_role_prompts (role_key, name, prompt, is_builtin) VALUES (?1, ?2, ?3, 0)",
        [role_key, name, prompt],
    )?;
    let id = conn.last_insert_rowid();
    Ok(AiRolePrompt {
        id,
        role_key: role_key.to_string(),
        name: name.to_string(),
        prompt: prompt.to_string(),
        is_builtin: false,
        created_at: String::new(),
        updated_at: String::new(),
    })
}

pub fn delete_role_prompt(db: &Database, role_key: &str) -> Result<()> {
    let conn = db.conn.lock().unwrap();
    // Only allow deleting non-builtin prompts
    conn.execute(
        "DELETE FROM ai_role_prompts WHERE role_key = ?1 AND is_builtin = 0",
        [role_key],
    )?;
    Ok(())
}

pub fn update_role_prompt_name(db: &Database, role_key: &str, name: &str) -> Result<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "UPDATE ai_role_prompts SET name = ?1, updated_at = datetime('now','localtime') WHERE role_key = ?2",
        [name, role_key],
    )?;
    Ok(())
}
