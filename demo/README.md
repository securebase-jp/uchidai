# デモ動画の作り方

3 分のデモ動画は、アプリ自身にデモを上演させる「デモモード」を画面収録し、ナレーション音声・字幕・エンドカードを結合して作る。
原稿・操作・音声・映像は一つのタイムライン（`demo/out/timeline.json`）でつながる。

```
demo/
  narration.json      ナレーション原稿（9 場面：読み上げ文、字幕、目安秒数、画面で起きること、クレジット）
  storyboard.json     絵コンテ（場面ごとの画面の操作と演出。デモモードがこの順に進める）
  scripts/
    build-subtitles.ts  原稿 → 字幕（SRT / VTT）とタイムライン JSON
    synth-voicevox.ts   VOICEVOX（ローカル）で場面ごとの WAV を生成し、長さを audio/durations.json に書く
    assemble.ts         録画 + 音声 + 字幕 (+ タイトルカード) を ffmpeg で 1 本の MP4 に
    lib.ts              共通部分（依存なし）
  audio/              生成した音声（git 管理外）
  capture/            画面収録（git 管理外）
  out/                字幕・タイムライン・完成動画（git 管理外）
```

## 手順

1. **原稿を確認する** `demo/narration.json`。読み上げ文（`textJa`）では ATT&CK を「国際的な攻撃手法の分類」と言い、英字は読み方（ブイピーエヌ、エーアイ、クロード）で書く。字幕（`subtitleJa`）には正式表記を残す
2. **音声を作る**（任意）

   ```bash
   node demo/scripts/synth-voicevox.ts            # 既定：四国めたん（ノーマル）、http://localhost:50021
   node demo/scripts/synth-voicevox.ts --list     # 話者と style の一覧
   node demo/scripts/synth-voicevox.ts --name ずんだもん --style ノーマル --speed 1.05 --scene 4
   ```

   エンジンが無ければ手順を表示して終了する。音声が無くてもデモモードは原稿の秒数で進む
3. **字幕とタイムラインを作る** `node demo/scripts/build-subtitles.ts` → `demo/out/narration.srt`（YouTube にアップロードできる）、`narration.vtt`、`timeline.json`。音声があればその長さで cue を切る
4. **デモモードを録画する**：`pnpm dev` で起動し、ブラウザを 1920×1080（黒背景）にして次の URL を開き、画面収録（macOS は Shift+Cmd+5、60fps）を始めてから「開始」を押す

   ```
   http://localhost:5173/?profile=demo-seiko&demo=1&controls=0
   ```

   録画用の URL には `&controls=0` を付ける（画面下の操作バーと「一時停止中」の札を出さない。キー操作はそのまま使える）
   - `&scene=4` 場面 4 から　`&autostart=1` クリックなしで開始（音声の自動再生はブラウザの制限でクリックが要る）
   - `&captions=1` 画面に字幕を出す（焼き込みの代わり）　`&hud=1` 右上に場面と時刻
   - キー：Space 一時停止／再開、→ 次の場面、← 前の場面、H 右上の表示、C 字幕
   - **操作バー**：再生中、画面中央の下に「前の場面」「一時停止／再開」「次の場面」と場面の番号を出す。マウスが 2 秒動かないと自動で隠れ、動かすか Space・矢印・Tab で出る。一時停止中は出したままで、画面の中央に「一時停止中」の札も出る。開始前の画面と終了後（エンドカード）には出ない。人が見ながら試すときのための部品で、録画では `&controls=0` で消す
   - 音声ファイル（`demo/audio/<n>.wav`）があれば場面ごとに同期して鳴らし、場面の長さは音声の長さになる
5. **結合する**

   ```bash
   node demo/scripts/assemble.ts --video demo/capture/screen.mov [--title demo/capture/title.png] [--font "BIZ UDPGothic"]
   ```

   出力は `demo/out/uchidai-demo.mp4`（1920×1080・60fps・H.264/AAC）。エンドカードは場面 9 として録画に含まれる。
   字幕の焼き込みには libass つきの ffmpeg（`subtitles` フィルタ）が要る。手元の Homebrew の ffmpeg 9.0.2 には無かったため、その場合は字幕トラック（mov_text）として埋め込み、焼き込みたいときは `&captions=1` で録画する。`--no-subtitles`、`--no-audio`、`--dry-run`（コマンドを表示するだけ）がある

## 原稿の文字数と秒数

読み上げの目安は 1 分あたり 300〜350 字。3 分で 750 字前後が上限。`build-subtitles.ts` が次の表を出す（文字数は空白と記号を除く）。

| 場面 | 題                 | 文字数 | 目安秒 | 文字/秒 | 画面                                                              |
| ---- | ------------------ | -----: | -----: | ------: | ----------------------------------------------------------------- |
| 1    | 社長の一言         |     41 |     15 |     2.7 | チャット：IPA 事例集のリンクと「これ、うちは大丈夫？」            |
| 2    | 答えられない担当者 |     54 |     15 |     3.6 | チャット：打っては消す入力欄、「少し時間をください。調べます。」  |
| 3    | リンクを貼る       |     69 |     15 |     4.6 | 貼り付け → 読解結果（記載／推定／不明のタグと手法 ID）            |
| 4    | 攻撃経路の再生     |    167 |     40 |     4.2 | 担当者画面の再生。後半は AI攻撃者の差し込み口（S6）               |
| 5    | ベンダーへの確認   |     53 |     20 |     2.6 | 確認依頼の差し込み口（S7）。11 秒で回答が入り、黄 → 赤に更新      |
| 6    | 結論               |     75 |     25 |     3.0 | 「うちの会社は、大丈夫ではありませんでした」と時間軸              |
| 7    | 一手で変わる       |     91 |     20 |     4.5 | 多要素認証は効かない → 装置の更新で止まる。後半は比較の差し込み口 |
| 8    | 社長への回答       |     53 |     15 |     3.5 | 社長向けの一枚 → チャットで送り「じゃあ、それやろう」             |
| 9    | 仕組みと締め       |     53 |     15 |     3.5 | エンドカード                                                      |
| 合計 |                    |    656 |    180 |     3.6 |                                                                   |

