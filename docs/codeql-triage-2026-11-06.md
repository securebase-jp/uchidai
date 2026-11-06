# CodeQL（Code scanning）の警告 19 件の仕分け

2026-11-06 に公開したあと、CodeQL が 19 件の警告を出しました。1 件ずつ読み、実際に直すもの（A）と、直さないもの（B）に分けました。
B は、GitHub の画面で「False positive」（誤検知）または「Won't fix」として閉じるときの理由です。

## 結果の一覧

| 番号   | 規則                                     | 場所                                                         | 仕分け | 対応                                                             |
| ------ | ---------------------------------------- | ------------------------------------------------------------ | ------ | ---------------------------------------------------------------- |
| 1      | incomplete-multi-character-sanitization  | `apps/web/src/client/components/ChoiceNumber.test.tsx:11`    | B      | テストの補助関数で、画面を書き出した文字列から文字を取り出すだけ |
| 2      | incomplete-sanitization                  | `packages/llm/src/prompts.ts:216`                            | A      | 記事の中の `article` タグの `<` をすべて置き換える               |
| 3      | clear-text-logging                       | `scripts/portable/launcher.mjs:109`                          | A      | `API_HOST` の値を画面に出さない                                  |
| 4      | clear-text-logging                       | `scripts/portable/launcher.mjs:189`                          | B      | 保存先のフォルダの場所を利用者に見せるための表示                 |
| 5      | shell-command-injection-from-environment | `scripts/portable/smoke.ts:89`                               | A      | Windows では、経路に cmd の記号があれば起動しない                |
| 6〜8   | incomplete-url-substring-sanitization    | `eval/trials/run-ir.ts`・`run-supply-oos.ts`・`run-trial.ts` | A      | ホスト名の完全一致で判定する                                     |
| 9      | polynomial-redos                         | `packages/engine/src/yen.ts:10`                              | A      | 数字の連なりの途中から試さない。空白の量指定子の重なりをなくす   |
| 10     | polynomial-redos                         | `packages/llm/src/attacker-abstract.ts:232`                  | A      | メールアドレスの正規表現を、連なりの先頭からだけ試す             |
| 11     | polynomial-redos                         | `packages/llm/src/attacker-safety.ts:297`                    | A      | メールアドレスとポート番号の正規表現を同様に直す                 |
| 12・13 | polynomial-redos                         | `packages/llm/src/article.ts:575`                            | B      | 調べる範囲が先頭 4096 字に切られている                           |
| 14・15 | polynomial-redos                         | `packages/llm/src/article.ts:810`                            | A      | 題の末尾 400 字だけに当てる                                      |
| 16     | polynomial-redos                         | `packages/llm/src/onepager-writer.ts:460`                    | A      | 金額の判定を、「円」から後ろ向きに確かめる形にする               |
| 17・18 | polynomial-redos                         | `packages/llm/src/writer.ts:297`・`:312`                     | A      | 空白の量指定子の重なりをなくす                                   |
| 19     | identity-replacement                     | `packages/llm/src/article.ts:608`                            | A      | 置換の対象を U+00A0（改行しない空白）に直す                      |

## A：直したもの

- **2（記事の指示文への混入）**：記事の本文を指示文と分けて包む `wrapArticle` が、`<article …>` や `</article>` に見える並びの最初の `<` だけを `&lt;` に置き換えていました。`<article </article>` のように、タグの中に別のタグを入れ子にすると、内側の閉じタグが残り、記事の外へ出られる状態でした。`article` と `/article` の直前の `<` をすべて置き換えるようにし（大文字小文字、空白入りも含む）、入れ子のケースをテストに足しました。
- **3**：`API_HOST` に指定された値を、そのまま画面に出していました。秘密の値ではありませんが、値を出す理由がないので、「API_HOST の指定は使いません」とだけ出すようにしました。
- **5**：起動ファイルの経路を Windows の `cmd.exe` に渡しています。これは確認用の道具で、経路は開発者が自分で渡しますが、`& | < > ^ % " !` を含む経路は使わず、展開し直すよう案内するようにしました。
- **6〜8**：URL の文字列に `api.anthropic.com` が含まれるかで判定していたのを、`new URL(…).hostname` の完全一致にしました。
- **9〜11、14〜18（ReDoS）**：正規表現が、同じ文字の連なりの途中から何度も試す、または空白の量指定子が重なる形になっていて、数万字の繰り返しで時間がかかりました。意味を変えない形に書き直しています。
  - 書き直す前の正規表現と同じ結果になることを、ランダムな入力 2 万件ずつの突き合わせで確かめています（`packages/engine/src/yen.test.ts`、`packages/llm/src/redos.test.ts`）。
  - 数万字の繰り返しでも 50ms 以内に終わることを、同じテストで確かめています。
  - 14・15（題）は、題が信頼できないページに由来して長さの上限がないため、末尾の 400 字だけに当てます。媒体が付けるページ番号と媒体名は、これよりずっと短いものです。
- **19**：`tidyText` の `.replace(/ /g, " ")` は、普通の空白を普通の空白にする何もしない処理でした。改行しない空白（U+00A0）を普通の空白にする、が本来の意図です。保存済みの記事 144 本のうち、この文字を含む 2 本の本文だけが変わります。

## B：直さないもの（却下の理由）

- **1**：`ChoiceNumber.test.tsx` の補助関数は、`renderToStaticMarkup` が書き出した自分の画面の文字列から、ボタンの中の文字を取り出すだけです。HTML として解釈する場所に渡す処理ではなく、外部の入力も入りません。テストの中のコードで、誤検知として閉じます。
- **4**：表示しているのは保存先のフォルダの場所で、利用者が確認依頼などの置き場所を知るための案内です。秘密の値（キー、パスワード、トークン）ではありません。環境変数に由来するというだけで「機密」と見なされた誤検知です。場所を出さないと利用者が困るため、変えません。
- **12・13**：`<meta …charset=` を探す正規表現ですが、`sniffMetaCharset` は、先頭 4096 バイトだけを切り出してから当てています。入力の長さに上限があるので、最悪でも 4096 字の二乗（約 1600 万回）の範囲に収まり、実測で数 ms です。上限を決めている限り、問題になりません。

## 範囲外で見つけたこと（今回は直していない）

`attacker-safety.ts` の `\b[a-z][a-z0-9+.-]*:\/\/`（URL のスキームの検出）は、`a.a.a.…` のような数万字の入力で二乗の時間がかかります。CodeQL は指摘していません。入力は Claude が書いた 1 行の文で長さが限られるため、今回は直していません。
