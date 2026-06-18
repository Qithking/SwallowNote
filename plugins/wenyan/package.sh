#!/bin/bash
# Package the wenyan plugin into a zip that can be installed in SwallowNote.
#
# The zip file is named after the plugin id (com.swallownote.wenyan.zip)
# and contains:
#   - index.js          (ES module bundle built by Vite)
#   - manifest.json     (plugin metadata)
#   - settings.json     (plugin settings schema)
#   - backend/          (Rust binary for 公众号 push)
#     └── plugin_com.swallownote.wenyan
#
# This script can also bump the plugin's version number and stamp
# the current build timestamp before packaging. The single source of
# truth for the version is `manifest.json`; the script propagates the
# new value to:
#   - dist/manifest.json   (carried inside the zip)
#   - src/index.tsx        (the runtime plugin definition)
#   - src-tauri/Cargo.toml (backend crate version, kept in sync)
#   - package.json         (npm package version)
# and mirrors the same `version` + `publishedAt` into
# `plugins/repo.json` (the marketplace index) so the installed-plugin
# tab's "Update available" badge clears.
#
# Bump policy (default: patch):
#   --bump patch   0.1.0 → 0.1.1  (default, safe for fixes)
#   --bump minor   0.1.0 → 0.2.0
#   --bump major   0.1.0 → 1.0.0
#   --bump none    do not change the version (use the current value)
#   --version X.Y.Z  pin the new version explicitly
#
#   --no-bump     alias for --bump none (kept for back-compat)
#
# Pass `--skip-repo` to skip the plugins/repo.json sync (e.g. for
# local-only rebuilds where the marketplace index is managed out of
# band).
#
# Usage: ./package.sh [debug|release] [--bump <level>|--no-bump|--version X.Y.Z] [--skip-repo]
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE=""
BUMP="patch"
SKIP_REPO=0
PIN_VERSION=""

# First positional arg is the cargo profile (debug|release); every
# other arg is a flag. This keeps the CLI forgiving — you can pass
# the build mode either first or last.
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    debug|release)
      MODE="$arg"
      ;;
    --skip-repo)
      SKIP_REPO=1
      ;;
    --no-bump)
      BUMP="none"
      ;;
    --bump)
      # Consume the *next* arg as the bump level.
      BUMP="__NEEDS_VALUE__"
      ;;
    --bump=*)
      BUMP="${arg#--bump=}"
      ;;
    --version)
      PIN_VERSION="__NEEDS_VALUE__"
      ;;
    --version=*)
      PIN_VERSION="${arg#--version=}"
      ;;
    *)
      # `--bump <level>` style: fill in the pending value.
      if [ "$BUMP" = "__NEEDS_VALUE__" ]; then
        BUMP="$arg"
      elif [ "$PIN_VERSION" = "__NEEDS_VALUE__" ]; then
        PIN_VERSION="$arg"
      else
        POSITIONAL+=("$arg")
      fi
      ;;
  esac
done

# Default to debug builds (faster iteration); the CI release flow
# passes `release` as the first positional.
if [ -z "$MODE" ]; then
  if [ ${#POSITIONAL[@]} -gt 0 ] && { [ "${POSITIONAL[0]}" = "debug" ] || [ "${POSITIONAL[0]}" = "release" ]; }; then
    MODE="${POSITIONAL[0]}"
  else
    MODE="debug"
  fi
fi

# Validate bump level up front so we fail fast with a friendly
# message rather than a confusing semver error mid-build.
case "$BUMP" in
  patch|minor|major|none) ;;
  __NEEDS_VALUE__)
    echo "✗ --bump requires a value (patch|minor|major|none)" >&2
    exit 1
    ;;
  *)
    echo "✗ Unknown --bump level: $BUMP (expected patch|minor|major|none)" >&2
    exit 1
    ;;
esac

if [ "$PIN_VERSION" = "__NEEDS_VALUE__" ]; then
  echo "✗ --version requires a value (X.Y.Z)" >&2
  exit 1
fi