音声を作ると各場面の長さは音声の長さに置き換わる（`demo/audio/durations.json`）。場面の操作の時刻（`storyboard.json` の `at`）は秒で固定なので、音声が目安より長い場合は末尾に余白ができ、短い場合は後の操作が切れる。原稿を変えたら目安秒数も合わせる。

## 差し込み口（S6 / S7 の接続）

場面 4 後半（AI攻撃者）、5（確認依頼と回答）、7 後半（知見なし AI との比較）は、時刻だけ確保した空の枠で動いている。
`apps/web/src/client/demo/slots.tsx` の `SLOTS["slot:attacker"]` などに、`(props: { elapsed, seconds, onScreen }) => ReactNode` の部品を入れると、その枠に実際の画面が入る。枠は画面の右下に重なる（`.demo-slot`、全画面にするなら `.demo-slot.full`）。
場面 5 の「回答で黄 → 赤」は、`storyboard.json` の `answers` 操作（`applyAnswer` と同じ形）で 11 秒にデータを入れており、S7 の UI を差し込んでもそのまま動く。S7 の UI が回答を自分で入れるなら、この操作を外す。

## 利用規約の確認結果（2026-11-02）

### VOICEVOX

- **ソフトウェア本体**（[利用規約](https://voicevox.hiroshiba.jp/term/)）：「商用・非商用問わず利用することができます」「ご利用の際は VOICEVOX を利用したことがわかるクレジット表記が必要です」「作成された音声を利用する際は、各音声ライブラリの規約に従ってください」。作った音声の利用を他者に許諾するときは、相手にも同じ条件を守らせる
- **音声ライブラリ**（キャラクターごとに規約が違う）：既定の **四国めたん** と **ずんだもん** は SSS LLC の[東北ずん子・ずんだもんプロジェクト 音源利用規約](https://zunko.jp/con_ongen_kiyaku.html)に従う。商用・非商用とも利用可で、法人と個人の区別はなく、クレジットは「VOICEVOX:四国めたん」「VOICEVOX:ずんだもん」の形。動画サイトでは概要欄か画面内のクレジットに書く。禁止：公序良俗に反する利用、政治・宗教活動や特定の個人・団体・国家の批判や支持、情報商材、虚偽・誤解を招く情報の作成、風俗営業、反社会的勢力による利用
- **青山龍星**など一部のキャラクターは、企業が携わる利用に事前確認が要る（Docker Hub の `voicevox/voicevox_engine` の説明）。Securebase Inc. の作品として公開するため、既定では使わない。話者を変えるときは `--name` で指定し、そのキャラクターの規約と `narration.json` の `credits.voice` を合わせる
- 本リポジトリの表記：エンドカード（場面 9）と README に「音声合成：VOICEVOX:四国めたん」。動画の概要欄にも同じ一行を書く

### HyperFrames

- 実在する：[heygen-com/hyperframes](https://github.com/heygen-com/hyperframes)（HeyGen が公開。HTML で動画を定義し、headless Chrome で 1 フレームずつ描画して FFmpeg で MP4 にする。README の表記は Apache 2.0 で「per-render fees や commercial-use thresholds は無い」）。Node.js 22 以上、FFmpeg、Puppeteer 経由の Chrome が要る
- 使い方（README より）：`npx hyperframes init my-video` → `npx hyperframes preview` → `npx hyperframes render`。構成は HTML に `data-composition-id` / `data-width` / `data-height` / `data-start` / `data-duration` / `data-track-index` を付け、GSAP のタイムラインを `window.__timelines` に登録する
- **この環境では動作を確認していない**（Chromium の取得が要るため）。代替として `assemble.ts`（ffmpeg）を主の手順にした。HyperFrames を使うなら、録画した MP4 と `demo/out/narration.wav` を `<video>` と `<audio>` の clip として置き、字幕は `timeline.json` の cue から `<div data-start data-duration>` を作る形になる

### 書体と ATT&CK

- BIZ UDPGothic / BIZ UDPMincho / JetBrains Mono：いずれも SIL Open Font License 1.1（`@fontsource` で同梱）
- MITRE ATT&CK®：© The MITRE Corporation。利用規約と帰属はルートの `NOTICE`

## 社長向けの一枚（動画の場面 8 でも使う）

`#/onepager` に縦長の一枚を描く。共有リンクだけで再現できる：

```
http://localhost:5173/#/onepager?profile=demo-seiko&case=ipa-case-1&measures=
```

- `profile`：`examples/<id>.json` のカルテ。省略するとこのブラウザに保存したカルテ（この場合リンクでは共有できない）
- `case`：`eval/recordings/<id>.with-knowledge.json` の記録済みの読解結果。省略すると画面で選んだ事例
- `measures`：適用する対策ボタンの ID をコンマ区切り。省略すると画面の状態、空なら対策なし
- `rewrite=0`：Claude の言い換えを使わずテンプレート文にする
- 「PDF をダウンロード」はブラウザの中で .pdf を作って保存（A4 縦・白地・2 ページ以内）。「印刷する」はブラウザの印刷。API は `POST /api/onepager`
