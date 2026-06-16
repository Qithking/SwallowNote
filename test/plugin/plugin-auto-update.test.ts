/**
 * TC-C2-01: Plugin auto-update semver comparison (Phase 11.4 / C2)
 *
 * Regression for the fourth-round code-review C2 finding:
 * `isNewerVersion` in `src/lib/plugin-auto-update.ts` used to split
 * the version string on `[.\-+]` and lex-compare non-numeric
 * tokens, which mis-ordered pre-release builds.
 *
 *   1.0.0-beta.1 vs 1.0.0
 *     old:  "beta" > "0" lex-wise → returned `true` (wrong)
 *     new:  semver.gt("1.0.0-beta.1", "1.0.0") → `false` (right)
 *
 * The marketplace wire format *does* ship pre-release versions
 * (the in-tree `export` plugin uses plain `0.1.0` for now, but
 * the marketplace schema and the
 * dependency-resolver in `plugin-dependencies.ts` already accept
 * `-beta.N` / `-rc.N` suffixes), so a misfire could silently
 * downgrade an installed plugin to a pre-release.
 *
 * Cases covered:
 *   - equal versions → `false`
 *   - older remote vs newer local → `false`
 *   - newer remote vs older local → `true`
 *   - pre-release vs release (both directions)
 *   - pre-release ordinals
 *   - edge cases: empty inputs, whitespace, non-semver strings
 *     (the function must never throw and must default to `false`
 *     when no sane ordering can be derived)
 */
import { describe, it, expect } from 'vitest'
import { isNewerVersion } from '@/lib/plugin-auto-update'

// ─── TC-C2-01a: equal / older / newer baseline ───────────────────────────────

describe('TC-C2-01a: isNewerVersion baseline', () => {
  it('returns false for equal versions', () => {
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
  })

  it('returns false when remote is older than local (1.0.0 vs 1.0.1)', () => {
    // The reviewer-spec wording: "1.0.0 vs 1.0.1 → false (remote
    // not newer)". isNewerVersion(remote, local) where remote is
    // the *older* side, so the answer is `false`.
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(false)
  })

  it('returns true when remote is newer than local (1.0.1 vs 1.0.0)', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true)
  })
})

// ─── TC-C2-01b: pre-release handling (the actual bug) ───────────────────────

describe('TC-C2-01b: isNewerVersion pre-release handling', () => {
  it('treats 1.0.0-beta.1 as OLDER than 1.0.0 (the C2 regression case)', () => {
    // Old buggy code: split on [.\-+] produced tokens
    // ["1","0","0","beta","1"] vs ["1","0","0"]; the 4th token
    // comparison fell into the lex branch, where "beta" > "0",
    // so it returned `true`. semver.gt now correctly returns
    // `false` because a pre-release is lower than the matching
    // release.
    expect(isNewerVersion('1.0.0-beta.1', '1.0.0')).toBe(false)
  })

  it('treats 1.0.0 as NEWER than 1.0.0-beta.1 (symmetric case)', () => {
    expect(isNewerVersion('1.0.0', '1.0.0-beta.1')).toBe(true)
  })

  it('orders pre-release ordinals ascending (-beta.2 > -beta.1)', () => {
    expect(isNewerVersion('1.0.0-beta.2', '1.0.0-beta.1')).toBe(true)
  })

  it('orders pre-release ordinals descending (-beta.1 not > -beta.2)', () => {
    expect(isNewerVersion('1.0.0-beta.1', '1.0.0-beta.2')).toBe(false)
  })

  it('handles -rc.N pre-release tags the same way', () => {
    expect(isNewerVersion('1.0.0-rc.1', '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0.0', '1.0.0-rc.1')).toBe(true)
  })
})

// ─── TC-C2-01c: edge cases — must not throw, must default safely ─────────────

describe('TC-C2-01c: isNewerVersion edge cases', () => {
  it('returns false when either side is an empty string', () => {
    expect(isNewerVersion('', '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0.0', '')).toBe(false)
    expect(isNewerVersion('', '')).toBe(false)
  })

  it('returns false when either side is whitespace-only', () => {
    // The implementation trims inputs; a whitespace-only string
    // counts as "missing" and must not be allowed to trigger an
    // auto-update.
    expect(isNewerVersion('   ', '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0.0', '   ')).toBe(false)
  })

  it('does not throw on non-semver strings', () => {
    // The marketplace wire format has historically allowed loose
    // tags like "v1" or "latest". These don't parse as semver;
    // the function must fall back gracefully (lex compare → may
    // return `true` or `false` depending on the strings, but
    // importantly must not throw).
    expect(() => isNewerVersion('v1', 'v0')).not.toThrow()
    expect(() => isNewerVersion('latest', 'stable')).not.toThrow()
    expect(() => isNewerVersion('not-a-version', '1.0.0')).not.toThrow()
    expect(() => isNewerVersion('1.0.0', 'not-a-version')).not.toThrow()
  })

  it('tolerates leading "v" prefix on semver-valid bodies', () => {
    // node-semver accepts a leading "v"; we want our wrapper to
    // as well. This protects any future marketplace entry that
    // accidentally includes the "v" prefix.
    expect(isNewerVersion('v1.0.1', 'v1.0.0')).toBe(true)
    expect(isNewerVersion('v1.0.0', 'v1.0.0')).toBe(false)
  })

  it('handles versions with build metadata', () => {
    // Build metadata is ignored for precedence per the semver
    // spec — `1.0.0+build.1` and `1.0.0+build.2` are equal.
    expect(isNewerVersion('1.0.0+build.2', '1.0.0+build.1')).toBe(false)
    expect(isNewerVersion('1.0.0+build.2', '1.0.0-beta.1')).toBe(true)
  })
})
