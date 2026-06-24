/**
 * DOCX ZIP 后处理 — 注入 OOXML oMath
 *
 * docx-rs 0.4 不支持 OOXML 数学公式（oMath/oMathPara），
 * 因此在 docx-rs 生成 DOCX 后，通过 ZIP 后处理将占位段落
 * 替换为实际的 OMML XML。
 *
 * 流程：
 * 1. docx-rs 构建时，katex 代码块生成占位段落（如 `__MATH_BLOCK_0__`）
 * 2. 打包后，读取 ZIP 中的 word/document.xml
 * 3. 找到包含占位文本的 `<w:p>` 段落
 * 4. 将其替换为对应的 OMML XML
 * 5. 确保 OMML 命名空间声明在根元素
 * 6. 重新打包 ZIP
 */

use std::io::Cursor;
use thiserror::Error;
use zip::write::FileOptions;
use zip::{ZipArchive, ZipWriter};

#[derive(Debug, Error)]
pub enum PostProcessError {
    #[error("ZIP 读取失败: {0}")]
    ZipRead(String),
    #[error("document.xml 未找到")]
    DocumentNotFound,
    #[error("XML 处理失败: {0}")]
    XmlProcess(String),
    #[error("ZIP 写入失败: {0}")]
    ZipWrite(String),
}

/// 在已打包的 DOCX 字节中，将占位段落替换为 OMML XML。
///
/// `math_blocks` 是 (占位标记, OMML XML) 对的列表。
/// 占位标记格式如 `__MATH_BLOCK_0__`。
pub fn inject_omml(
    docx_bytes: &[u8],
    math_blocks: &[(String, String)],
) -> Result<Vec<u8>, PostProcessError> {
    if math_blocks.is_empty() {
        return Ok(docx_bytes.to_vec());
    }

    // 读取 ZIP
    let mut archive = ZipArchive::new(Cursor::new(docx_bytes.to_vec()))
        .map_err(|e| PostProcessError::ZipRead(e.to_string()))?;

    // 提取 document.xml
    let document_xml = extract_document_xml(&mut archive)?;

    // 处理 document.xml：替换占位段落 + 添加命名空间
    let processed_xml = process_document_xml(&document_xml, math_blocks)?;

    // 重新打包 ZIP
    rebuild_zip(archive, &processed_xml)
}

/// 从 ZIP 中提取 word/document.xml 的内容
fn extract_document_xml(
    archive: &mut ZipArchive<Cursor<Vec<u8>>>,
) -> Result<String, PostProcessError> {
    let mut file = archive
        .by_name("word/document.xml")
        .map_err(|_| PostProcessError::DocumentNotFound)?;
    let mut content = String::new();
    std::io::Read::read_to_string(&mut file, &mut content)
        .map_err(|e| PostProcessError::ZipRead(e.to_string()))?;
    Ok(content)
}

/// 处理 document.xml：替换占位段落并确保命名空间存在。
/// 使用字符串操作而非事件流，避免 XML 转义问题。
fn process_document_xml(
    xml: &str,
    math_blocks: &[(String, String)],
) -> Result<String, PostProcessError> {
    let mut result = xml.to_string();

    // 对每个占位符，找到其所在的 <w:p>...</w:p> 并替换为 OMML
    for (placeholder, omml) in math_blocks {
        result = replace_placeholder_paragraph(&result, placeholder, omml);
    }

    // 确保 OMML 命名空间声明在根元素
    result = ensure_omml_namespace(&result);

    Ok(result)
}

/// 在 XML 字符串中找到包含占位文本的 `<w:p>` 段落并替换为 OMML XML。
fn replace_placeholder_paragraph(xml: &str, placeholder: &str, omml: &str) -> String {
    // 查找占位文本在 XML 中的位置
    let Some(text_pos) = xml.find(placeholder) else {
        return xml.to_string();
    };

    // 向前搜索包含此文本的 <w:p> 开始标签位置
    let Some(para_start) = find_paragraph_start_before(xml, text_pos) else {
        return xml.to_string();
    };

    // 从 <w:p> 开始位置向后搜索对应的 </w:p>
    let para_end = find_paragraph_end(xml, para_start);

    // 替换整个 <w:p>...</w:p> 为 OMML XML
    let mut result = String::with_capacity(xml.len() + omml.len());
    result.push_str(&xml[..para_start]);
    result.push_str(omml);
    if let Some(end) = para_end {
        result.push_str(&xml[end..]);
    }
    result
}

