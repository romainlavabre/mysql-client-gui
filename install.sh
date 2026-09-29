#!/usr/bin/env bash
# Installs or updates Simone, with its entry in the applications menu.
#
#   ./install.sh                 latest release from GitHub
#   ./install.sh 1.2.0           a given release
#   ./install.sh --file PATH     a downloaded .deb or .AppImage
#   ./install.sh --from-source   builds the packages from this checkout first (needs Node.js)
#   ./install.sh --appimage      AppImage in your home folder, even on Debian / Ubuntu
#   ./install.sh --uninstall     removes the app (your connections and passwords are kept)
#
# Also works without a checkout:
#   curl -fsSL https://raw.githubusercontent.com/romainlavabre/simone/master/install.sh | bash
#
# Debian / Ubuntu get the .deb package (sudo is asked once): menu entry, icon,
# `simone` command and the AppArmor profile needed by Ubuntu 24+.
# Other distributions get the AppImage unpacked in ~/.local/share, with a menu entry, no root needed.
set -euo pipefail

REPO=romainlavabre/simone
NAME=simone
TITLE="Simone"
# Name of the app until 1.0.0.
LEGACY_NAME=mysql-client-gui

APPIMAGE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/$NAME"
APP_DIR="$APPIMAGE_DIR/app"
DESKTOP_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/applications/$NAME.desktop"
ICON_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/512x512/apps/$NAME.png"
BIN_LINK="$HOME/.local/bin/$NAME"

if [[ -t 1 ]]; then
    BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
else
    BOLD=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi
info() { printf '%s•%s %s\n' "$BOLD" "$RESET" "$*"; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die()  { printf '%s✗%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

version=""
file=""
from_source=false
force_appimage=false
uninstall=false
while (( $# > 0 )); do
    case "$1" in
        --file) [[ $# -ge 2 ]] || die "--file needs a path"; file="$2"; shift ;;
        --from-source) from_source=true ;;
        --appimage) force_appimage=true ;;
        --uninstall) uninstall=true ;;
        -h | --help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        [0-9]*) version="$1" ;;
        *) die "unknown argument: $1 (see --help)" ;;
    esac
    shift
done

[[ "$(uname -s)" == Linux ]] || die "only Linux is supported for now"
[[ "$(uname -m)" == x86_64 ]] || die "only x86_64 packages are published for now (this is $(uname -m))"

use_deb() {
    ! $force_appimage && command -v apt-get >/dev/null && command -v dpkg >/dev/null
}

sudo_cmd() {
    if (( EUID == 0 )); then "$@"; else sudo "$@"; fi
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Removes an AppImage install made under the former name; prints whether there was one.
remove_legacy_appimage() {
    local data="${XDG_DATA_HOME:-$HOME/.local/share}"
    [[ -e "$data/$LEGACY_NAME/app" || -e "$data/applications/$LEGACY_NAME.desktop" ]] || return 1
    rm -rf "${data:?}/$LEGACY_NAME/app"
    rmdir "$data/$LEGACY_NAME" 2>/dev/null || true
    rm -f "$data/applications/$LEGACY_NAME.desktop" "$data/icons/hicolor/512x512/apps/$LEGACY_NAME.png"
    [[ -L "$HOME/.local/bin/$LEGACY_NAME" ]] && rm -f "$HOME/.local/bin/$LEGACY_NAME"
    return 0
}

# ---------------------------------------------------------------- uninstall

if $uninstall; then
    removed=false
    for package_name in "$NAME" "$LEGACY_NAME"; do
        if command -v dpkg >/dev/null && dpkg -s "$package_name" >/dev/null 2>&1; then
            info "Removing the $package_name package…"
            sudo_cmd apt-get remove -y "$package_name"
            removed=true
        fi
    done
    remove_legacy_appimage && removed=true
    if [[ -e "$APP_DIR" || -e "$DESKTOP_FILE" ]]; then
        info "Removing $APPIMAGE_DIR…"
        rm -rf "$APP_DIR"
        rm -f "$DESKTOP_FILE" "$ICON_FILE"
        [[ -L "$BIN_LINK" ]] && rm -f "$BIN_LINK"
        rmdir "$APPIMAGE_DIR" 2>/dev/null || true
        command -v update-desktop-database >/dev/null && update-desktop-database "$(dirname "$DESKTOP_FILE")" 2>/dev/null || true
        removed=true
    fi
    $removed || die "$TITLE is not installed"
    ok "$TITLE removed. Your settings and passwords are still in ~/.config/$NAME (delete that folder to forget them)."
    exit 0
fi

# ------------------------------------------------------------ get a package

if use_deb; then kind=deb; pattern='*.deb'; else kind=AppImage; pattern='*.AppImage'; fi

# Ask for the sudo password now rather than after a long download or build.
if [[ $kind == deb || "$file" == *.deb ]] && (( EUID != 0 )) && [[ "$file" != *.AppImage ]]; then
    command -v sudo >/dev/null || die "sudo not found: run as root, or use --appimage"
    sudo -v || die "sudo is needed to install the .deb: run this in a terminal, or use --appimage for an install without root"
fi

if [[ -n "$file" ]]; then
    [[ -f "$file" ]] || die "file not found: $file"
    case "$file" in
        *.deb) kind=deb ;;
        *.AppImage) kind=AppImage ;;
        *) die "expected a .deb or an .AppImage: $file" ;;
    esac
    [[ $kind == deb ]] && ! command -v apt-get >/dev/null && die "a .deb needs apt-get: use the .AppImage on this system"
    package=$(realpath "$file")