# `--version X.Y.Z` implies `--bump none` — the caller picked the
# final value themselves. We still validate the shape so a typo
# doesn't silently write a bogus version into manifest.json.
if [ -n "$PIN_VERSION" ]; then
  if ! [[ "$PIN_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.+][0-9A-Za-z.-]+)?$ ]]; then
    echo "✗ --version '$PIN_VERSION' is not a valid semver" >&2
    exit 1
  fi
  BUMP="none"
fi

PLUGIN_ID="com.swallownote.wenyan"
DIST_DIR="$SCRIPT_DIR/dist"
REPO_JSON="$SCRIPT_DIR/../repo.json"
MANIFEST="$SCRIPT_DIR/manifest.json"
SRC_INDEX="$SCRIPT_DIR/src/index.tsx"
CARGO_TOML="$SCRIPT_DIR/src-tauri/Cargo.toml"
PKG_JSON="$SCRIPT_DIR/package.json"
SETTINGS="$SCRIPT_DIR/settings.json"

# ─── Bump version (pre-build) ─────────────────────────────────────────────────
# We do the version bump *before* `vite build` so the new value is
# baked into the bundled `index.js` (the bundler embeds the
# `definePlugin(...)` literal string at build time). Reading the
# post-bump value later — inside the `vite build` step — would mean
# the zip ships the old number.
OLD_VERSION=$(python3 -c "import json; print(json.load(open('$MANIFEST'))['version'])" 2>/dev/null || echo "0.0.0")
# Generate the build timestamp once and reuse it for the manifest,
# the zip's `publishedAt`, and the marketplace `published_at`.
# Importing the whole `datetime` module would shadow the `datetime`
# class inside its own namespace on some Python versions, so we go
# through the `datetime` package directly via a one-liner.
PUBLISHED_AT=$(python3 -c "from datetime import datetime, timezone; print(datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))")

if [ -n "$PIN_VERSION" ]; then
  NEW_VERSION="$PIN_VERSION"
elif [ "$BUMP" = "none" ]; then
  NEW_VERSION="$OLD_VERSION"
else
  NEW_VERSION=$(python3 - "$OLD_VERSION" "$BUMP" <<'PY'
import sys
from semver import VersionInfo
old, level = sys.argv[1], sys.argv[2]
v = VersionInfo.parse(old)
if level == "patch":
    print(str(v.bump_patch()))
elif level == "minor":
    print(str(v.bump_minor()))
elif level == "major":
    print(str(v.bump_major()))
PY
  ) || {
    echo "✗ Failed to bump version '$OLD_VERSION' with --bump $BUMP" >&2
    echo "  (Requires the 'semver' PyPI package: pip install semver)" >&2
    exit 1
  }
fi

# Short-circuit when nothing changed so we don't churn timestamps on
# every rebuild.
VERSION_CHANGED=0
if [ "$NEW_VERSION" != "$OLD_VERSION" ]; then
  VERSION_CHANGED=1
  echo "==> Bumping version: $OLD_VERSION → $NEW_VERSION ($BUMP)"
  # manifest.json — canonical source. We rewrite the file in-place
  # so the bump survives subsequent runs of this script.
  python3 - "$MANIFEST" "$NEW_VERSION" "$PUBLISHED_AT" <<'PY'
import json, sys
path, version, published_at = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, 'r', encoding='utf-8') as f:
    m = json.load(f)
m['version'] = version
m['publishedAt'] = published_at
with open(path, 'w', encoding='utf-8') as f:
    json.dump(m, f, ensure_ascii=False, indent=2)
    f.write('\n')
PY

  # src/index.tsx — `version: 'X.Y.Z'` literal inside the
  # `definePlugin({ ... })` call. We use a regex so we don't have
  # to parse TypeScript with a real parser.
  python3 - "$SRC_INDEX" "$OLD_VERSION" "$NEW_VERSION" <<'PY'
import re, sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()
pattern = re.compile(r"(version:\s*['\"])" + re.escape(old) + r"(['\"])")
new_src, n = pattern.subn(r"\g<1>" + new + r"\g<2>", src, count=1)
if n == 0:
    print(f"  ⚠ could not find version literal '{old}' in {path} — leaving as-is", file=sys.stderr)
else:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_src)
PY

  # src-tauri/Cargo.toml — keep the crate version aligned so
  # `cargo build` doesn't print a "newer version available" warning
  # and so the embedded binary's `version` matches the manifest.
  python3 - "$CARGO_TOML" "$OLD_VERSION" "$NEW_VERSION" <<'PY'
