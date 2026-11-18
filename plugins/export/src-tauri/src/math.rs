/**
 * LaTeX → MathML → OMML 转换器
 *
 * 将 LaTeX 数学公式转换为 Word 原生 OOXML oMath 格式，
 * 使导出的 DOCX 中公式可编辑且缩放无损。
 *
 * 路径：LaTeX → MathML（pulldown-latex）→ OMML（自研转换器）
 */

use pulldown_latex::config::{DisplayMode, RenderConfig};
use pulldown_latex::parser::{Parser, storage::Storage};
use quick_xml::events::Event;
use quick_xml::Reader;
use thiserror::Error;

// ─── 错误类型 ──────────────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum MathConvertError {
    #[error("LaTeX → MathML 转换失败: {0}")]
    LatexToMathml(String),
    #[error("MathML 解析失败: {0}")]
    MathmlParse(String),
    #[error("不支持的 MathML 元素: {0}")]
    UnsupportedElement(String),
    #[error("OMML 生成失败: {0}")]
    OmmlGeneration(String),
}

// ─── 公开接口 ──────────────────────────────────────────────────────────────

/// 将 LaTeX 源码转换为 OMML XML 字符串。
/// 返回完整的 `<m:oMathPara>...</m:oMathPara>` 段落。
pub fn latex_to_omml(latex: &str) -> Result<String, MathConvertError> {
    let mathml = latex_to_mathml(latex)?;
    mathml_to_omml(&mathml)
}

/// 将 LaTeX 源码转换为 MathML 字符串。
pub fn latex_to_mathml(latex: &str) -> Result<String, MathConvertError> {
    let storage = Storage::new();
    let parser = Parser::new(latex, &storage);
    let mut output = String::new();
    let config = RenderConfig {
        display_mode: DisplayMode::Block,
        xml: true, // 对 Word 兼容性重要
        ..Default::default()
    };
    pulldown_latex::push_mathml(&mut output, parser, config)
        .map_err(|e| MathConvertError::LatexToMathml(e.to_string()))?;
    Ok(output)
}

/// 将 MathML XML 字符串转换为 OMML XML 字符串。
pub fn mathml_to_omml(mathml: &str) -> Result<String, MathConvertError> {
    let mut reader = Reader::from_str(mathml);
    reader.config_mut().trim_text(true);

    // 先解析 MathML 为节点树，再递归转换为 OMML
    let nodes = parse_mathml_nodes(&mut reader)?;
    let omml_body = convert_nodes_to_omml(&nodes)?;

    // 包装为 oMathPara 段落
    Ok(format!(
        "<m:oMathPara xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\">\
         <m:oMath>{}</m:oMath></m:oMathPara>",
        omml_body
    ))
}

// ─── MathML 节点树 ──────────────────────────────────────────────────────────

/// 简化的 MathML 节点表示，用于中间处理
#[derive(Debug, Clone)]
enum MathNode {
    /// 元素节点：标签名、属性、子节点
    Element {
        tag: String,
        children: Vec<MathNode>,
    },
    /// 文本节点
    Text(String),
}

/// 从 quick-xml Reader 解析出 MathNode 列表
fn parse_mathml_nodes(reader: &mut Reader<&[u8]>) -> Result<Vec<MathNode>, MathConvertError> {
    let mut nodes = Vec::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let children = parse_children(reader, &tag)?;
                nodes.push(MathNode::Element { tag, children });
            }
            Ok(Event::Empty(e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                nodes.push(MathNode::Element {
                    tag,
                    children: Vec::new(),
                });
            }
            Ok(Event::Text(e)) => {
                let text = e.unescape().map_err(|e| {
                    MathConvertError::MathmlParse(format!("文本解码失败: {}", e))
                })?;
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    nodes.push(MathNode::Text(trimmed.to_string()));
                }
            }
            Ok(Event::End(_)) | Ok(Event::Eof) => break,
            Err(e) => {
                return Err(MathConvertError::MathmlParse(format!(
                    "XML 解析错误: {}",
                    e
                )));
            }
            _ => {}
        }
        buf.clear();
    }

    Ok(nodes)
}

