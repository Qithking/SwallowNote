//! 数据模型：与数据库 `notes` 表对应的结构体。

use serde::{Deserialize, Serialize};

/// 笔记/文件夹类型。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NoteType {
    File,
    Folder,
}

impl NoteType {
    /// 从字符串构造（用于数据库读取）。
    pub fn from_str(s: &str) -> Self {
        match s {
            "folder" => NoteType::Folder,
            _ => NoteType::File,
        }
    }

    /// 转字符串（用于数据库写入）。
    pub fn as_str(&self) -> &'static str {
        match self {
            NoteType::File => "file",
            NoteType::Folder => "folder",
        }
    }
}

/// `list_children` 返回的列表项：不含 `content` 字段（性能优化）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteListItem {
    pub id: String,
    pub parent_id: Option<String>,
    pub title: String,
    #[serde(rename = "type")]
    pub note_type: NoteType,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// `get_note` 返回的完整笔记：含 `content` 字段。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFull {
    pub id: String,
    pub parent_id: Option<String>,
    pub title: String,
    #[serde(rename = "type")]
    pub note_type: NoteType,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
    pub content: String,
}
