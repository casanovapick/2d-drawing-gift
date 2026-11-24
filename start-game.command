#!/bin/zsh
cd "$(dirname "$0")"
echo "🎁 กำลังเปิดเกม Kawaii Gift Gachapon (พร้อมระบบพากย์เสียงภาษาไทย) ที่ http://localhost:8080 ..."
(sleep 1 && open "http://localhost:8080") &
/usr/bin/python3 server.py