/// 读取直到遇到指定标签的 End 事件，返回其间所有子节点
fn parse_children(reader: &mut Reader<&[u8]>, parent_tag: &str) -> Result<Vec<MathNode>, MathConvertError> {
    let mut children = Vec::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let sub_children = parse_children(reader, &tag)?;
                children.push(MathNode::Element {
                    tag,
                    children: sub_children,
                });
            }
            Ok(Event::Empty(e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                children.push(MathNode::Element {
                    tag,
                    children: Vec::new(),
                });
            }
            Ok(Event::Text(e)) => {
                let text = e.unescape().map_err(|e| {
                    MathConvertError::MathmlParse(format!("文本解码失败: {}", e))
                })?;
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    children.push(MathNode::Text(trimmed.to_string()));
                }
            }
            Ok(Event::End(e)) => {
                let end_tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if end_tag == parent_tag {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(MathConvertError::MathmlParse(format!(
                    "XML 解析错误: {}",
                    e
                )));
            }
            _ => {}
        }
        buf.clear();
    }

    Ok(children)
}

// ─── MathML → OMML 转换 ────────────────────────────────────────────────────

/// OMML 命名空间前缀
const M: &str = "m";

/// 将 MathNode 列表转换为 OMML XML 片段
fn convert_nodes_to_omml(nodes: &[MathNode]) -> Result<String, MathConvertError> {
    let mut output = String::new();
    for node in nodes {
        output.push_str(&convert_node_to_omml(node)?);
    }
    Ok(output)
}

/// 将单个 MathNode 转换为 OMML XML
fn convert_node_to_omml(node: &MathNode) -> Result<String, MathConvertError> {
    match node {
        MathNode::Text(text) => {
            // 纯文本包装为 OMML run
            Ok(make_math_run(text))
        }
        MathNode::Element { tag, children } => convert_element(tag, children),
    }
}

/// 将 MathML 元素转换为对应的 OMML
fn convert_element(tag: &str, children: &[MathNode]) -> Result<String, MathConvertError> {
    match tag {
        // 根元素 [itex] — 透传子节点（外层已包装 oMathPara）
        "math" => convert_nodes_to_omml(children),

        // mrow — 分组，透传子节点
        "mrow" => convert_nodes_to_omml(children),

        // mstyle — 样式容器，透传子节点
        "mstyle" => convert_nodes_to_omml(children),

        // mfrac — 分数 → <m:f>
        "mfrac" => convert_mfrac(children),

        // msup — 上标 → <m:sSup>
        "msup" => convert_msup(children),

        // msub — 下标 → <m:sSub>
        "msub" => convert_msub(children),

        // msubsup — 上下标 → <m:sSubSup>
        "msubsup" => convert_msubsup(children),

        // msqrt — 平方根 → <m:rad>（隐藏次数）
        "msqrt" => convert_msqrt(children),

        // mroot — n次根 → <m:rad>（显示次数）
        "mroot" => convert_mroot(children),

        // munder — 下限 → <m:limLow> 或 <m:groupChr>
        "munder" => convert_munder(children),

        // mover — 上限 → <m:limUpp> 或 <m:acc>
        "mover" => convert_mover(children),

        // munderover — 上下限 → <m:nary>（大型运算符）或组合
        "munderover" => convert_munderover(children),

        // mtable — 矩阵/表格 → <m:m>
        "mtable" => convert_mtable(children),

        // mtr — 表格行 → <m:mr>
        "mtr" => convert_mtr(children),

        // mtd — 表格单元格 → <m:e>
        "mtd" => convert_nodes_to_omml(children),

        // mi — 标识符（变量）→ <m:r>（单字符斜体）
        "mi" => convert_mi(children),

        // mn — 数字 → <m:r>
        "mn" => convert_mn(children),

        // mo — 运算符 → <m:r> 或 <m:nary>
        "mo" => convert_mo(children),

        // mtext — 文本 → <m:r>
        "mtext" => convert_mtext(children),

        // mspace — 空格 → <m:r>
        "mspace" => convert_mspace(children),

        // mfenced — 带分隔符的组 → 透传
        "mfenced" => convert_mfenced(children),

        // mpadded — 填充 → 透传
        "mpadded" => convert_nodes_to_omml(children),

        // mphantom — 不可见 → 透传
        "mphantom" => convert_nodes_to_omml(children),

        // menclose — 包围 → 透传（简化处理）
        "menclose" => convert_nodes_to_omml(children),

        // semantics / annotation — 透传子节点
        "semantics" => convert_nodes_to_omml(children),
        "annotation" => Ok(String::new()), // 忽略注释

        // 未知元素 — 尝试透传子节点作为降级
        _ => {
            // 对不认识的元素，透传其子节点以尽量保留内容
            convert_nodes_to_omml(children)
        }
    }
}

