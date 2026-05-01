"""Build the AMO source zip using forward-slash paths (POSIX-compliant ZIP)."""
import os
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "firefox" / "ff_lmdve_source.zip"

# (source_path_relative_to_repo_root, archive_path_with_forward_slashes)
ENTRIES = [
    ("firefox/manifest.json",      "manifest.json"),
    ("background.js",              "background.js"),
    ("content.js",                 "content.js"),
    ("viewer.js",                  "viewer.js"),
    ("build.mjs",                  "build.mjs"),
    ("package.json",               "package.json"),
    ("package-lock.json",          "package-lock.json"),
    ("DEPENDENCIES.md",            "DEPENDENCIES.md"),
    (".gitignore",                 ".gitignore"),
    (".gitattributes",             ".gitattributes"),
    ("src/editor.js",              "src/editor.js"),
    ("src/hljs-global.js",         "src/hljs-global.js"),
    ("src/marked-global.js",       "src/marked-global.js"),
    ("css/viewer.css",             "css/viewer.css"),
    ("icons/icon16.png",           "icons/icon16.png"),
    ("icons/icon48.png",           "icons/icon48.png"),
    ("icons/icon128.png",          "icons/icon128.png"),
    ("icons/demo.png",             "icons/demo.png"),
]

# Reviewer-focused README is written below as a literal string so we don't need
# to stage it on disk first.
README_PATH = ROOT / "firefox" / "REVIEWER_README.md"

if OUT.exists():
    OUT.unlink()

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
    for src_rel, arc in ENTRIES:
        src = ROOT / src_rel
        if not src.exists():
            raise SystemExit(f"missing source file: {src}")
        zf.write(src, arcname=arc)
    # README from a known location
    if README_PATH.exists():
        zf.write(README_PATH, arcname="README.md")
    else:
        raise SystemExit(f"missing README: {README_PATH}")

# Sanity check: dump archive listing with names to confirm forward slashes
with zipfile.ZipFile(OUT, "r") as zf:
    for n in zf.namelist():
        if "\\" in n:
            raise SystemExit(f"BACKSLASH in archive name: {n!r}")
        print(n)

print(f"\nOK -> {OUT} ({OUT.stat().st_size} bytes)")
