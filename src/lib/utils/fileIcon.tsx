import React from 'react'
import { File, FileText, Image, FileCode, FileType, Braces, Palette, FileCode2, Terminal, Database, GitBranch, Settings, FileArchive, Video, Music, FileBadge, Lock } from 'lucide-react'

export function getFileIcon(name: string, size: number = 12): React.ReactNode {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const lowerName = name.toLowerCase()

  const iconMap: Record<string, { icon: React.ElementType; color: string }> = {
    md: { icon: FileText, color: '#519aba' },
    png: { icon: Image, color: '#a074c4' },
    jpg: { icon: Image, color: '#a074c4' },
    jpeg: { icon: Image, color: '#a074c4' },
    gif: { icon: Image, color: '#a074c4' },
    svg: { icon: Image, color: '#a074c4' },
    webp: { icon: Image, color: '#a074c4' },
    ico: { icon: Image, color: '#a074c4' },
    bmp: { icon: Image, color: '#a074c4' },
    js: { icon: FileCode, color: '#cbcb41' },
    jsx: { icon: FileCode, color: '#cbcb41' },
    mjs: { icon: FileCode, color: '#cbcb41' },
    cjs: { icon: FileCode, color: '#cbcb41' },
    ts: { icon: FileType, color: '#519aba' },
    tsx: { icon: FileType, color: '#519aba' },
    mts: { icon: FileType, color: '#519aba' },
    cts: { icon: FileType, color: '#519aba' },
    json: { icon: Braces, color: '#cbcb41' },
    jsonc: { icon: Braces, color: '#cbcb41' },
    css: { icon: Palette, color: '#519aba' },
    scss: { icon: Palette, color: '#519aba' },
    sass: { icon: Palette, color: '#519aba' },
    less: { icon: Palette, color: '#519aba' },
    styl: { icon: Palette, color: '#519aba' },
    html: { icon: FileCode2, color: '#e37933' },
    htm: { icon: FileCode2, color: '#e37933' },
    py: { icon: FileType, color: '#519aba' },
    pyw: { icon: FileType, color: '#519aba' },
    rs: { icon: FileType, color: '#dea584' },
    java: { icon: FileType, color: '#ea2d20' },
    class: { icon: FileType, color: '#ea2d20' },
    c: { icon: FileType, color: '#519aba' },
    cpp: { icon: FileType, color: '#519aba' },
    h: { icon: FileType, color: '#519aba' },
    hpp: { icon: FileType, color: '#519aba' },
    cc: { icon: FileType, color: '#519aba' },
    go: { icon: FileType, color: '#519aba' },
    sh: { icon: Terminal, color: '#89e051' },
    bash: { icon: Terminal, color: '#89e051' },
    zsh: { icon: Terminal, color: '#89e051' },
    fish: { icon: Terminal, color: '#89e051' },
    yaml: { icon: FileText, color: '#cbcb41' },
    yml: { icon: FileText, color: '#cbcb41' },
    xml: { icon: FileCode2, color: '#e37933' },
    sql: { icon: Database, color: '#e37933' },
    toml: { icon: Settings, color: '#cbcb41' },
    ini: { icon: Settings, color: '#cbcb41' },
    cfg: { icon: Settings, color: '#cbcb41' },
    conf: { icon: Settings, color: '#cbcb41' },
    zip: { icon: FileArchive, color: '#cbcb41' },
    tar: { icon: FileArchive, color: '#cbcb41' },
    gz: { icon: FileArchive, color: '#cbcb41' },
    rar: { icon: FileArchive, color: '#cbcb41' },
    '7z': { icon: FileArchive, color: '#cbcb41' },
    bz2: { icon: FileArchive, color: '#cbcb41' },
    mp4: { icon: Video, color: '#a074c4' },
    avi: { icon: Video, color: '#a074c4' },
    mov: { icon: Video, color: '#a074c4' },
    mkv: { icon: Video, color: '#a074c4' },
    webm: { icon: Video, color: '#a074c4' },
    mp3: { icon: Music, color: '#a074c4' },
    wav: { icon: Music, color: '#a074c4' },
    flac: { icon: Music, color: '#a074c4' },
    aac: { icon: Music, color: '#a074c4' },
    ogg: { icon: Music, color: '#a074c4' },
    pdf: { icon: FileBadge, color: '#ea2d20' },
    ttf: { icon: FileType, color: '#a074c4' },
    otf: { icon: FileType, color: '#a074c4' },
    woff: { icon: FileType, color: '#a074c4' },
    woff2: { icon: FileType, color: '#a074c4' },
    lock: { icon: Lock, color: '#cbcb41' },
    lockb: { icon: Lock, color: '#cbcb41' },
    // Additional language icons
    swift: { icon: FileType, color: '#ea2d20' },
    kt: { icon: FileType, color: '#a97bff' },
    kts: { icon: FileType, color: '#a97bff' },
    scala: { icon: FileType, color: '#de3423' },
    rb: { icon: FileType, color: '#ea2d20' },
    php: { icon: FileCode, color: '#a074c4' },
    cs: { icon: FileType, color: '#519aba' },
    dart: { icon: FileType, color: '#519aba' },
    lua: { icon: FileCode, color: '#519aba' },
    pl: { icon: FileCode, color: '#519aba' },
    pm: { icon: FileCode, color: '#519aba' },
    r: { icon: FileCode, color: '#519aba' },
    ex: { icon: FileType, color: '#6e4a7e' },
    exs: { icon: FileType, color: '#6e4a7e' },
    erl: { icon: FileCode, color: '#a074c4' },
    hs: { icon: FileCode, color: '#519aba' },
    clj: { icon: FileCode, color: '#4cb478' },
    jl: { icon: FileCode, color: '#9558b2' },
    vue: { icon: FileCode2, color: '#42b883' },
    svelte: { icon: FileCode2, color: '#ff3e00' },
    proto: { icon: FileCode, color: '#519aba' },
    graphql: { icon: Database, color: '#e535ab' },
    gql: { icon: Database, color: '#e535ab' },
    dockerfile: { icon: Settings, color: '#519aba' },
    cmake: { icon: Settings, color: '#519aba' },
    ps1: { icon: Terminal, color: '#519aba' },
    m: { icon: FileType, color: '#519aba' },
    mm: { icon: FileType, color: '#519aba' },
    fs: { icon: FileType, color: '#519aba' },
    ml: { icon: FileCode, color: '#519aba' },
    diff: { icon: FileText, color: '#519aba' },
    patch: { icon: FileText, color: '#519aba' },
    smm: { icon: GitBranch, color: '#a97bff' },
  }

  const specialFiles: Record<string, { icon: React.ElementType; color: string }> = {
    '.gitignore': { icon: GitBranch, color: '#cbcb41' },
    '.gitattributes': { icon: GitBranch, color: '#cbcb41' },
    '.gitmodules': { icon: GitBranch, color: '#cbcb41' },
    '.env': { icon: Settings, color: '#e37933' },
    '.env.local': { icon: Settings, color: '#e37933' },
    '.env.example': { icon: Settings, color: '#e37933' },
  }

  const special = specialFiles[lowerName]
  if (special) {
    const Icon = special.icon
    return <Icon size={size} style={{ color: special.color }} />
  }

  const mapping = iconMap[ext]
  if (mapping) {
    const Icon = mapping.icon
    return <Icon size={size} style={{ color: mapping.color }} />
  }

  return <File size={size} style={{ color: '#969696' }} />
}