// ─── 具体元素转换函数 ──────────────────────────────────────────────────────

/// mfrac → <m:f>
fn convert_mfrac(children: &[MathNode]) -> Result<String, MathConvertError> {
    let (num, den) = match children.len() {
        0..=1 => {
            let num = convert_nodes_to_omml(children)?;
            return Ok(format!("<{M}:f><{M}:fPr/><{M}:num>{num}</{M}:num><{M}:den/></{M}:f>"));
        }
        _ => {
            let num = convert_node_to_omml(&children[0])?;
            let den = convert_node_to_omml(&children[1])?;
            (num, den)
        }
    };
    Ok(format!(
        "<{M}:f><{M}:fPr/><{M}:num>{num}</{M}:num><{M}:den>{den}</{M}:den></{M}:f>"
    ))
}

/// msup → <m:sSup>
fn convert_msup(children: &[MathNode]) -> Result<String, MathConvertError> {
    let (base, sup) = match children.len() {
        0..=1 => {
            let base = convert_nodes_to_omml(children)?;
            return Ok(format!("<{M}:sSup><{M}:sSupPr/><{M}:e>{base}</{M}:e><{M}:sup/></{M}:sSup>"));
        }
        _ => {
            let base = convert_node_to_omml(&children[0])?;
            let sup = convert_node_to_omml(&children[1])?;
            (base, sup)
        }
    };
    Ok(format!(
        "<{M}:sSup><{M}:sSupPr/><{M}:e>{base}</{M}:e><{M}:sup>{sup}</{M}:sup></{M}:sSup>"
    ))
}

/// msub → <m:sSub>
fn convert_msub(children: &[MathNode]) -> Result<String, MathConvertError> {
    let (base, sub) = match children.len() {
        0..=1 => {
            let base = convert_nodes_to_omml(children)?;
            return Ok(format!("<{M}:sSub><{M}:sSubPr/><{M}:e>{base}</{M}:e><{M}:sub/></{M}:sSub>"));
        }
        _ => {
            let base = convert_node_to_omml(&children[0])?;
            let sub = convert_node_to_omml(&children[1])?;
            (base, sub)
        }
    };
    Ok(format!(
        "<{M}:sSub><{M}:sSubPr/><{M}:e>{base}</{M}:e><{M}:sub>{sub}</{M}:sub></{M}:sSub>"
    ))
}

