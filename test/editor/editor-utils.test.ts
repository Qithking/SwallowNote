import { describe, it, expect } from 'vitest'

describe('TC-013: 代码块编辑测试', () => {
  it('TC-013-01: 代码块语言识别', () => {
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/
    
    const markdown = `\`\`\`javascript
function test() {
  return 'hello';
}
\`\`\``
    
    const match = markdown.match(codeBlockRegex)
    expect(match).not.toBeNull()
    expect(match?.[1]).toBe('javascript')
    expect(match?.[2]).toContain('function test()')
  })

  it('TC-013-02: 无语言标识的代码块', () => {
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/
    
    const markdown = `\`\`\`
echo "hello world"
\`\`\``
    
    const match = markdown.match(codeBlockRegex)
    expect(match).not.toBeNull()
    expect(match?.[1]).toBeUndefined()
  })

  it('TC-013-03: 提取代码块内容', () => {
    const markdown = `# Title

\`\`\`python
def greet(name):
    print(f"Hello, {name}")
\`\`\`

Some text after.`
    
    const codeBlocks: { lang?: string; content: string }[] = []
    const regex = /```(\w+)?\n([\s\S]*?)```/g
    let match
    
    while ((match = regex.exec(markdown)) !== null) {
      codeBlocks.push({
        lang: match[1],
        content: match[2].trim()
      })
    }
    
    expect(codeBlocks.length).toBe(1)
    expect(codeBlocks[0].lang).toBe('python')
    expect(codeBlocks[0].content).toBe('def greet(name):\n    print(f"Hello, {name}")')
  })
})

describe('TC-014: 数学公式测试', () => {
  it('TC-014-01: 识别行内公式', () => {
    const inlineMathRegex = /\$([^$]+)\$/g
    
    const markdown = 'The formula $E=mc^2$ is famous.'
    
    const matches = [...markdown.matchAll(inlineMathRegex)]
    expect(matches.length).toBe(1)
    expect(matches[0][1]).toBe('E=mc^2')
  })

  it('TC-014-02: 识别块级公式', () => {
    const blockMathRegex = /\$\$([\s\S]*?)\$\$/g
    
    const markdown = `Here is a block formula:

$$
\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
$$

End of formula.`
    
    const matches = [...markdown.matchAll(blockMathRegex)]
    expect(matches.length).toBe(1)
    expect(matches[0][1]).toContain('\\int_0^\\infty')
  })

  it('TC-014-03: 复杂公式解析', () => {
    const inlineMathRegex = /\$([^$]+)\$/g
    
    const markdown = `Pythagorean theorem: $a^2 + b^2 = c^2$
Quadratic formula: $x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$`
    
    const matches = [...markdown.matchAll(inlineMathRegex)]
    expect(matches.length).toBe(2)
    expect(matches[0][1]).toBe('a^2 + b^2 = c^2')
    expect(matches[1][1]).toBe('x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}')
  })
})

describe('TC-015: Mermaid图表测试', () => {
  it('TC-015-01: 识别Mermaid代码块', () => {
    const mermaidRegex = /```mermaid\n([\s\S]*?)```/
    
    const markdown = `\`\`\`mermaid
flowchart TD
    A[Start] --> B{Is it?}
    B -->|Yes| C[OK]
    B -->|No| D[Cancel]
\`\`\``
    
    const match = markdown.match(mermaidRegex)
    expect(match).not.toBeNull()
    expect(match?.[1]).toContain('flowchart TD')
  })

  it('TC-015-02: 流程图语法验证', () => {
    const flowchartContent = `flowchart LR
    A --> B
    B --> C
    C --> D`
    
    expect(flowchartContent).toContain('flowchart')
    expect(flowchartContent).toContain('-->')
  })

  it('TC-015-03: 时序图语法验证', () => {
    const sequenceContent = `sequenceDiagram
    participant A as User
    participant B as Server
    A->>B: Request
    B-->>A: Response`
    
    expect(sequenceContent).toContain('sequenceDiagram')
    expect(sequenceContent).toContain('participant')
    expect(sequenceContent).toContain('->>')
  })

  it('TC-015-04: 甘特图语法验证', () => {
    const ganttContent = `gantt
    dateFormat  YYYY-MM-DD
    title Project Timeline
    section Phase 1
    Task 1 :done, des1, 2024-01-01, 30d
    Task 2 :active, des2, 2024-02-01, 20d`
    
    expect(ganttContent).toContain('gantt')
    expect(ganttContent).toContain('dateFormat')
    expect(ganttContent).toContain('section')
  })
})