/// 判断位置 pos 处是否是 `<w:p` 标签的开始（不是 `<w:pPr>` 等）
fn is_paragraph_tag_start(xml: &str, pos: usize) -> bool {
    let remaining = &xml[pos..];
    remaining.starts_with("<w:p>") || remaining.starts_with("<w:p ")
}

/// 在指定位置之前查找最近的 `<w:p>` 开始标签位置
fn find_paragraph_start_before(xml: &str, before_pos: usize) -> Option<usize> {
    let mut search_end = before_pos;
    loop {
        // 搜索 <w:p 标签
        let pos = xml[..search_end].rfind("<w:p")?;
        if is_paragraph_tag_start(xml, pos) {
            return Some(pos);
        }
        if pos == 0 {
            return None;
        }
        search_end = pos;
    }
}

/// 从 `<w:p>` 开始标签位置找到对应的 `</w:p>` 结束位置
fn find_paragraph_end(xml: &str, start_pos: usize) -> Option<usize> {
    let mut depth: i32 = 0;
    let mut pos = start_pos;

    while pos < xml.len() {
        // 查找下一个 <w:p> 开始标签
        let next_open = find_paragraph_open_from(xml, pos);
        // 查找下一个 </w:p> 结束标签
        let next_close = xml[pos..].find("</w:p>").map(|i| pos + i);

        match (next_open, next_close) {
            (Some(o), Some(c)) if o < c => {
                // 先遇到开始标签 — 增加深度
                depth += 1;
                // 跳过这个开始标签
                pos = skip_tag(xml, o);
            }
            (Some(_), Some(c)) => {
                // 先遇到结束标签
                depth -= 1;
                if depth == 0 {
                    return Some(c + "</w:p>".len());
                }
                pos = c + "</w:p>".len();
            }
            (None, Some(c)) => {
                depth -= 1;
                if depth == 0 {
                    return Some(c + "</w:p>".len());
                }
                pos = c + "</w:p>".len();
            }
            (Some(_), None) | (None, None) => return None,
        }
    }
    None
}

/// 从指定位置开始查找下一个 `<w:p>` 开始标签
fn find_paragraph_open_from(xml: &str, from: usize) -> Option<usize> {
    let mut pos = from;
    loop {
        let idx = xml[pos..].find("<w:p")?;
        let abs_pos = pos + idx;
        if is_paragraph_tag_start(xml, abs_pos) {
            return Some(abs_pos);
        }
        pos = abs_pos + 4;
        if pos >= xml.len() {
            return None;
        }
    }
}

/// 跳过当前标签（找到 `>` 后的位置）
fn skip_tag(xml: &str, tag_start: usize) -> usize {
    if let Some(end) = xml[tag_start..].find('>') {
        tag_start + end + 1
    } else {
        xml.len()
    }
}

/// 确保 OMML 命名空间声明在 <w:document> 根元素上
fn ensure_omml_namespace(xml: &str) -> String {
    let ns = "xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\"";
    if xml.contains(ns) {
        return xml.to_string();
    }

    // 在 <w:document> 标签的 > 之前插入命名空间
    if let Some(pos) = xml.find("<w:document") {
        if let Some(end) = xml[pos..].find('>') {
            let insert_pos = pos + end;
            let mut result = String::with_capacity(xml.len() + ns.len() + 2);
            result.push_str(&xml[..insert_pos]);
            result.push(' ');
            result.push_str(ns);
            result.push_str(&xml[insert_pos..]);
            return result;
        }
    }

    xml.to_string()
}

/// 重新打包 ZIP：替换 document.xml，其余文件原样复制
fn rebuild_zip(
    mut archive: ZipArchive<Cursor<Vec<u8>>>,
    new_document_xml: &str,
) -> Result<Vec<u8>, PostProcessError> {
    let mut output = Cursor::new(Vec::new());
    let mut zip_writer = ZipWriter::new(&mut output);

    // 复制所有文件，替换 document.xml
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| PostProcessError::ZipWrite(e.to_string()))?;
        let name = file.name().to_string();

        if name == "word/document.xml" {
            // 写入修改后的 document.xml
            let options = FileOptions::<()>::default()
                .compression_method(file.compression())
                .unix_permissions(0o644);
            zip_writer
                .start_file(&name, options)
                .map_err(|e| PostProcessError::ZipWrite(e.to_string()))?;
            std::io::Write::write_all(&mut zip_writer, new_document_xml.as_bytes())
                .map_err(|e| PostProcessError::ZipWrite(e.to_string()))?;
        } else {
            // 原样复制其他文件
            let options = FileOptions::<()>::default()
                .compression_method(file.compression())
                .unix_permissions(0o644);
            zip_writer
                .start_file(&name, options)
                .map_err(|e| PostProcessError::ZipWrite(e.to_string()))?;
            std::io::copy(&mut file, &mut zip_writer)
                .map_err(|e| PostProcessError::ZipWrite(e.to_string()))?;
        }
    }

    zip_writer
        .finish()
        .map_err(|e| PostProcessError::ZipWrite(e.to_string()))?;

    Ok(output.into_inner())
}