/// msubsup → <m:sSubSup>
fn convert_msubsup(children: &[MathNode]) -> Result<String, MathConvertError> {
    let (base, sub, sup) = match children.len() {
        0..=1 => {
            let base = convert_nodes_to_omml(children)?;
            return Ok(format!(
                "<{M}:sSubSup><{M}:sSubSupPr/><{M}:e>{base}</{M}:e><{M}:sub/><{M}:sup/></{M}:sSubSup>"
            ));
        }
        2 => {
            let base = convert_node_to_omml(&children[0])?;
            let sub = convert_node_to_omml(&children[1])?;
            (base, sub, String::new())
        }
        _ => {
            let base = convert_node_to_omml(&children[0])?;
            let sub = convert_node_to_omml(&children[1])?;
            let sup = convert_node_to_omml(&children[2])?;
            (base, sub, sup)
        }
    };
    Ok(format!(
        "<{M}:sSubSup><{M}:sSubSupPr/><{M}:e>{base}</{M}:e><{M}:sub>{sub}</{M}:sub><{M}:sup>{sup}</{M}:sup></{M}:sSubSup>"
    ))
}

/// msqrt → <m:rad>（隐藏次数，即平方根）
fn convert_msqrt(children: &[MathNode]) -> Result<String, MathConvertError> {
    let content = convert_nodes_to_omml(children)?;
    Ok(format!(
        "<{M}:rad><{M}:radPr><{M}:degHide {M}:val=\"1\"/></{M}:radPr>\
         <{M}:deg/><{M}:e>{content}</{M}:e></{M}:rad>"
    ))
}

/// mroot → <m:rad>（显示次数，即 n 次根）
fn convert_mroot(children: &[MathNode]) -> Result<String, MathConvertError> {
    let (content, deg) = match children.len() {
        0..=1 => {
            let content = convert_nodes_to_omml(children)?;
            (content, String::new())
        }
        _ => {
            // MathML mroot: 第一个子节点是内容，第二个是次数
            let content = convert_node_to_omml(&children[0])?;
            let deg = convert_node_to_omml(&children[1])?;
            (content, deg)
        }
    };
    Ok(format!(
        "<{M}:rad><{M}:radPr/><{M}:deg>{deg}</{M}:deg><{M}:e>{content}</{M}:e></{M}:rad>"
    ))
}

/// munder → <m:limLow> 或 <m:groupChr>
/// 判断依据：如果基座是大型运算符（∑, ∫ 等），用 limLow；否则用 groupChr
fn convert_munder(children: &[MathNode]) -> Result<String, MathConvertError> {
    let (base, under) = match children.len() {
        0..=1 => {
            let base = convert_nodes_to_omml(children)?;
            return Ok(format!("<{M}:limLow><{M}:limLowPr/><{M}:e>{base}</{M}:e><{M}:lim/></{M}:limLow>"));
        }
        _ => {
            let base = convert_node_to_omml(&children[0])?;
            let under = convert_node_to_omml(&children[1])?;
            (base, under)
        }
    };

    // 检查基座是否为大型运算符
    if is_nary_operator(&children[0]) {
        Ok(format!(
            "<{M}:nary><{M}:naryPr><{M}:chr {M}:val=\"\"/></{M}:naryPr>\
             <{M}:sub>{under}</{M}:sub><{M}:sup/><{M}:e>{base}</{M}:e></{M}:nary>"
        ))
    } else {
        Ok(format!(
            "<{M}:limLow><{M}:limLowPr/><{M}:e>{base}</{M}:e><{M}:lim>{under}</{M}:lim></{M}:limLow>"
        ))
    }
}

/// mover → <m:limUpp> 或 <m:acc>
fn convert_mover(children: &[MathNode]) -> Result<String, MathConvertError> {
    let (base, over) = match children.len() {
        0..=1 => {
            let base = convert_nodes_to_omml(children)?;
            return Ok(format!("<{M}:limUpp><{M}:limUppPr/><{M}:e>{base}</{M}:e><{M}:lim/></{M}:limUpp>"));
        }
        _ => {
            let base = convert_node_to_omml(&children[0])?;
            let over = convert_node_to_omml(&children[1])?;
            (base, over)
        }
    };

    // 检查上方是否为重音符号
    if is_accent(&children[1]) {
        let accent_char = extract_text_content(&children[1]);
        Ok(format!(
            "<{M}:acc><{M}:accPr><{M}:chr {M}:val=\"{accent_char}\"/></{M}:accPr>\
             <{M}:e>{base}</{M}:e></{M}:acc>"
        ))
    } else {
        Ok(format!(
            "<{M}:limUpp><{M}:limUppPr/><{M}:e>{base}</{M}:e><{M}:lim>{over}</{M}:lim></{M}:limUpp>"
        ))
    }
}

