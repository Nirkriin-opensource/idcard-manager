#!/usr/bin/env bash
# Non-root, temporary Linux validation. Does not install packages/services/firewall rules.
set -Eeuo pipefail
export NEXT_TELEMETRY_DISABLED=1
[[ $EUID -ne 0 ]] || { echo 'Run as a regular user; isolated PostgreSQL refuses root.' >&2; exit 1; }
src=$(cd -- "${1:-.}" && pwd)
if [[ -n ${2:-} ]]; then
  case_dir=$(realpath -- "$2")
  [[ $case_dir == /tmp/idcard-native.* && -O $case_dir && -f $case_dir/selected.sha256 ]] || { echo 'Invalid native test workspace.' >&2; exit 1; }
else
  case_dir=$(mktemp -d /tmp/idcard-native.XXXXXX)
fi
printf 'Native validation work directory: %s\n' "$case_dir"
cd "$case_dir"
if [[ ! -f selected.sha256 ]]; then
curl -fLsS --retry 2 https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o SHASUMS256.txt
case $(uname -m) in x86_64) arch=x64;; aarch64) arch=arm64;; *) echo 'Unsupported test architecture' >&2; exit 1;; esac
grep -E " node-v24\.[0-9]+\.[0-9]+-linux-${arch}\.tar\.xz$" SHASUMS256.txt >selected.sha256
[[ $(wc -l <selected.sha256) == 1 ]] || { echo 'Cannot uniquely resolve Node 24 archive.' >&2; exit 1; }
archive=$(awk '{print $2}' selected.sha256)
curl -fLsS --retry 2 "https://nodejs.org/dist/latest-v24.x/$archive" -o "$archive"
fi
archive=$(awk '{print $2}' selected.sha256)
sha256sum --check --strict selected.sha256
tar -xJf "$archive"
export npm_config_cache="$case_dir/npm-cache"
export PATH="$case_dir/${archive%.tar.xz}/bin:$PATH"
mkdir -p app
tar -C "$src" --exclude='.env*' --exclude=node_modules --exclude=.next --exclude=dist --exclude=storage --exclude=.git --exclude=delivery -cf - . | tar -C app -xf -
cd app
node --version
npm ci --no-fund
npm run build
npm test
# Full browser acceptance is separately run on Windows/CI with installed browser dependencies.
IDCARD_SKIP_BROWSER=1 IDCARD_TEST_PG_PORT=55433 IDCARD_TEST_HTTP_PORT=3108 npm run test:integration
for script in install.sh deploy/scripts/idcardctl deploy/scripts/harden.sh deploy/scripts/security-check.sh; do bash -n "$script"; done
echo 'PASS isolated native build/unit/API/PostgreSQL/worker/PDF checks. Browser skipped; no server installation, root recovery or physical printing was performed.'
