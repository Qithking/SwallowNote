use rusqlite::{Connection, OpenFlags, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AiRolePromptsDatabase {
    pub conn: Mutex<Connection>,
}

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

pub fn init_ai_role_prompts_db(app_data_dir: PathBuf) -> Result<AiRolePromptsDatabase> {
    let db_path = app_data_dir.join("ai_role_prompts.db");
    let conn = Connection::open_with_flags(
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_role_prompts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role_key TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            prompt TEXT NOT NULL DEFAULT '',
            is_builtin INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
            updated_at DATETIME NOT NULL DEFAULT (datetime('now','localtime'))
        )",
        [],
    )?;

    // Insert built-in role prompts if they don't exist
    let builtin_roles = [
        ("chat", "智能问答", "你是小燕子（Swallow），一只聪明友善的燕子。你是一个全能型的AI助手，擅长回答各种问题，提供准确、有深度的解答。回答时应当条理清晰、语言简洁，必要时使用列表和结构化格式。"),
        ("continue_writing", "续写", "你是小燕子（Swallow），一只擅长创作的燕子。你的任务是根据用户提供的文本内容进行续写。续写时需保持原文的语气、风格和叙事视角，确保衔接自然流畅。只输出续写内容，不要重复原文。"),
        ("polish", "润色", "你是小燕子（Swallow），一只擅长文字打磨的燕子。你的任务是对用户提供的文本进行润色优化，提升表达的准确性、流畅性和文学性。保持原文的核心意思不变，优化用词、句式和段落结构。直接输出润色后的文本，无需解释修改内容。"),
        ("correct", "纠错", "你是小燕子（Swallow），一只严谨细致的燕子。你的任务是检查并纠正用户文本中的错别字、语法错误、标点错误和逻辑错误。先输出纠正后的完整文本，然后列出修改之处。如果文本没有错误，直接返回原文并说明未发现错误。"),
        ("outline", "提纲", "你是小燕子（Swallow），一只擅长梳理思路的燕子。你的任务是根据用户提供的主题或内容，生成层次分明、逻辑清晰的文章提纲。使用多级标题结构，标注每个部分的核心要点。"),
        ("summary", "摘要", "你是小燕子（Swallow），一只善于提炼精华的燕子。你的任务是对用户提供的文本进行摘要提炼。摘要应当保留核心观点和关键信息，语言精炼，篇幅为原文的20%-30%。"),
        ("format", "格式整理", "你是小燕子（Swallow），一只注重规范格式的燕子。你的任务是将用户提供的文本整理为规范格式，包括：统一标题层级、规范标点符号、对齐缩进、整理列表和表格、修正排版问题。直接输出整理后的文本。"),
    ];

    for (key, name, prompt) in &builtin_roles {
        conn.execute(
            "INSERT OR IGNORE INTO ai_role_prompts (role_key, name, prompt, is_builtin) VALUES (?1, ?2, ?3, 1)",
            [key, name, prompt],
        )?;
    }

    Ok(AiRolePromptsDatabase {
        conn: Mutex::new(conn),
    })
}

pub fn load_role_prompts(db: &AiRolePromptsDatabase) -> Result<Vec<AiRolePrompt>> {
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

pub fn get_role_prompt(db: &AiRolePromptsDatabase, role_key: &str) -> Result<Option<AiRolePrompt>> {
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

pub fn update_role_prompt(db: &AiRolePromptsDatabase, role_key: &str, prompt: &str) -> Result<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "UPDATE ai_role_prompts SET prompt = ?1, updated_at = datetime('now','localtime') WHERE role_key = ?2",
        [prompt, role_key],
    )?;
    Ok(())
}