/// munderover → <m:nary>（大型运算符如 ∑, ∫）
fn convert_munderover(children: &[MathNode]) -> Result<String, MathConvertError> {
    let (base, under, over) = match children.len() {
        0..=1 => {
            let base = convert_nodes_to_omml(children)?;
            return Ok(format!(
                "<{M}:nary><{M}:naryPr/><{M}:sub/><{M}:sup/><{M}:e>{base}</{M}:e></{M}:nary>"
            ));
        }
        2 => {
            let base = convert_node_to_omml(&children[0])?;
            let under = convert_node_to_omml(&children[1])?;
            (base, under, String::new())
        }
        _ => {
            let base = convert_node_to_omml(&children[0])?;
            let under = convert_node_to_omml(&children[1])?;
            let over = convert_node_to_omml(&children[2])?;
            (base, under, over)
        }
    };

    // 提取运算符字符
    let op_char = extract_nary_char(&children[0]);

    Ok(format!(
        "<{M}:nary><{M}:naryPr><{M}:chr {M}:val=\"{op_char}\"/></{M}:naryPr>\
         <{M}:sub>{under}</{M}:sub><{M}:sup>{over}</{M}:sup>\
         <{M}:e/>{base}</{M}:nary>"
    ))
}

/// mtable → <m:m>
fn convert_mtable(children: &[MathNode]) -> Result<String, MathConvertError> {
    let mut rows = String::new();
    for child in children {
        rows.push_str(&convert_node_to_omml(child)?);
    }
    Ok(format!("<{M}:m>{rows}</{M}:m>"))
}

/// mtr → <m:mr>
fn convert_mtr(children: &[MathNode]) -> Result<String, MathConvertError> {
    let mut cells = String::new();
    for child in children {
        let cell_content = convert_node_to_omml(child)?;
        cells.push_str(&format!("<{M}:e>{cell_content}</{M}:e>"));
    }
    Ok(format!("<{M}:mr>{cells}</{M}:mr>"))
}

/// mi — 标识符（变量）
/// 单字符默认斜体，多字符默认正体
fn convert_mi(children: &[MathNode]) -> Result<String, MathConvertError> {
    let text = extract_text_content_from_nodes(children);
    let is_single_char = text.chars().count() == 1;
    if is_single_char {
        // 单字符变量：斜体（OMML 默认斜体，无需额外设置）
        Ok(make_math_run(&text))
    } else {
        // 多字符函数名：正体
        Ok(make_math_run_normal(&text))
    }
}

/// mn — 数字
fn convert_mn(children: &[MathNode]) -> Result<String, MathConvertError> {
    let text = extract_text_content_from_nodes(children);
    Ok(make_math_run(&text))
}

/// mo — 运算符
fn convert_mo(children: &[MathNode]) -> Result<String, MathConvertError> {
    let text = extract_text_content_from_nodes(children);
    Ok(make_math_run(&text))
}

/// mtext — 文本
fn convert_mtext(children: &[MathNode]) -> Result<String, MathConvertError> {
    let text = extract_text_content_from_nodes(children);
    Ok(make_math_run_normal(&text))
}

/// mspace — 空格
fn convert_mspace(_children: &[MathNode]) -> Result<String, MathConvertError> {
    Ok(make_math_run(" "))
}

