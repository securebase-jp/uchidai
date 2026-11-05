#!/bin/sh
# ウチダイを起動する（Linux）。ターミナルで ./start.sh を実行する
cd "$(dirname "$0")" || exit 1
./runtime/node --disable-warning=ExperimentalWarning ./runtime/launcher.mjs
status=$?
if [ "$status" -ne 0 ]; then
  echo
  echo "起動に失敗しました。上の表示を確かめてください。"
fi
exit "$status"
