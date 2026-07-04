/**
 * 密码强度校验工具。
 *
 * 规则（spec）：
 * - 最少 8 个字符，最多 256 个字符
 * - 至少包含一个字母（a-z, A-Z）
 * - 至少包含一个数字（0-9）
 * - 不满足全部条件时禁止提交
 *
 * 强度等级：
 * - weak：仅满足最小长度（8-11 字符，仅字母或仅数字）
 * - medium：满足最小长度 + 字母 + 数字（≥12 字符）
 * - strong：满足最小长度 + 字母 + 数字 + 特殊字符（≥12 字符），或 ≥16 字符任意组合
 */

/** 密码长度限制。 */
export const PASSWORD_MIN_LEN = 8
export const PASSWORD_MAX_LEN = 256

/** 校验结果：包含是否通过、错误信息、强度等级。 */
export interface PasswordValidation {
  /** 是否满足最低提交要求（长度 + 字母 + 数字）。 */
  valid: boolean
  /** 错误信息（valid=false 时有值）。 */
  error?: string
  /** 强度等级（valid=true 时有值）。 */
  strength?: PasswordStrength
}

type PasswordStrength = 'weak' | 'medium' | 'strong'

/** 特殊字符正则：非字母非数字的可打印字符。 */
const SPECIAL_CHAR_RE = /[^a-zA-Z0-9\s]/

/** 校验密码并返回详细结果。 */
export function validatePassword(password: string): PasswordValidation {
  const len = password.length

  // 长度校验
  if (len < PASSWORD_MIN_LEN) {
    return { valid: false, error: `密码长度不能少于 ${PASSWORD_MIN_LEN} 个字符` }
  }
  if (len > PASSWORD_MAX_LEN) {
    return { valid: false, error: `密码长度不能超过 ${PASSWORD_MAX_LEN} 个字符` }
  }

  // 字符类型校验
  const hasLetter = /[a-zA-Z]/.test(password)
  const hasDigit = /[0-9]/.test(password)
  if (!hasLetter || !hasDigit) {
    return {
      valid: false,
      error: '密码必须同时包含字母和数字',
      strength: 'weak',
    }
  }

  // 强度评级
  const hasSpecial = SPECIAL_CHAR_RE.test(password)
  let strength: PasswordStrength
  if (len >= 16 || (len >= 12 && hasLetter && hasDigit && hasSpecial)) {
    strength = 'strong'
  } else if (len >= 12 && hasLetter && hasDigit) {
    strength = 'medium'
  } else {
    strength = 'weak'
  }

  return { valid: true, strength }
}

/** 强度等级对应的中文标签。 */
export function strengthLabel(strength: PasswordStrength): string {
  switch (strength) {
    case 'weak':
      return '弱'
    case 'medium':
      return '中'
    case 'strong':
      return '强'
  }
}

/** 强度等级对应的颜色（用于指示器）。 */
export function strengthColor(strength: PasswordStrength): string {
  switch (strength) {
    case 'weak':
      return '#ef4444' // 红色
    case 'medium':
      return '#f59e0b' // 橙色
    case 'strong':
      return '#22c55e' // 绿色
  }
}