// ─── 测试 ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use docx_rs::*;
    use std::io::Cursor;

    /// 创建一个包含占位文本的简单 DOCX
    fn create_docx_with_placeholder(placeholder: &str) -> Vec<u8> {
        let doc = Docx::new()
            .add_paragraph(Paragraph::new().add_run(Run::new().add_text("Before")))
            .add_paragraph(Paragraph::new().add_run(Run::new().add_text(placeholder)))
            .add_paragraph(Paragraph::new().add_run(Run::new().add_text("After")));
        let mut buf = Cursor::new(Vec::new());
        doc.build().pack(&mut buf).expect("pack docx");
        buf.into_inner()
    }

    #[test]
    fn inject_single_math_block() {
        let placeholder = "__MATH_BLOCK_0__";
        let docx_bytes = create_docx_with_placeholder(placeholder);
        let omml = "<m:oMathPara xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\"><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></m:oMathPara>";

        let result = inject_omml(&docx_bytes, &[(placeholder.to_string(), omml.to_string())]);
        assert!(result.is_ok(), "注入应成功: {:?}", result);

        let result_bytes = result.unwrap();
        let result_str = String::from_utf8_lossy(&result_bytes);

        // 占位文本应被替换
        assert!(!result_str.contains(placeholder), "占位文本应被替换");
        // OMML 内容应存在
        assert!(result_str.contains("<m:oMathPara"), "应包含 oMathPara");
        assert!(result_str.contains("<m:oMath>"), "应包含 oMath");
    }

    #[test]
    fn inject_preserves_other_content() {
        let placeholder = "__MATH_BLOCK_0__";
        let docx_bytes = create_docx_with_placeholder(placeholder);
        let omml = "<m:oMathPara xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\"><m:oMath><m:r><m:t>a</m:t></m:r></m:oMath></m:oMathPara>";

        let result = inject_omml(&docx_bytes, &[(placeholder.to_string(), omml.to_string())]);
        assert!(result.is_ok());

        let result_bytes = result.unwrap();
        let result_str = String::from_utf8_lossy(&result_bytes);

        // 前后内容应保留
        assert!(result_str.contains("Before"), "Before 内容应保留");
        assert!(result_str.contains("After"), "After 内容应保留");
    }

    #[test]
    fn inject_adds_namespace() {
        let placeholder = "__MATH_BLOCK_0__";
        let docx_bytes = create_docx_with_placeholder(placeholder);
        let omml = "<m:oMathPara xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\"><m:oMath/></m:oMathPara>";

        let result = inject_omml(&docx_bytes, &[(placeholder.to_string(), omml.to_string())]);
        assert!(result.is_ok());

        let result_bytes = result.unwrap();
        let result_str = String::from_utf8_lossy(&result_bytes);

        // OMML 命名空间应在 document 根元素
        assert!(
            result_str.contains("xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\""),
            "OMML 命名空间应存在"
        );
    }

    #[test]
    fn no_math_blocks_returns_unchanged() {
        let docx_bytes = create_docx_with_placeholder("normal text");
        let result = inject_omml(&docx_bytes, &[]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), docx_bytes);
    }

    #[test]
    fn inject_multiple_math_blocks() {
        let docx_bytes = create_docx_with_placeholder("__MATH_BLOCK_0__");
        let math_blocks = vec![
            ("__MATH_BLOCK_0__".to_string(), "<m:oMathPara xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\"><m:oMath><m:r><m:t>a</m:t></m:r></m:oMath></m:oMathPara>".to_string()),
            ("__MATH_BLOCK_1__".to_string(), "<m:oMathPara xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\"><m:oMath><m:r><m:t>b</m:t></m:r></m:oMath></m:oMathPara>".to_string()),
        ];

        let result = inject_omml(&docx_bytes, &math_blocks);
        assert!(result.is_ok());
    }
}
