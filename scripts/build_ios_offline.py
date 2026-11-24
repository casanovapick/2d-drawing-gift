#!/usr/bin/env python3
"""Bundles Kawaii Gift Gachapon (Code + CSS + HD Sprites + 54 Thai Voice Clips)
into a single 100% offline iOS-ready HTML file for AirDrop / Files / Safari."""

import base64
import json
import os
import re
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "dist-ios")
OUT_HTML = os.path.join(OUT_DIR, "KawaiiGachapon-iOS-Offline.html")
JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc"

MODULE_ORDER = [
    "src/state/gameStore.js",
    "src/audio/soundEngine.js",
    "src/audio/offlineVoiceClips.js",
    "src/audio/mascotVoice.js",
    "src/components/gachaponMachine.js",
    "src/components/chibiMascot.js",
    "src/components/confettiOverlay.js",
    "src/main.js",
]

SPRITE_KEYS = [
    "idle_closed",
    "talk_open",
    "starry_closed",
    "starry_open",
    "cheering_closed",
    "cheering_open",
]


def b64_file(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def strip_esm_syntax(code: str) -> str:
    # Remove import statements (single-line and multi-line)
    code = re.sub(r"^\s*import\s+[\s\S]*?from\s+['\"].+?['\"];\s*$", "", code, flags=re.M)
    # Remove export { ... }; re-exports
    code = re.sub(r"^\s*export\s*\{[^}]*\};\s*$", "", code, flags=re.M)
    # Strip export keyword before declarations
    code = re.sub(r"^\s*export\s+(class|function|const|let|var)\s+", r"\1 ", code, flags=re.M)
    return code


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    icon_b64 = b64_file(os.path.join(ROOT, "assets", "icons", "apple-touch-icon.png"))
    css_text = open(os.path.join(ROOT, "src", "styles", "main.css"), encoding="utf-8").read()

    sprites_map = {}
    for sk in SPRITE_KEYS:
        sp_path = os.path.join(ROOT, "assets", "mascot", f"{sk}.webp")
        sprites_map[sk] = f"data:image/webp;base64,{b64_file(sp_path)}"

    voice_dir = os.path.join(ROOT, "assets", "voice")
    voice_map = {}
    for fname in sorted(os.listdir(voice_dir)):
        if fname.endswith(".mp3"):
            key = fname[:-4]
            voice_map[key] = b64_file(os.path.join(voice_dir, fname))

    js_chunks = []
    for rel_path in MODULE_ORDER:
        raw_js = open(os.path.join(ROOT, rel_path), encoding="utf-8").read()
        js_chunks.append(f"// --- {rel_path} ---\n" + strip_esm_syntax(raw_js))

    combined_logic = "\n\n".join(js_chunks)

    # Validate bundled JS with Apple's WebKit JavaScriptCore (jsc) before writing HTML!
    if os.path.exists(JSC):
        test_wrap = f"function __verifyBundle__() {{\n'use strict';\n{combined_logic}\n}}\n"
        with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as tf:
            tf.write(test_wrap)
            tpath = tf.name
        res = subprocess.run([JSC, tpath], capture_output=True, text=True)
        os.unlink(tpath)
        if res.returncode != 0:
            raise RuntimeError(f"WebKit JSC validation failed:\n{res.stderr}\n{res.stdout}")
        print("WebKit JavaScriptCore validation: PASSED (0 errors)")

    embedded_script = (
        "window.__EMBEDDED_SPRITES__ = "
        + json.dumps(sprites_map, separators=(",", ":"))
        + ";\nwindow.__EMBEDDED_VOICE__ = "
        + json.dumps(voice_map, separators=(",", ":"))
        + ";\n(function() {\n'use strict';\n"
        + combined_logic
        + "\n})();"
    )

    html = f"""<!doctype html>
<html lang="th">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
    />
    <title>Kawaii Gift Gachapon! 🎁 เกมจับฉลากของขวัญ (Offline)</title>
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="จับฉลากโมจิ" />
    <meta name="theme-color" content="#fff5fa" />
    <link rel="apple-touch-icon" href="data:image/png;base64,{icon_b64}" />
    <style>
{css_text}
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script>
{embedded_script}
    </script>
  </body>
</html>
"""

    with open(OUT_HTML, "w", encoding="utf-8") as f:
        f.write(html)

    size_mb = os.path.getsize(OUT_HTML) / (1024 * 1024)
    print(f"Built iOS Offline Bundle: {OUT_HTML} ({size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
