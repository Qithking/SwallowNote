import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

/** 单行问询；def 有值时展示 [默认值] 并在空输入时采用 */
export async function ask(question: string, def?: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    const suffix = def ? ` [${def}]` : ''
    const answer = (await rl.question(`${question}${suffix}: `)).trim()
    return answer || def || ''
  } finally {
    rl.close()
  }
}

/** 是/否问询；空输入采用默认值 */
export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]'
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    const answer = (await rl.question(`${question} ${hint}: `)).trim().toLowerCase()
    if (!answer) return defaultYes
    return answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
}