import re, sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()
# Only the [package] version line — leave any dependency versions
# alone (we only sync our own crate's version).
pattern = re.compile(r"(?m)^(version\s*=\s*['\"])" + re.escape(old) + r"(['\"])")
new_src, n = pattern.subn(r"\g<1>" + new + r"\g<2>", src, count=1)
if n == 0:
    print(f"  ⚠ could not find crate version '{old}' in {path} — leaving as-is", file=sys.stderr)
else:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_src)
PY

  # package.json — keep npm's view of the version aligned. We avoid
  # `npm version` because it shells out and mutates package-lock
  # too, which is overkill for a sibling version sync.
  python3 - "$PKG_JSON" "$NEW_VERSION" <<'PY'
import json, sys
path, version = sys.argv[1], sys.argv[2]
with open(path, 'r', encoding='utf-8') as f:
    p = json.load(f)
p['version'] = version
with open(path, 'w', encoding='utf-8') as f:
    json.dump(p, f, ensure_ascii=False, indent=2)
    f.write('\n')
PY
fi

# Always refresh the `publishedAt` in manifest.json so the zip
# reflects when it was actually built, even on a no-bump rebuild.
# (Manifests created by hand may carry a stale date otherwise.)
if [ "$VERSION_CHANGED" = "0" ]; then
  echo "==> Refreshing publishedAt (version unchanged at $OLD_VERSION)"
  python3 - "$MANIFEST" "$PUBLISHED_AT" <<'PY'
import json, sys
path, published_at = sys.argv[1], sys.argv[2]
with open(path, 'r', encoding='utf-8') as f:
    m = json.load(f)
m['publishedAt'] = published_at
with open(path, 'w', encoding='utf-8') as f:
    json.dump(m, f, ensure_ascii=False, indent=2)
    f.write('\n')
PY
fi

echo "==> Building frontend (Vite ES module bundle)..."
cd "$SCRIPT_DIR"
npx vite build

echo "==> Building backend (Rust binary)..."
cd "$SCRIPT_DIR"
if [ "$MODE" = "release" ]; then
  cargo build --release --manifest-path "$SCRIPT_DIR/src-tauri/Cargo.toml"
  BIN_PATH="$SCRIPT_DIR/src-tauri/target/release/plugin_com_swallownote_wenyan"
else
  cargo build --manifest-path "$SCRIPT_DIR/src-tauri/Cargo.toml"
  BIN_PATH="$SCRIPT_DIR/src-tauri/target/debug/plugin_com_swallownote_wenyan"
fi

# Copy backend binary into dist/backend/ with the expected name
mkdir -p "$DIST_DIR/backend"
cp "$BIN_PATH" "$DIST_DIR/backend/plugin_$PLUGIN_ID"
chmod +x "$DIST_DIR/backend/plugin_$PLUGIN_ID"

# Make sure the manifest + settings that ship inside the zip match
# the post-bump values we just wrote. `vite build` doesn't touch
# these files directly — we copy them from source so the published
# artifact is internally consistent.
cp "$MANIFEST" "$DIST_DIR/manifest.json"
cp "$SETTINGS" "$DIST_DIR/settings.json"

echo "==> Creating zip package..."
# Re-read version from dist/manifest.json (post-build, guaranteed up-to-date)
cd "$DIST_DIR"
ZIP_NAME="${PLUGIN_ID}.zip"
rm -f "$SCRIPT_DIR/$PLUGIN_ID"*.zip

# Deterministic zip: pin the mtime of every file we are about to
# archive to a fixed epoch, then use `zip -X` to strip extra
# attributes (uid / gid / atime / extended timestamps) from the
# local file headers. Without this, two consecutive `vite build`
# + `cargo build` runs produce zips with different SHA-256 even
# though the *contents* are byte-identical — the host's plugin
# installer compares the on-the-wire zip hash against the value
# declared in `plugins/repo.json`, and a non-deterministic
# build means we have to bump `repo.json`'s `sha256` on every
# rebuild, even when no code changed.
#
# We touch the directory entries too (`dist/backend/`, `dist/`)
# because `zip` records the directory's mtime in the central
# directory and that field is *not* stripped by `-X` — leaving
# it alone would still leak the current system clock into the
# final hash.
touch -d '2020-01-01T00:00:00Z' \
  "$DIST_DIR/index.js" \
  "$DIST_DIR/manifest.json" \
  "$DIST_DIR/settings.json" \
  "$DIST_DIR/backend/plugin_$PLUGIN_ID" \
  "$DIST_DIR" \
  "$DIST_DIR/backend"
