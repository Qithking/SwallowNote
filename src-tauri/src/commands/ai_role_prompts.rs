use crate::db::ai_role_prompts::AiRolePrompt;
use crate::db::Database;
use tauri::State;

#[tauri::command]
pub fn load_ai_role_prompts(
    db: State<Database>,
) -> Result<Vec<AiRolePrompt>, String> {
    crate::db::ai_role_prompts::load_role_prompts(&db)
        .map_err(|e| format!("Failed to load AI role prompts: {}", e))
}

#[tauri::command]
pub fn get_ai_role_prompt(
    db: State<Database>,
    role_key: String,
) -> Result<Option<AiRolePrompt>, String> {
    crate::db::ai_role_prompts::get_role_prompt(&db, &role_key)
        .map_err(|e| format!("Failed to get AI role prompt: {}", e))
}

#[tauri::command]
pub fn update_ai_role_prompt(
    db: State<Database>,
    role_key: String,
    prompt: String,
) -> Result<(), String> {
    crate::db::ai_role_prompts::update_role_prompt(&db, &role_key, &prompt)
        .map_err(|e| format!("Failed to update AI role prompt: {}", e))
}

#[tauri::command]
pub fn add_ai_role_prompt(
    db: State<Database>,
    role_key: String,
    name: String,
    prompt: String,
) -> Result<AiRolePrompt, String> {
    crate::db::ai_role_prompts::add_role_prompt(&db, &role_key, &name, &prompt)
        .map_err(|e| format!("Failed to add AI role prompt: {}", e))
}

#[tauri::command]
pub fn delete_ai_role_prompt(
    db: State<Database>,
    role_key: String,
) -> Result<(), String> {
    crate::db::ai_role_prompts::delete_role_prompt(&db, &role_key)
        .map_err(|e| format!("Failed to delete AI role prompt: {}", e))
}

#[tauri::command]
pub fn update_ai_role_prompt_name(
    db: State<Database>,
    role_key: String,
    name: String,
) -> Result<(), String> {
    crate::db::ai_role_prompts::update_role_prompt_name(&db, &role_key, &name)
        .map_err(|e| format!("Failed to update AI role prompt name: {}", e))
}

#[tauri::command]
pub fn reset_ai_role_prompt(
    db: State<Database>,
    role_key: String,
) -> Result<AiRolePrompt, String> {
    // Define default prompts (must match the ones in db/mod.rs)
    let default_prompts: std::collections::HashMap<&str, &str> = [
        ("chat", "你是一个全能型的AI助手，擅长回答各种问题，并提供准确且有深度的解答。在回答问题时，请确保内容条理清晰、语言简洁。当需要时，请使用列表和结构化格式来组织信息，以提高可读性和可操作性。"),
        ("continue_writing", "你是一位专业的文本续写助手。请根据用户提供的文本进行续写，确保续写内容与原文的语气、风格和叙事视角完全一致，衔接自然流畅。\n⚠️ 严格输出约束（极其重要）：\n必须且只能输出续写的正文内容！\n【禁止添加开头】绝对禁止在开头添加任何标题、标签或引导语（如\"### 续写内容\"、\"续写如下：\"等）。\n【禁止添加结尾】绝对禁止在结尾添加任何总结、客套话或提供进一步帮助的语句（如\"如需补充…\"、\"希望对你有帮助\"等）。\n你的输出必须仿佛是原作者继续敲击键盘写下的文字，第一句话直接承接原文，最后一句话停在内容的自然断点，没有任何第三方介入的痕迹。\n❌ 错误输出示例：\n续写内容\n天色渐渐暗了下来，远处的山峦变成了黑色的剪影。\n如需补充更多细节，请随时告诉我。\n✅ 正确输出示例：\n天色渐渐暗了下来，远处的山峦变成了黑色的剪影。"),
        ("polish", "你是一位专业的AI助手，擅长对用户提供的文本进行润色和优化。你的任务是提升文本的准确性、流畅性和文学性，同时保持原文的核心意思不变。你需要优化用词、句式和段落结构，直接输出润色后的文本，无需解释修改内容。请确保输出的内容清晰、结构化且具有可操作性。"),
        ("correct", "你是一位严谨细致的AI助手。你的任务是检查并纠正用户提供的文本中的错别字、语法错误、标点错误和逻辑错误。请按照以下步骤操作：1. 输出纠正后的完整文本。2. 列出所有修改之处，包括错误类型和修改建议。如果文本没有错误，请直接返回原文，并说明未发现错误。"),
        ("outline", "你是一位专业的AI助手，擅长帮助用户梳理思路。你的任务是根据用户提供的主题或内容，生成一篇层次分明、逻辑清晰的文章提纲。请使用多级标题结构，并在每个部分标注核心要点。提纲应具备清晰、结构化和可操作的内容。"),
        ("summary", "你是一位专业的AI助手，擅长提炼文本精华。你的任务是对用户提供的文本进行摘要，保留核心观点和关键信息。摘要应语言精炼，篇幅为原文的20%-30%。请确保摘要内容清晰、结构化，并且具有可操作性。"),
        ("format", "# 任务\n\n你是一个文本排版助手。将用户输入的杂乱文本整理为规范的 Markdown 格式。\n\n仅执行以下操作：统一标题层级、规范标点、对齐缩进、整理列表、修正代码块语言标识、清理行尾的 \\\n\n\n\n# 强制规则（违反任何一条即为失败）\n\n1. 【绝不允许全局包裹】禁止在最外层使用 ```markdown 或 ``` 包裹输出！你的回复必须以纯文本字符（如 # 或文字）开始，以纯文本字符结束。\n\n2. 【绝不改变原结构】原文是列表就是列表，严禁自作主张将列表转换为表格！\n\n3. 【绝不增删改写】严禁添加原文没有的内容（补充解释说明），严禁润色修改原词，保留原始措辞。\n\n\n\n# 格式对比示例\n\n❌ 错误（包含外层包裹）：\n\n```markdown\n\n## 标题\n\n- 内容\n\n```\n\n\n\n✅ 正确（无外层包裹）：\n\n## 标题\n\n- 内容\n\n\n\n请直接输出整理后的结果，不要包含任何问候或解释。"),
        ("complete", "你是一位专业的文本补全助手。请根据用户提供的文本片段进行补全，确保补全内容与原文语境一致、逻辑连贯。直接输出补全后的完整内容，无需解释。"),
        ("rewrite", "你是一位专业的文本改写助手。请根据用户提供的文本进行改写，可以调整句式、替换词汇、重组结构，但必须保持原文核心意思不变。直接输出改写后的文本，无需解释修改内容。"),
        ("explain", "你是一位专业的文本解释助手。请对用户提供的文本进行解释说明，包括术语含义、背景知识、逻辑关系等。解释应清晰易懂，结构化呈现，必要时使用列表和示例。"),
    ].iter().cloned().collect();

    let default_prompt = default_prompts.get(role_key.as_str()).unwrap_or(&"");

    // Update the prompt to default
    crate::db::ai_role_prompts::update_role_prompt(&db, &role_key, default_prompt)
        .map_err(|e| format!("Failed to reset AI role prompt: {}", e))?;

    // Return the updated prompt
    crate::db::ai_role_prompts::get_role_prompt(&db, &role_key)
        .map_err(|e| format!("Failed to get reset AI role prompt: {}", e))?
        .ok_or_else(|| "Role prompt not found after reset".to_string())
}
