#!/usr/bin/env bash
# Publishes a version: tests, git tag, push, then a GitHub release with the
# AppImage and .deb packages.
#
#   ./tag.sh              next patch version (1.2.3 → 1.2.4)
#   ./tag.sh minor        1.2.3 → 1.3.0
#   ./tag.sh major        1.2.3 → 2.0.0
#   ./tag.sh 2.0.0        explicit version (digits and dots only)
#   ./tag.sh --dry-run    shows what would be done, without changing anything
set -euo pipefail

cd "$(dirname "$0")"

BRANCH=master
REMOTE=origin

if [[ -t 1 ]]; then
    BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
else
    BOLD=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi
info() { printf '%s•%s %s\n' "$BOLD" "$RESET" "$*"; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die()  { printf '%s✗%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

bump=patch
dry_run=false
for arg in "$@"; do
    case "$arg" in
        --dry-run) dry_run=true ;;
        patch | minor | major | [0-9]*) bump="$arg" ;;
        -h | --help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "unknown argument: $arg (patch, minor, major, X.Y.Z or --dry-run)" ;;
    esac
done

run() {
    if $dry_run; then
        printf '  %s[dry-run]%s %s\n' "$YELLOW" "$RESET" "$*"
    else
        "$@"
    fi
}

# ------------------------------------------------------------------- checks

for cmd in git gh npm node; do
    command -v "$cmd" >/dev/null || die "$cmd not found"
done
gh auth status >/dev/null 2>&1 || die "gh is not logged in: run \"gh auth login\""

current=$(git branch --show-current)
[[ "$current" == "$BRANCH" ]] || die "you are on \"$current\": versions are published from $BRANCH"

if [[ -n "$(git status --porcelain)" ]]; then
    if $dry_run; then
        warn "there are uncommitted changes (blocking outside --dry-run)"
    else
        git status --short >&2
        die "there are uncommitted changes"
    fi
fi

info "Fetching $REMOTE…"
git fetch --quiet --tags "$REMOTE"
if git rev-parse --verify --quiet "$REMOTE/$BRANCH" >/dev/null; then
    behind=$(git rev-list --count "HEAD..$REMOTE/$BRANCH")
    ahead=$(git rev-list --count "$REMOTE/$BRANCH..HEAD")
else
    behind=0
    ahead=$(git rev-list --count HEAD)
fi
(( behind == 0 )) || die "$BRANCH is $behind commit(s) behind $REMOTE: git pull first"

# ------------------------------------------------------------------- version

SEMVER='^([0-9]+)\.([0-9]+)\.([0-9]+)$'

last=$(git tag --list '[0-9]*' --sort=-v:refname | grep -E "$SEMVER" | head -n 1 || true)
last=${last:-0.0.0}
if [[ "$bump" =~ ^[0-9] ]]; then
    next="$bump"
    [[ "$next" =~ $SEMVER ]] || die "invalid version: $next (expected X.Y.Z, digits and dots only)"
else
    [[ "$last" =~ $SEMVER ]] || die "cannot parse the latest tag: $last"
    major=${BASH_REMATCH[1]} minor=${BASH_REMATCH[2]} patch=${BASH_REMATCH[3]}
    case "$bump" in
        major) next="$((major + 1)).0.0" ;;
        minor) next="$major.$((minor + 1)).0" ;;
        patch) next="$major.$minor.$((patch + 1))" ;;
    esac
    [[ "$last" == 0.0.0 ]] && next=1.0.0
fi
if git rev-parse --verify --quiet "refs/tags/$next" >/dev/null; then
    die "tag $next already exists"
fi

# ------------------------------------------------------------------ summary

echo
printf '  Version     %s%s%s  (previous: %s)\n' "$BOLD" "$next" "$RESET" "$last"
printf '  Commit      %s\n' "$(git log -1 --format='%h %s')"
(( ahead > 0 )) && printf '  To push     %d commit(s) to %s/%s\n' "$ahead" "$REMOTE" "$BRANCH"
if [[ "$last" != 0.0.0 ]]; then
    printf '  Changes since %s:\n' "$last"
    git log --format='    - %s' "$last..HEAD" | head -n 20
fi
echo

if ! $dry_run; then
    read -r -p "Test, build, tag, push and publish $next? [y/N] " answer
    [[ "$answer" =~ ^[yY]$ ]] || die "cancelled"
fi

# ---------------------------------------------------------------- publish

info "Running checks and tests…"
run npm run typecheck
run npm run lint
run npm test

info "Building the packages…"
# The version comes from the tag: package.json is only updated in the build.
run npm version --no-git-tag-version --allow-same-version "$next"
run npm run dist
run git checkout -- package.json package-lock.json

info "Tagging $next…"
run git tag -a "$next" -m "simone $next"

info "Pushing $BRANCH and $next…"
if ! run git push --atomic "$REMOTE" "$BRANCH" "refs/tags/$next"; then
    run git tag -d "$next"
    die "push rejected: the local tag was deleted, nothing is published"
fi

info "Creating the GitHub release…"
run gh release create "$next" --title "$next" --generate-notes dist/*.AppImage dist/*.deb \
    || die "the tag is pushed but the release failed: rerun \"gh release create $next dist/*.AppImage dist/*.deb\""

echo
if $dry_run; then
    ok "dry-run done: nothing was changed"
else
    ok "$next published: $(gh release view "$next" --json url --jq .url)"
fi