zip -X -r "$SCRIPT_DIR/$ZIP_NAME" index.js manifest.json settings.json backend/ > /dev/null

echo ""
echo "✓ Plugin package created: $SCRIPT_DIR/$ZIP_NAME"
echo "  Contents:"
zipinfo -1 "$SCRIPT_DIR/$ZIP_NAME"
echo ""
echo "  version:       $NEW_VERSION"
echo "  published_at:  $PUBLISHED_AT"

# ─── Sync plugins/repo.json ──────────────────────────────────────────────────
# Mirror the freshly-built artifact into the marketplace index so the
# installed-plugin tab's "Update available" badge clears and the
# plugin entry's version / published_at / sha256 line up with the
# actual bytes we just published. This step is best-effort: if
# `repo.json` is missing or malformed we warn and continue (the zip
# is still usable for a manual drag-and-drop install).
if [ "$SKIP_REPO" = "1" ]; then
  echo ""
  echo "→ Skipping repo.json sync (--skip-repo)"
elif [ ! -f "$REPO_JSON" ]; then
  echo ""
  echo "⚠ plugins/repo.json not found at $REPO_JSON — skipping index sync"
  echo "  The zip is ready; update the marketplace index manually."
else
  echo ""
  echo "==> Syncing plugins/repo.json..."
  SHA256=$(shasum -a 256 "$SCRIPT_DIR/$ZIP_NAME" | awk '{print $1}')
  python3 - "$REPO_JSON" "$PLUGIN_ID" "$SHA256" "$NEW_VERSION" "$PUBLISHED_AT" <<'PY'
import json
import sys
import datetime as _dt

repo_path, plugin_id, sha256, version, published_at = sys.argv[1:6]

with open(repo_path, 'r', encoding='utf-8') as f:
    repo = json.load(f)

updated = False
for plugin in repo.get('plugins', []):
    if plugin.get('id') != plugin_id:
        continue
    plugin['version'] = version
    plugin['sha256'] = sha256
    if plugin.get('download_url'):
        plugin['download_url'] = plugin['download_url']
    # The marketplace only ships the *latest* version on disk, so
    # we drop any per-version history here. The `versions` field
    # stays optional in the wire format — older indexes that still
    # carry it continue to parse — but fresh publishes omit it
    # entirely. The latest version's changelog / publishedAt is
    # flattened onto the top-level entry so the UI doesn't have
    # to dig into a per-row record for the only artifact that
    # exists.
    plugin.pop('versions', None)
    plugin['published_at'] = published_at
    # Preserve any existing top-level changelog; if the prior
    # `versions[0]` carried one and the top-level field is empty,
    # carry it forward so we don't silently lose release notes.
    if not plugin.get('changelog'):
        prior = plugin.get('versions')
        if isinstance(prior, list) and prior:
            head = prior[0]
            if isinstance(head, dict) and head.get('changelog'):
                plugin['changelog'] = head['changelog']
    updated = True
    break

if not updated:
    print(f"  ⚠ plugin id {plugin_id} not found in repo.json — please add it manually")
    sys.exit(0)

# Bump the index-level `updated_at` so marketplace UIs can show a
# "fresh as of <ts>" hint. Use `_dt.timezone` (via the alias import)
# because the stdlib `datetime` module shadows itself when imported
# the way the script does; `_dt.timezone` keeps a stable reference
# to the timezone class across Python versions.
repo['updated_at'] = _dt.datetime.now(_dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

with open(repo_path, 'w', encoding='utf-8') as f:
    json.dump(repo, f, ensure_ascii=False, indent=2)
    f.write('\n')

print(f"  ✓ version       = {version}")
print(f"  ✓ sha256        = {sha256}")
print(f"  ✓ published_at  = {published_at}")
print(f"  ✓ updated_at    = {repo['updated_at']}")
PY
fi

echo ""
echo "Install via: Plugin Manager → drag & drop or select the zip file"