elif $from_source; then
    root=$(cd "$(dirname "$0")" && pwd)
    [[ -f "$root/package.json" && -f "$root/electron-builder.yml" ]] || die "--from-source must be run from a checkout of the repository"
    command -v npm >/dev/null || die "npm not found: install Node.js 22 or later"
    info "Building the packages (a few minutes)…"
    (cd "$root" && npm ci --no-audit --no-fund && npm run dist)
    # shellcheck disable=SC2012 # names are ours, no odd characters
    package=$(ls -t "$root"/dist/$pattern 2>/dev/null | head -n 1)
    [[ -n "$package" ]] || die "the build produced no $kind package in dist/"

else
    tag=${version:-latest}
    info "Downloading the $kind package ($tag) from github.com/$REPO…"
    if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
        # gh also reaches the releases of a private repository.
        if [[ -n "$version" ]]; then
            gh release download "$version" --repo "$REPO" --pattern "$pattern" --dir "$WORK"
        else
            gh release download --repo "$REPO" --pattern "$pattern" --dir "$WORK"
        fi
    else
        command -v curl >/dev/null || die "curl not found"
        api="https://api.github.com/repos/$REPO/releases/${version:+tags/}${version:-latest}"
        release=$(curl -fsSL "$api") \
            || die "no release found at $api (private repository? log in with \"gh auth login\" and rerun)"
        extension=${pattern#\*}
        url=$(printf '%s\n' "$release" | grep -o '"browser_download_url": *"[^"]*'"$extension"'"' | head -n 1 | sed 's/.*"\(https[^"]*\)"/\1/')
        [[ -n "$url" ]] || die "the release has no $kind package"
        curl -fL --progress-bar -o "$WORK/$(basename "$url")" "$url"
    fi
    # shellcheck disable=SC2012
    package=$(ls "$WORK"/$pattern 2>/dev/null | head -n 1)
    [[ -n "$package" ]] || die "the download produced no $kind package"
fi

# ------------------------------------------------------------------ install

if [[ $kind == deb ]]; then
    info "Installing $(basename "$package") (sudo)…"
    # A local path must look like one for apt; --allow-downgrades lets an older version be picked explicitly.
    cp "$package" "$WORK/$NAME.deb"
    chmod 644 "$WORK/$NAME.deb"
    chmod 755 "$WORK"
    sudo_cmd apt-get install -y --allow-downgrades "$WORK/$NAME.deb"
    installed=$(dpkg-query -W -f='${Version}' "$NAME")
    ok "$TITLE $installed installed: find it in your applications menu, or run \"$NAME\"."
    exit 0
fi

# The AppImage is unpacked once: no FUSE needed and a fast start. Its AppRun
# launcher turns the Chromium sandbox off where the system forbids it.
info "Installing in $APP_DIR…"
chmod 755 "$package" 2>/dev/null || { cp "$package" "$WORK/$NAME.AppImage"; package="$WORK/$NAME.AppImage"; chmod 755 "$package"; }
(cd "$WORK" && "$package" --appimage-extract >/dev/null) || die "could not unpack $(basename "$package")"
[[ -x "$WORK/squashfs-root/AppRun" ]] || die "$(basename "$package") does not look like an AppImage of $TITLE"
mkdir -p "$APPIMAGE_DIR" "$(dirname "$DESKTOP_FILE")" "$(dirname "$ICON_FILE")"
rm -rf "$APP_DIR.new"
mv "$WORK/squashfs-root" "$APP_DIR.new"
rm -rf "$APP_DIR"
mv "$APP_DIR.new" "$APP_DIR"

icon_inside="$APP_DIR/usr/share/icons/hicolor/512x512/apps/$NAME.png"
if [[ -f "$icon_inside" ]]; then
    cp "$icon_inside" "$ICON_FILE"
else
    warn "no icon found in the package: the menu entry will use a generic one"
fi
launcher="\"$APP_DIR/AppRun\""

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Name=$TITLE
Comment=Fast MySQL / MariaDB client with git-shared connections and queries
Exec=$launcher %U
Icon=$NAME
Terminal=false
Type=Application
Categories=Development;Database;
StartupWMClass=$NAME
EOF

remove_legacy_appimage && info "Removed the former $LEGACY_NAME install"

if [[ -d "$HOME/.local/bin" ]] && [[ ! -e "$BIN_LINK" || -L "$BIN_LINK" ]]; then
    ln -sf "$APP_DIR/AppRun" "$BIN_LINK"
fi
command -v update-desktop-database >/dev/null && update-desktop-database "$(dirname "$DESKTOP_FILE")" 2>/dev/null || true

for dependency in git ssh; do
    command -v "$dependency" >/dev/null || warn "$dependency is not installed: workspaces and SSH tunnels need it"
done
ok "$TITLE installed: find it in your applications menu (it may take a few seconds to appear)."
