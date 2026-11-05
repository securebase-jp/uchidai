#!/bin/bash
# ウチダイを起動する（macOS）。ダブルクリックで、ターミナルが開いて動く
cd "$(dirname "$0")" || exit 1
./runtime/node --disable-warning=ExperimentalWarning ./runtime/launcher.mjs
status=$?
if [ "$status" -ne 0 ]; then
  echo
  echo "Enter キーを押すと、このウィンドウが閉じます。"
  read -r _
fi
exit "$status"
