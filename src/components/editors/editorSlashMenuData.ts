/**
 * 自定义 slash menu 的模板数据（纯数据，无逻辑）。
 * 从 MarkdownEditor.tsx 抽出。
 */

// Mermaid diagram templates
export const mermaidTemplates = [
  {
    title: 'Mermaid',
    subtext: 'Flowchart diagram',
    aliases: ['mermaid', 'diagram', 'chart', '图表', '流程图'],
    diagram: `graph TD\n    A[Start] --> B{Decision?}\n    B -->|Yes| C[OK]\n    B -->|No| D[Cancel]\n`,
  },
  {
    title: 'Mermaid Sequence',
    subtext: 'Sequence diagram',
    aliases: ['sequence', '时序图', 'sequenceDiagram'],
    diagram: `sequenceDiagram\n    participant Alice\n    participant Bob\n    Alice->>Bob: Hello Bob!\n    Bob-->>Alice: Hi Alice!\n`,
  },
  {
    title: 'Mermaid Gantt',
    subtext: 'Gantt chart',
    aliases: ['gantt', '甘特图', 'project', 'schedule'],
    diagram: `gantt
    title Project Schedule
    dateFormat YYYY-MM-DD
    axisFormat %m/%d
    section Phase 1
    Task 1 :a1, 2024-01-01, 7d
    Task 2 :after a1, 5d
    section Phase 2
    Task 3 :2024-01-15, 10d
`,
  },
  {
    title: 'Mermaid Class',
    subtext: 'Class diagram',
    aliases: ['class', '类图', 'classDiagram', 'oop'],
    diagram: `classDiagram\n    class Animal {\n        +String name\n        +makeSound()\n    }\n    class Dog {\n        +fetch()\n    }\n    Animal <|-- Dog\n`,
  },
  {
    title: 'Mermaid State',
    subtext: 'State diagram',
    aliases: ['state', '状态图', 'stateDiagram'],
    diagram: `stateDiagram-v2\n    [*] --> Idle\n    Idle --> Processing : submit\n    Processing --> Success : ok\n    Processing --> Error : fail\n    Success --> [*]\n    Error --> Idle : retry\n`,
  },
  {
    title: 'Mermaid ER',
    subtext: 'Entity relationship diagram',
    aliases: ['er', 'erDiagram', '实体关系图', 'database', 'db'],
    diagram: `erDiagram\n    USER ||--o{ ORDER : places\n    ORDER ||--|{ LINE-ITEM : contains\n    USER {\n        int id\n        string name\n    }\n`,
  },
  {
    title: 'Mermaid Pie',
    subtext: 'Pie chart',
    aliases: ['pie', '饼图', 'pieChart', 'percentage'],
    diagram: `pie title Distribution\n    "Category A" : 40\n    "Category B" : 30\n    "Category C" : 20\n    "Category D" : 10\n`,
  },
  {
    title: 'Mermaid Mindmap',
    subtext: 'Mind map',
    aliases: ['mindmap', '思维导图', 'brainstorm'],
    diagram: `mindmap\n  root((Topic))\n    Branch A\n      Leaf 1\n      Leaf 2\n    Branch B\n      Leaf 3\n      Leaf 4\n`,
  },
  {
    title: 'Mermaid Journey',
    subtext: 'User journey map',
    aliases: ['journey', '用户旅程图', 'userjourney'],
    diagram: `journey\n    title User Journey\n    section Discovery\n      Search for product: 5: Customer\n      Find product page: 4: Customer\n    section Purchase\n      Add to cart: 5: Customer\n      Checkout: 3: Customer\n`,
  },
  {
    title: 'Mermaid Timeline',
    subtext: 'Timeline diagram',
    aliases: ['timeline', '时间线', 'history'],
    diagram: `timeline\n    title History\n    section Period 1\n        2020 : Event A\n        2021 : Event B\n        2022 : Event C\n`,
  },
]

// KaTeX math formula templates
export const katexTemplates = [
  {
    title: 'Math (Block)',
    subtext: 'Block-level LaTeX formula',
    aliases: ['math', 'katex', 'latex', '公式', '数学', '块级公式', 'equation', 'formula'],
    formula: `E = mc^2`,
    display: true,
  },
  {
    title: 'Math (Inline)',
    subtext: 'Inline LaTeX formula',
    aliases: ['math-inline', 'katex-inline', 'latex-inline', '行内公式', 'inline math'],
    formula: `E = mc^2`,
    display: false,
  },
  {
    title: 'Math — Quadratic',
    subtext: 'Quadratic formula',
    aliases: ['quadratic', '一元二次方程', '求根公式'],
    formula: `x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}`,
    display: true,
  },
  {
    title: 'Math — Sum',
    subtext: 'Summation formula',
    aliases: ['sum', '求和', 'sigma'],
    formula: `\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}`,
    display: true,
  },
  {
    title: 'Math — Integral',
    subtext: 'Definite integral',
    aliases: ['integral', '积分', 'calculus'],
    formula: `\\int_{a}^{b} f(x)\\,dx = F(b) - F(a)`,
    display: true,
  },
  {
    title: 'Math — Matrix',
    subtext: '2x2 matrix',
    aliases: ['matrix', '矩阵', 'linear algebra'],
    formula: `A = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}`,
    display: true,
  },
]

// Markmap mindmap templates
export const markmapTemplates = [
  {
    title: 'Markmap',
    subtext: 'Project breakdown mindmap',
    aliases: ['markmap', 'mindmap', '思维导图', '脑图', 'project', 'plan'],
    diagram: `# Project Plan
## Planning
- Goals
- Timeline
- Resources
## Design
- Wireframes
- UI Design
- UX Review
## Development
- Backend
- Frontend
- Testing
## Launch
- Marketing
- Release
- Feedback
`,
  },
  {
    title: 'Markmap — Todo',
    subtext: 'Todo list mindmap',
    aliases: ['markmap-todo', 'todo', '待办', 'task', 'checklist'],
    diagram: `# Tasks
## Today
- [ ] High priority task
- [ ] Review pull requests
- [ ] Reply to emails
## This Week
- [ ] Finish feature A
- [ ] Write documentation
- [ ] Plan next sprint
## Backlog
- [ ] Refactor module B
- [ ] Explore new tech
`,
  },
  {
    title: 'Markmap — Study',
    subtext: 'Study plan mindmap',
    aliases: ['markmap-study', 'study', '学习', '学习计划', 'learn', 'notes'],
    diagram: `# Study Plan
## Foundations
### Concepts
### Principles
## Advanced
### Patterns
### Best Practices
## Practice
### Exercises
### Projects
## Resources
### Books
### Videos
### Articles
`,
  },
]
