/**
 * 演示数据 - 让应用启动时即展示参考截图中的布局效果
 */
export const DEMO_ROOT_PATH = '__demo__'

export interface DemoFileNode {
  id: string
  name: string
  path: string
  isDirectory: boolean
  children?: DemoFileNode[]
}

export const demoFileTree: DemoFileNode = {
  id: 'root',
  name: 'demo-project',
  path: DEMO_ROOT_PATH,
  isDirectory: true,
  children: [
    { id: 'svn', name: 'svn', path: `${DEMO_ROOT_PATH}/svn`, isDirectory: true, children: [
      { id: 'svn-apache-activemq', name: 'apache-activemq', path: `${DEMO_ROOT_PATH}/svn/apache-activemq`, isDirectory: true },
      { id: 'svn-apache-tomcat', name: 'apache-tomcat', path: `${DEMO_ROOT_PATH}/svn/apache-tomcat`, isDirectory: true },
    ]},
    { id: 'clients', name: 'clients', path: `${DEMO_ROOT_PATH}/clients`, isDirectory: true },
    { id: 'cloud-app-cls-sh', name: 'cloud-app-cls-sh', path: `${DEMO_ROOT_PATH}/cloud-app-cls-sh`, isDirectory: true },
    { id: 'cloudedemo', name: 'cloudedemo', path: `${DEMO_ROOT_PATH}/cloudedemo`, isDirectory: true },
    { id: 'cnpm', name: 'cnpm', path: `${DEMO_ROOT_PATH}/cnpm`, isDirectory: true },
    { id: 'common', name: 'common', path: `${DEMO_ROOT_PATH}/common`, isDirectory: true },
    { id: 'model', name: 'model', path: `${DEMO_ROOT_PATH}/model`, isDirectory: true },
    { id: 'model-comps', name: 'model-comps', path: `${DEMO_ROOT_PATH}/model-comps`, isDirectory: true },
    { id: 'model-comps-unused', name: 'model-comps-unused', path: `${DEMO_ROOT_PATH}/model-comps-unused`, isDirectory: true },
    { id: 'model-edu', name: 'model-edu', path: `${DEMO_ROOT_PATH}/model-edu`, isDirectory: true },
    { id: 'model-newdao', name: 'model-newdao', path: `${DEMO_ROOT_PATH}/model-newdao`, isDirectory: true },
    { id: 'model-paas', name: 'model-paas', path: `${DEMO_ROOT_PATH}/model-paas`, isDirectory: true },
    { id: 'model-templates', name: 'model-templates', path: `${DEMO_ROOT_PATH}/model-templates`, isDirectory: true },
    { id: 'model-templates-unused', name: 'model-templates-unused', path: `${DEMO_ROOT_PATH}/model-templates-unused`, isDirectory: true },
    { id: 'pom', name: 'pom', path: `${DEMO_ROOT_PATH}/pom`, isDirectory: true },
    { id: 'pushServer', name: 'pushServer', path: `${DEMO_ROOT_PATH}/pushServer`, isDirectory: true },
    { id: 'readme', name: 'readme', path: `${DEMO_ROOT_PATH}/readme`, isDirectory: true },
    { id: 'tools', name: 'tools', path: `${DEMO_ROOT_PATH}/tools`, isDirectory: true },
    { id: 'tools-unused', name: 'tools-unused', path: `${DEMO_ROOT_PATH}/tools-unused`, isDirectory: true },
    { id: 'uix', name: 'uix', path: `${DEMO_ROOT_PATH}/uix`, isDirectory: true },
    { id: 'utils', name: 'utils', path: `${DEMO_ROOT_PATH}/utils`, isDirectory: true },
    { id: 'webide', name: 'webide', path: `${DEMO_ROOT_PATH}/webide`, isDirectory: true },
    { id: 'wex5Xdoc', name: 'wex5Xdoc', path: `${DEMO_ROOT_PATH}/wex5Xdoc`, isDirectory: true },
    { id: 'dev-guide', name: 'dev-guide', path: `${DEMO_ROOT_PATH}/dev-guide`, isDirectory: true },
    { id: 'paas-trunk', name: 'paas-trunk', path: `${DEMO_ROOT_PATH}/paas-trunk`, isDirectory: true },
    { id: 'gox5-tools', name: 'gox5-tools', path: `${DEMO_ROOT_PATH}/gox5-tools`, isDirectory: true },
    { id: 'opencart', name: 'opencart', path: `${DEMO_ROOT_PATH}/opencart`, isDirectory: true },
    { id: 'markdown-demo', name: 'markdown.md', path: `${DEMO_ROOT_PATH}/markdown.md`, isDirectory: false },
  ],
}

export const demoContent = `# Approach A: Structure-based Coordinates
(Preferred)

Use this when extract_form_structure.py found text labels in the PDF.

## A.1: Analyze the Structure

Read form_structure.json and identify:
1. Label groups: Adjacent text elements that form a single label (e.g., "Last" + "Name")
2. Row structure: Labels with similar top values are in the same row
3. Field columns: Entry areas start after label ends (x0 = label.x1 + gap)
4. Checkboxes: Use the checkbox coordinates directly from the structure

Coordinate system: PDF coordinates where y=0 is at TOP of page, y increases downward.

## A.2: Check for Missing Elements

The structure extraction may not detect all form elements. Common cases:
• Circular checkboxes: Only square rectangles are detected as checkboxes
• Complex graphics: Decorative elements or non-standard form controls
• Faded or light-colored elements: May not be extracted
`

export const demoDirtyContent = `# Draft Notes
Work in progress...

## Ideas
- Improve performance of file scanning
- Add syntax highlighting for more languages
- Implement search across nested directories

## TODO
- [ ] Refactor API module
- [ ] Add unit tests
- [ ] Update documentation

> Note: This file has unsaved changes.
`