/// mfenced — 带分隔符的组
/// 简化处理：透传子节点（分隔符由 Word 自动处理）
fn convert_mfenced(children: &[MathNode]) -> Result<String, MathConvertError> {
    let mut output = String::new();
    for (i, child) in children.iter().enumerate() {
        if i > 0 {
            output.push_str(&make_math_run(","));
        }
        output.push_str(&convert_node_to_omml(child)?);
    }
    Ok(output)
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────

/// 创建 OMML 数学 run（默认斜体）
fn make_math_run(text: &str) -> String {
    let escaped = xml_escape(text);
    format!("<{M}:r><{M}:t>{escaped}</{M}:t></{M}:r>")
}

/// 创建 OMML 数学 run（正体）
fn make_math_run_normal(text: &str) -> String {
    let escaped = xml_escape(text);
    format!("<{M}:r><{M}:rPr><{M}:sty {M}:val=\"p\"/></{M}:rPr><{M}:t>{escaped}</{M}:t></{M}:r>")
}

/// XML 特殊字符转义
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// 从节点列表中提取文本内容
fn extract_text_content_from_nodes(nodes: &[MathNode]) -> String {
    let mut text = String::new();
    for node in nodes {
        extract_text_recursive(node, &mut text);
    }
    text
}

fn extract_text_recursive(node: &MathNode, text: &mut String) {
    match node {
        MathNode::Text(t) => text.push_str(t),
        MathNode::Element { children, .. } => {
            for child in children {
                extract_text_recursive(child, text);
            }
        }
    }
}

/// 从单个节点提取文本内容
fn extract_text_content(node: &MathNode) -> String {
    let mut text = String::new();
    extract_text_recursive(node, &mut text);
    text
}

/// 判断节点是否为大型运算符（∑, ∫, ∏ 等）
fn is_nary_operator(node: &MathNode) -> bool {
    let text = extract_text_content(node);
    matches!(
        text.as_str(),
        "∑" | "∫" | "∏" | "∐" | "⋃" | "⋂" | "⋁" | "⋀" | "⨁" | "⨂"
    )
}

/// 判断节点是否为重音符号
fn is_accent(node: &MathNode) -> bool {
    let text = extract_text_content(node);
    matches!(
        text.as_str(),
        "^" | "~" | "ˆ" | "ˇ" | "¯" | "´" | "`" | "˙" | "¨"
            | "\u{302}" | "\u{303}" | "\u{304}" | "\u{307}" | "\u{308}"
            | "\u{2192}" | "\u{20D7}" | "\u{20D6}"
    )
}

/// 提取大型运算符字符
fn extract_nary_char(node: &MathNode) -> String {
    let text = extract_text_content(node);
    // 如果是已知的大型运算符，返回其字符
    if is_nary_operator(node) {
        return text;
    }
    // 否则返回空（Word 会使用默认的 ∑）
    String::new()
}

// ─── 测试 ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latex_to_mathml_fraction() {
        let result = latex_to_mathml(r"\frac{a}{b}").unwrap();
        assert!(result.contains("<mfrac"), "应包含 mfrac 元素: {result}");
        assert!(result.contains("<mi>a</mi>"), "应包含变量 a: {result}");
        assert!(result.contains("<mi>b</mi>"), "应包含变量 b: {result}");
    }

    #[test]
    fn latex_to_mathml_superscript() {
        let result = latex_to_mathml("x^{2}").unwrap();
        assert!(result.contains("<msup"), "应包含 msup 元素: {result}");
    }

    #[test]
    fn latex_to_mathml_sqrt() {
        let result = latex_to_mathml(r"\sqrt{x}").unwrap();
        assert!(result.contains("<msqrt"), "应包含 msqrt 元素: {result}");
    }

    #[test]
    fn mathml_to_omml_fraction() {
        let mathml = r#"<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>"#;
        let result = mathml_to_omml(mathml).unwrap();
        assert!(result.contains("<m:oMathPara"), "应包含 oMathPara: {result}");
        assert!(result.contains("<m:oMath>"), "应包含 oMath: {result}");
        assert!(result.contains("<m:f>"), "应包含 m:f (分数): {result}");
        assert!(result.contains("<m:num>"), "应包含 m:num (分子): {result}");
        assert!(result.contains("<m:den>"), "应包含 m:den (分母): {result}");
    }

    #[test]
    fn mathml_to_omml_superscript() {
        let mathml = r#"<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><msup><mi>x</mi><mn>2</mn></msup></math>"#;
        let result = mathml_to_omml(mathml).unwrap();
        assert!(result.contains("<m:sSup>"), "应包含 m:sSup (上标): {result}");
        assert!(result.contains("<m:e>"), "应包含 m:e (基座): {result}");
        assert!(result.contains("<m:sup>"), "应包含 m:sup (上标): {result}");
    }

    #[test]
    fn mathml_to_omml_sqrt() {
        let mathml = r#"<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><msqrt><mi>x</mi></msqrt></math>"#;
        let result = mathml_to_omml(mathml).unwrap();
        assert!(result.contains("<m:rad>"), "应包含 m:rad (根号): {result}");
        assert!(result.contains("<m:degHide"), "平方根应隐藏次数: {result}");
    }

    #[test]
    fn mathml_to_omml_nroot() {
        let mathml = r#"<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mroot><mi>x</mi><mn>3</mn></mroot></math>"#;
        let result = mathml_to_omml(mathml).unwrap();
        assert!(result.contains("<m:rad>"), "应包含 m:rad (根号): {result}");
        assert!(result.contains("<m:deg>"), "n次根应显示次数: {result}");
    }

    #[test]
    fn end_to_end_fraction() {
        let result = latex_to_omml(r"\frac{a}{b}").unwrap();
        assert!(result.contains("<m:oMathPara"), "完整公式应包含 oMathPara: {result}");
        assert!(result.contains("<m:f>"), "应包含分数: {result}");
    }

    #[test]
    fn end_to_end_superscript() {
        let result = latex_to_omml("x^{2}").unwrap();
        assert!(result.contains("<m:sSup>"), "应包含上标: {result}");
    }

    #[test]
    fn end_to_end_subscript() {
        let result = latex_to_omml("x_{i}").unwrap();
        assert!(result.contains("<m:sSub>"), "应包含下标: {result}");
    }

    #[test]
    fn end_to_end_sqrt() {
        let result = latex_to_omml(r"\sqrt{x}").unwrap();
        assert!(result.contains("<m:rad>"), "应包含根号: {result}");
    }

    #[test]
    fn end_to_end_greek_letters() {
        let result = latex_to_omml(r"\alpha + \beta").unwrap();
        assert!(result.contains("α"), "应包含希腊字母 α: {result}");
        assert!(result.contains("β"), "应包含希腊字母 β: {result}");
    }

    #[test]
    fn end_to_end_complex_formula() {
        // 复合公式：分数 + 上标
        let result = latex_to_omml(r"\frac{x^{2}+1}{2}").unwrap();
        assert!(result.contains("<m:f>"), "应包含分数: {result}");
        assert!(result.contains("<m:sSup>"), "应包含上标: {result}");
    }

    #[test]
    fn omml_namespace_present() {
        let result = latex_to_omml("a+b").unwrap();
        assert!(
            result.contains("xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\""),
            "OMML 命名空间必须存在: {result}"
        );
    }

    #[test]
    fn xml_escape_in_output() {
        // 测试 OMML 输出中特殊字符被正确转义
        let result = latex_to_omml("x+y").unwrap();
        // pulldown-latex 将 x, +, y 分别生成为独立的 MathML 元素
        assert!(result.contains("<m:t>x</m:t>"), "应包含 x: {result}");
        assert!(result.contains("<m:t>+</m:t>"), "应包含 +: {result}");
        assert!(result.contains("<m:t>y</m:t>"), "应包含 y: {result}");
    }
}
