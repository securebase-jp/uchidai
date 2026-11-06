# セキュリティ診断（2026-11-06）

対象：リポジトリ全体（診断時点のコミット `61bfb50`。公開用に履歴を作り直したため、この ID は公開リポジトリには存在しません）。公開と配布（ポータブル ZIP、Docker イメージ）の前に、ツール自体の欠陥を洗い出したものです。コードは直していません。直すかどうかは PM と利用者が決めます。

確かめた方法：コードの読解、単体テスト（`apps/web/src/server/*.security.test.ts`、`apps/web/src/server/mail/mailer.security.test.ts`。外へ出る通信はせず、`fetch` と名前解決を差し替えています）、手元の開発サーバ（内蔵ブラウザから `http://localhost:5183` に対してだけ）、`pnpm audit`、`gitleaks`。外部のホストへ攻撃的な通信はしていません。「確かめたこと」と「コードを読んだ限りの推定」は分けて書きます。

## 対応の状況（2026-11-06 追記）

診断のあと、凍結前に次の 4 件（と SEC-012）を直しました。各節に「対応済み」とコミットを書いています。

| ID                           | 対応                                                                                               | コミット  |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | --------- |
| SEC-001（高）                | 公開するのは本番サーバ（8787）だけに文書を書き換え。保険として Vite の `server.fs` を狭めた        | `60becbb` |
| SEC-002（中）・SEC-012（低） | 他サイトのページからの要求を `Sec-Fetch-Site`・`Origin`・`content-type` で断る middleware を足した | `6ddb302` |
| SEC-004（中）                | remote-guard が接続元のアドレスも見る。Docker は `UCHIDAI_TRUST_PRIVATE_PEER=1` を既定で設定       | `aaa4364` |
| SEC-007（中）                | 宛先 `to` を 1 件のメールアドレスの形だけにした。SMTP の自動送信は文書に明記（挙動は変えない）     | `efb4b47` |

**残りの対応（2026-11-06）**：利用者の指示で、残りも直しました。

| ID                             | 対応                                                                                                               | コミット  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ | --------- |
| SEC-003（中）                  | Host が手元の名前（localhost・127.0.0.1・[::1]・`UCHIDAI_ALLOWED_HOSTS`）でなければ 421                            | `01e0902` |
| SEC-006（中）                  | Claude の同時呼び出し 3・記事の取得 3（待つ）、読解 10 回／分・言い換え等 20 回／分（超えたら 429 と Retry-After） | `efb235d` |
| SEC-005（中）・SEC-008（低）   | 名前解決の失敗は拒否。解決した IP に接続を固定（プロキシ無しのとき）。NAT64・IPv4 互換を両方の検査で断る           | `2cb0972` |
| SEC-009（低）                  | 記事・PDF の既定の上限 5MB、CT と KEV の応答は 10MB で打ち切り                                                     | `8bd28de` |
| SEC-010（低）                  | CI の `permissions: contents: read`、gitleaks の配布物のチェックサム                                               | `3736030` |
| SEC-011（低）・SEC-013（情報） | `UCHIDAI_DATA_DIR` を Dockerfile の既定に。全面開放の設定なら起動時に警告                                          | `3a5328a` |
| SEC-014（情報）                | 所有確認のトークンに 7 日の期限                                                                                    | `14550b0` |
| SEC-015・016（情報）           | 対応しない（各節に理由）                                                                                           | —         |

**公開後の課題（未対応）**：無し。ただし SEC-005 の「接続先の固定」は、プロキシ（`HTTPS_PROXY`）経由のときは効かず（プロキシ側が名前を引く）、従来どおり「解決して内部なら拒否」だけです。プロキシを使う環境では、プロキシ側で内部アドレスへの接続を禁じてください。

修正の前後で、`eval/trials/demo-snapshot.ts` の出力は同一、`pnpm eval` は 98%／92%（基準どおり）、`pnpm typecheck`・`pnpm lint`・`pnpm test` は通っています。開発サーバで、カルテ画面・担当者画面（確認依頼の作成と送信箱）・デモ（`?demo=1&profile=demo-seiko`）の API の呼び出しがすべて 200 のままであることを内蔵ブラウザで確かめました。

## 結論

- 設計の芯（API キーはサーバだけ、Claude の出力は zod で検証、記事は指示文と分けて渡す、外部確認は DNS と証明書の公開ログだけ、ファイル名に入る ID は英数字に限定）は、コードと試験で確かめた範囲で守られています。依存関係に既知の脆弱性は無く、履歴に秘密情報はありません。
- 公開前に直すべき「高」が 1 件あります。`docs/usage.md` が勧める「Vite の開発サーバ（5173）を Cloudflare Tunnel で公開する」手順では、Vite の `/@fs/` からリポジトリ内のファイル（送信箱の `apps/web/.data/requests.json` を含む）が公開 URL から読めます。API 側の remote-guard は Vite 自身の配信には効きません。
- 「中」は 6 件で、いずれも「認証が無く、手元（127.0.0.1）だけで使う」前提の綻びです。悪意あるウェブページからローカルの API を叩ける（CSRF）、Host ヘッダを見ていない（DNS の付け替えで応答まで読める）、転送ヘッダが無ければ外からでも手元扱い（fail-open）、記事取得の名前解決と接続の間の付け替え（SSRF の窓）、Claude を呼ぶ API に回数の上限が無い、メールの宛先を検証していない、です。
- 「低」と「情報」は、IPv6 の端の表記、解析ライブラリへの大きな入力、CI の権限、Docker の読み取り専用との食い合わせ、SSE の接続数などです。

## 公開前に直すべきもの（高）

| ID      | 内容                                                                                                                                                                                                          | 直し方の案                                                                                                                                                                                                                                                                                                  | 規模                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| SEC-001 | Vite 開発サーバを公開 URL に出す手順で、`/@fs/<絶対パス>` からリポジトリ内のファイル（送信箱 `apps/web/.data/requests.json`、所有確認トークン `recon-tokens.json`、`eval/.cache` の記事本文、ソース）が読める | 公開 URL に出すのは本番サーバ（`pnpm build` 後の 8787）だけにし、`docs/usage.md` の `cloudflared tunnel --url http://localhost:5173` を書き換える。あわせて `apps/web/vite.config.ts` の `server.fs.deny` に `**/.data/**`、`**/.cache/**`、`eval/.cache/**` を足し、`server.fs.allow` を `apps/web` に絞る | 小（設定 5 行と文書） |

「中」の 6 件（SEC-002〜SEC-007）も、公開 URL やデモで外に出す前に、少なくとも SEC-002（CSRF）と SEC-004（fail-open）は直すことを勧めます。どちらも数十行です。

## 見つけた問題

重大度：高＝外部から会社の情報や秘密情報に届く／中＝条件つきで届く、または費用や可用性に直接響く／低＝悪用の条件が厳しい、または影響が小さい／情報＝設計上の前提や注意。

### SEC-001（高）開発サーバの公開で、`/@fs/` からリポジトリ内のファイルが読める

- 脅威面：API サーバ（公開 URL）、ファイルの読み書き
- 該当：`docs/usage.md:123`（`cloudflared tunnel --url http://localhost:5173`）、`apps/web/vite.config.ts:6-13`（`server.fs` の指定なし）、`apps/web/src/server/remote-guard.ts`（`/api/*` だけに効く）
- 何が起きるか：Vite の開発サーバは `/@fs/<絶対パス>` で、ワークスペースの根（この monorepo ではリポジトリの根）以下の任意のファイルを配信します。既定で拒むのは `.env`、`.env.*`、`*.{crt,pem}`、`**/.git/**` だけです（Vite 7.3.7 の既定値を `node_modules` の実装で確認）。トンネルで 5173 を公開すると、転送ヘッダの有無に関係なく、`apps/web/.data/requests.json`（依頼先のメールアドレス、会社名、資産名、依頼文、回答）、`apps/web/.data/recon-tokens.json`、`eval/.cache/`（取り込んだ記事の本文）、ソース一式が公開 URL から読めます。remote-guard は Hono の `/api/*` にしか掛かりません。
- 確かめ方（確認済み）：`.claude/launch.json` に `WEB_PORT=5183 API_PORT=8797 pnpm dev` の設定を足して起動し、内蔵ブラウザから `x-forwarded-for` と `cf-connecting-ip` を付けて `/@fs/<リポジトリ>/README.md` を取得 → 200 で本文。`POST /api/requests`（テンプレートの書き手、架空の会社 demo-seiko）で依頼を 1 件作ってから `/@fs/<リポジトリ>/apps/web/.data/requests.json` を転送ヘッダつきで取得 → 200 で JSON、宛先と件名を含む。同じヘッダで `/api/requests` は 403。確認後に送信箱は空にしました。
- 原因：公開の単位を「API」と考えて守りを API に置いたが、文書が勧める公開の単位は「開発サーバ全体」だった。
- 直し方の案：上の表のとおり。本番サーバ（`apps/web/src/server/index.ts` が `dist/` を配信）には `/@fs/` が無いので、公開はそちらだけにする。
- 規模：小。
- **対応済み（`60becbb`）**：`docs/usage.md` の手順を `pnpm build` → `pnpm --filter ./apps/web start` → `cloudflared tunnel --url http://127.0.0.1:8787` に書き換え、開発サーバを公開してはいけない理由を書いた。`docs/install.md` にも注意を足した。`apps/web/vite.config.ts` の `server.fs` を `strict: true`、`allow` は `apps/web`・`packages`・`node_modules`・`demo`、`deny` に `**/.data/**`・`**/.cache/**` を足した（既定の `.env` などは残す）。確認：`/@fs/<リポジトリ>/README.md`・`package.json`・`eval/RESULTS.md` が 403、依頼を作ったあとの `/@fs/<リポジトリ>/apps/web/.data/requests.json` が 403、画面が要るフォント（`node_modules`）と `demo/` は 200。

### SEC-002（中）他サイトのページから、ローカルの API を状態を変える形で叩ける（CSRF）

- 脅威面：API サーバ
- 該当：`apps/web/src/server/app.ts:62-71`（CORS と bodyLimit のみ）、Hono `c.req.json()`（`content-type` を見ずに `JSON.parse`。`hono@4.13.16` の `dist/request.js:104`）
- 何が起きるか：利用者がウチダイを起動したまま悪意あるページを開くと、そのページは `fetch("http://127.0.0.1:8787/api/...", {method:"POST", mode:"no-cors", body})` を `text/plain` で送れます。これはプリフライトの要らない単純リクエストなので、CORS は応答を読ませないだけで、サーバは処理します。状態を変える、または費用のかかる操作が対象です：`POST /api/requests`（`SMTP_URL` があれば、`to` に書いた任意の宛先へ依頼メールを送る。SEC-007）、`POST /api/case/read`・`/api/onepager`・`/api/attacker/recon`（Claude を呼び、利用者のキーで課金。SEC-006）、`POST /api/kev/refresh`、`POST /api/recon/token`（任意ドメインのトークン発行と DNS 照会）。`DELETE` はプリフライトが要るので止まります。
- 確かめ方（確認済み、`app.security.test.ts` の SEC-001 の節）：`content-type: text/plain`、`origin: https://evil.example` で `POST /api/profile/from-answers` → 200。`sec-fetch-site: cross-site` でも 200。`OPTIONS` のプリフライトには許可を返さない（DELETE は守られる）。
- 原因：同一生成元の確認を CORS（応答側）にだけ頼っている。
- 直し方の案：`/api/*` の GET 以外で、(1) `Sec-Fetch-Site` が `same-origin` か `none` 以外なら 403、(2) `Origin` があれば `corsOrigin()` に通らないものは 403、(3) `content-type` が `application/json` でなければ 415。既存の Vite プロキシと本番配信は同一生成元なので影響しません。
- 規模：小（middleware 1 つと試験）。
- **対応済み（`6ddb302`）**：`apps/web/src/server/same-origin.ts` を足し、`/api/*` の GET・HEAD・OPTIONS 以外で `Sec-Fetch-Site` が `same-origin`／`none`／無し 以外なら 403、`Origin` が `corsOrigin()` を通らなければ 403（`null` も）、POST・PUT・PATCH で `content-type` が `application/json` でなければ 415。SSE の GET にも `Sec-Fetch-Site` の確認を掛けた（SEC-012）。`app.security.test.ts` の期待値を反転し、同じ生成元・`none`・ヘッダ無し（curl）が通ることも試験した。画面・Vite のプロキシ・本番の同一生成元の配信・ポータブル ZIP・Docker は同じ生成元の要求なので影響しない。

### SEC-003（中）Host ヘッダを見ていない（DNS の付け替えで、応答まで読まれる）

- 脅威面：API サーバ
- 該当：`apps/web/src/server/app.ts`（Host の確認なし）、`apps/web/src/server/index.ts:13`（127.0.0.1 で待ち受け）
- 何が起きるか：攻撃者のドメインの A レコードを短い TTL で 127.0.0.1 に付け替えると、攻撃者のページ（`http://attacker.example:8787`）は同一生成元として `GET /api/requests`（送信箱）、`GET /api/recon/status`、`POST /api/evaluate` などの応答を読めます。会社カルテ自体はブラウザの localStorage（本来の生成元）にあるので届きませんが、送信箱と外部確認の結果は届きます。ポート番号が一致する必要があります（既定 8787、ZIP は 8787 から順に空きを探す）。
- 確かめ方（確認済み）：`host: attacker.example:8787` で `GET /api/examples` → 200。実際の付け替えは外部の DNS が要るので行っていません。
- 原因：Host の許可リストが無い。
- 直し方の案：`/api/*` で `Host` が `localhost`、`127.0.0.1`、`[::1]`（任意のポート）と、環境変数で足した名前以外なら 421 か 403 を返す。公開 URL（トンネル）の場合は転送ヘッダつきなので、`isForwarded` のときは Host の確認を飛ばして remote-guard に任せる。
- 規模：小。
- **対応済み（`01e0902`）**：`apps/web/src/server/host-guard.ts`。Host が無い要求は通し、`isRemote`（転送ヘッダ、または接続元がループバックでない。Docker の `UCHIDAI_TRUST_PRIVATE_PEER=1` も同じ設定）のときは remote-guard に任せる。Vite のプロキシは `changeOrigin: true` で Host を `127.0.0.1:<API_PORT>` に書き換える（`vite.config.ts` で確認）ので画面は影響しない。確認：試験（421・200・追加の許可）、開発サーバで画面・担当者画面・デモの API が 200、Docker で `Host: localhost:8787` と `127.0.0.1:8798` が 200、`Host: evil.example:8787` が 421。

### SEC-004（中）remote-guard は転送ヘッダが無ければ外からでも手元扱い（fail-open）

- 脅威面：API サーバ
- 該当：`apps/web/src/server/remote-guard.ts:14-18, 30`
- 何が起きるか：「外から」の判定が `cf-connecting-ip`、`x-forwarded-for`、`x-real-ip`、`forwarded` の有無だけです。これらを付けない経路（`API_HOST=0.0.0.0` で直接公開、`docker run -p 8787:8787` のように 127.0.0.1 を付けない公開、`proxy_set_header` を書いていない nginx、`ssh -L` のポート転送）では、送信箱・判定・読解・外部確認の全 API が認証なしで使えます。`docs/install.md:210` は公開しないよう書いていますが、仕組みとしては止まりません。
- 確かめ方（確認済み、`app.security.test.ts` の SEC-002 の節）：転送ヘッダ無し、`host: 203.0.113.10:8787` で `GET /api/requests` → 200。転送ヘッダありなら `/api/health` 以外 403。
- 原因：接続元のアドレスを見ていない（Hono の `getConnInfo` で取れる）。
- 直し方の案：`@hono/node-server/conninfo` の `getConnInfo(c).remote.address` がループバック（127.0.0.0/8、::1、::ffff:127.0.0.0/8）でないときも「外から」とみなす。Docker は `API_HOST=0.0.0.0` で待ち受けるので、コンテナの内側ではブリッジのアドレスから来ます。`UCHIDAI_TRUST_LAN=1` のような明示の緩和か、Docker 向けに `docker compose` の `network_mode` の説明を足す必要があります。
- 規模：小〜中（判定の変更と、Docker の動作確認）。
- **対応済み（`aaa4364`）**：`remote-guard.ts` が `getConnInfo` で接続元を見て、ループバック（127.0.0.0/8、::1、::ffff:127.x）でなければ「外から」とみなす。接続元が取れないとき（`app.request` のテスト）は従来の判定。Docker 向けに `UCHIDAI_TRUST_PRIVATE_PEER=1`（公開アドレスでない接続元は手元扱い）を `Dockerfile` の既定に入れた（外へ出さないのはホスト側の `-p 127.0.0.1:` で守る。PM の案のとおり）。ZIP の起動処理は 127.0.0.1 に固定しているので矛盾しない。確認：イメージを build して `docker run -p 127.0.0.1:<port>:8787` で `/api/health`・`/api/examples`・`/api/requests` が 200、転送ヘッダつきは 403、`UCHIDAI_TRUST_PRIVATE_PEER=0` では `/api/examples` が 403（接続元がブリッジの私設アドレスであることの裏づけ）。

### SEC-005（中）記事取得で、検査時の名前解決と接続時の名前解決が別（DNS の付け替えの窓）。検査の解決が失敗すると通す

- 脅威面：記事の取得（SSRF）
- 該当：`apps/web/src/server/safe-url.ts:110-129`（`assertPublicUrl`。解決失敗は `return u`）、`safe-url.ts:139-156`（`guardedFetch` はホスト名のまま `base` に渡す）、`packages/llm/src/article.ts:344-366, 461-469`（同じ構造）
- 何が起きるか：検査は `dns.lookup` で IP を確かめますが、取得（undici / Node の fetch）はホスト名で接続し、自分でもう一度名前を引きます。TTL の短いレコードを「1 回目は公開 IP、2 回目は 127.0.0.1 や 169.254.169.254」に向ければ、検査を通ったあとの接続が内部に向きます。取得した本文は Claude に渡され、読解結果として画面に返るので、内部の HTTP 応答の一部（Readability が本文とみなした文、根拠文）が外に出ます。サーバ側の `assertPublicUrl` は、解決が失敗・空のときに通す（fail-open）設計で、`article.ts` 側の `assertAllowedUrl` は止めます（二重の検査の片方だけ）。`safe-url.ts:6` に「付け替えには追随しない」と制限が明記されています。
- 悪用の条件：攻撃者が自分の DNS を持ち、利用者にその URL を記事として貼らせる（または SEC-002 で貼らせる）。内部の応答が読解の形に収まらなければ、画面には「対象外」と出るだけです。
- 確かめ方（確認済み、`safe-url.security.test.ts` の guardedFetch の節）：名前解決の差し替えを 1 回目公開 IP、2 回目 127.0.0.1 にしても、`base` には `http://rebind.example/` がホスト名のまま渡り、名前解決は 1 回しか呼ばれない。解決が例外・空のときに `assertPublicUrl` が URL を返す。llm 側は例外・空で拒む。
- 直し方の案：undici の `Agent({ connect: { lookup } })` で、検査で解決した IP を接続に使う（`Host` ヘッダと TLS の SNI はホスト名のまま）。または `guardedFetch` が解決した IP に置き換えた URL で取得し `Host` ヘッダを付ける（TLS の証明書検証に `servername` が要る）。`assertPublicUrl` は解決失敗を拒む（llm 側と同じ）。
- 規模：中（プロキシ経由 `EnvHttpProxyAgent` との両立に注意。プロキシがあるときはプロキシ側が解決するので、この窓は無い代わりに検査の解決と食い違う）。
- **対応済み（`2cb0972`）**：(a) `assertPublicUrl`（`resolvePublicUrl`）は解決の失敗・空を 400 で拒む。(b) `guardedFetch` が各段で解決したアドレスを `pinAddresses` で固定し、プロキシが無いときは `@uchidai/llm` の `lookupFetch`（undici の `Agent({ connect: { lookup } })`）で、そのアドレスだけに接続する（`pinnedLookup`。検査していないホストは ENOTFOUND）。TLS の SNI と Host はホスト名のまま。プロキシがあるときは `pinningFetch().pinned` が false で、従来の検査だけ（理由：プロキシ側が名前を引くため、こちらでは固定できない。上の「公開後の課題」）。確認：`safe-url.security.test.ts`（名前解決を 1 回目公開 IP・2 回目 127.0.0.1 に差し替えても、取得側の解決は 1 回目の値を返す）、`safe-url.test.ts`。実際の DNS の付け替えでは試していません。

### SEC-006（中）Claude を呼ぶ API と記事の取得に、回数・同時実行の上限が無い

- 脅威面：API サーバ（DoS、費用）
- 該当：`apps/web/src/server/app.ts:263-304`（`/api/case/read`）、`series-read.ts:81-99`（`urls` は最大 5 件を並列に取得し、連結 1 回と各報 5 回の読解を並列に呼ぶ）、`routes/onepager.ts:106`、`routes/attacker.ts:90, 205`
- 何が起きるか：手元の利用者（または SEC-002 の悪意あるページ）が連続して要求すると、要求ごとに Claude の呼び出し（`urls` では最大 6 回）と最大 20MB × 5 の取得が走ります。上限は本文の大きさと 1 回のタイムアウトだけで、回数も同時数も無制限です。費用は利用者のキーに乗ります。
- 確かめ方：コードの読解。`bodyLimit` 以外の制限 middleware が無いことを `app.ts` で確認。
- 直し方の案：プロセス内の簡単なセマフォ（同時 2 件）と、1 分あたりの回数（例：読解 10 回、言い換え 20 回）を超えたら 429。
- 規模：小。
- **対応済み（`efb235d`）**：同時実行は `@uchidai/llm` の `limits.ts`（Claude は `callStructured` の中で 3、記事の取得は `downloadBytes` で 3。環境変数 `UCHIDAI_CLAUDE_CONCURRENCY`・`UCHIDAI_FETCH_CONCURRENCY`。超えた分は待つだけで断らない）。回数は `apps/web/src/server/limits.ts`（読解 10 回／分 `UCHIDAI_READ_PER_MINUTE`、言い換え・依頼文・AI攻撃者・知見なし比較 20 回／分 `UCHIDAI_WRITE_PER_MINUTE`。超えたら 429 と `Retry-After`、「しばらく待ってからもう一度」の案内）。数えるのは Claude を呼ぶ直前だけで、`urls` の複数の読解も 1 回。記録の再生（キー無し、`replay`、記録済みの事例、テンプレートの書き手、`rewrite: false`、言い換えの使い回し）は数えない。デモは記録の再生なので当たらない。確認：`app.security.test.ts`（429 と Retry-After、再生は数えない、窓の動き）、`packages/llm/src/limits.test.ts`（セマフォ）、開発サーバで判定 3 回・一枚・再生・確認依頼が 200。

### SEC-007（中）依頼メールの宛先 `to` を検証していない。SMTP は依頼を作った時点で自動送信

- 脅威面：メール
- 該当：`apps/web/src/shared/requests.ts:92`（`to: z.string().max(200)`）、`apps/web/src/server/routes/requests.ts:144-145`、`apps/web/src/server/mail/mailer.ts:49-60`
- 何が起きるか：`to` はメールアドレスの形も 1 件であることも検証しません。nodemailer はカンマ区切りの複数宛先を受け付けるので、1 回の依頼で複数に送れます。SEC-002 と組み合わせると、`SMTP_URL` を設定した利用者のサーバを、悪意あるページが「任意の宛先へ依頼文（テンプレートか Claude の文で、会社名と資産名が入る）を送る」中継に使えます。本文は自由に書けないので迷惑メールとしての価値は小さいですが、送信元の信用を落とします。
- 確かめ方（確認済み、`mailer.security.test.ts`）：`to: "a@example.com, b@example.com"` と `to: "not an address"` が `CreateRequest` を通る。ヘッダ注入は nodemailer 10.3.1 が CR LF を畳むので別ヘッダ行にはならない（`streamTransport` で組んだ生のメッセージを確認）。
- 直し方の案：`to` を `z.string().email()` にし、`,` と `;` を拒む。SMTP の自動送信は、依頼の作成と送信を分け、画面の「送る」で明示的に行う（送信箱に積むだけの既定と同じ流れにする）。
- 規模：小。
- **対応済み（`efb4b47`）**：`CreateRequest.to` を `z.string().email()` にし（複数宛先・`;`・空白・改行・アドレスでない文字列は 400）、カルテのベンダーのメールも送る直前に同じ形か確かめる。SMTP の自動送信は変えず、`docs/install.md` と `docs/usage.md` に「設定すると依頼を作った時点で送られる」と書いた。`mailer.security.test.ts` の期待値を反転した。

### SEC-008（低）IPv6 の端の表記：NAT64 はサーバ側の検査だけが通し、IPv4 互換アドレスは両方が通す

- 脅威面：記事の取得（SSRF）
- 該当：`apps/web/src/server/safe-url.ts:53-73`、`packages/llm/src/article.ts:269-284`
- 何が起きるか：`http://[64:ff9b::7f00:1]/`（NAT64 に埋めた 127.0.0.1）はサーバ側 `checkPublicUrl` が通し、llm 側 `isPrivateIp` が止めます（片方だけ）。`http://[::7f00:1]/`（廃止された IPv4 互換アドレス）はどちらも通します。macOS と Linux はこの形をループバックとして扱わないのが普通なので、実害は確認できていません。
- 確かめ方（確認済み、`safe-url.security.test.ts`）。
- 直し方の案：`safe-url.ts` の `ipv6Blocked` に NAT64（`64:ff9b::/96`）と `::/96`（IPv4 互換）を足す。二重の検査は、どちらか一方（llm 側）に寄せると齟齬が減ります。
- 規模：小。
- **対応済み（`2cb0972`）**：サーバ側の `isBlockedAddress` を llm の `isPrivateIp` に寄せ、llm 側に `::/96`（IPv4 互換）を足した（NAT64 は llm 側に既にあった）。確認：`safe-url.security.test.ts`（両方の検査が同じ答え）、`packages/llm/src/limits.test.ts`。

### SEC-009（低）解析ライブラリへの大きな入力と、応答の全読み

- 脅威面：記事の取得（DoS）、外部確認、KEV
- 該当：`packages/llm/src/article.ts:148-178`（PDF：20MB を `getDocumentProxy` で解析してからページ数を見る）、`article.ts:853-888`（HTML：20MB を linkedom と Readability に渡す）、`apps/web/src/server/routes/kev.ts:67-68`（`res.text()` の後に大きさを見る）、`packages/recon/src/crtsh.ts:98`、`certspotter.ts:121`（`response.text()` に上限なし）
- 何が起きるか：細工した PDF や巨大な HTML で、単一スレッドのサーバが長時間止まります。KEV と CT の応答は信頼できる提供元からですが、大きさの上限が無いか、読み切ってから見ています。いずれも手元の利用者（または所有確認済みの自分のドメイン）だけが引き金なので、影響は自分の画面が止まることです。
- 確かめ方：コードの読解。細工した PDF での実測はしていません。
- 直し方の案：PDF と HTML の既定の上限を 20MB から 5MB 程度に下げる、`pdf.js` を `maxImageSize` などで絞る、CT と KEV の応答を `content-length` と受信量で打ち切る（`readBody` と同じ形）。
- 規模：小。
- **対応済み（`8bd28de`）**：`DEFAULT_MAX_BYTES` を 5MB に、貼り付け PDF の base64 上限を 7,000,000 字（5MB × 4/3）に。crt.sh・Cert Spotter（`packages/recon/src/safe-fetch.ts` の `readLimitedText`）と KEV（`@uchidai/llm` の `readLimitedText`）は `content-length` と受信量の両方で 10MB を超えたら途中で止める。main 側の `eval/.cache`（HTML 12 件、本文 44 件、合計 3.0MB）に 500KB を超えるファイルは無く、上限には当たりません。raw の PDF はキャッシュに無いので、PDF の実物の大きさは確かめていません（IPA 事例集と IR の PDF は一般に数 MB 以内）。`pdf.js` の `maxImageSize` は入れていません（規模と影響の確認に時間が要るため）。

### SEC-010（低）CI の権限とアクションの固定

- 脅威面：配布物（workflow）
- 該当：`.github/workflows/ci.yml`（`permissions:` が無い）、3 つの workflow の `uses: ...@v5` など（コミット SHA ではなく大版タグ）、`ci.yml:45`（gitleaks のバイナリをチェックサム無しで取得）
- 何が起きるか：`ci.yml` は `pull_request` でも動き、`permissions` が無いのでリポジトリの既定（設定によっては write）が付きます。フォークからの PR には読み取りしか付きませんが、明示しておくのが安全です。大版タグは上流の差し替えに追随します。
- 確かめ方：workflow の読解。`pull_request_target` は使っていない、`workflow_dispatch` の入力は環境変数で受けて形を検査している（`release-zip.yml:36-50`）、`run:` の中に `${{ }}` を直接書いていないことを確認。
- 直し方の案：`ci.yml` に `permissions: contents: read` を足す。アクションを SHA で固定する（Dependabot の `github-actions` を有効にする）。gitleaks は `--retry` の後に `sha256sum -c` を足す。
- 規模：小。
- **対応済み（`3736030`）**：`permissions: contents: read` と、公式の `gitleaks_8.30.1_checksums.txt` の値での `sha256sum -c` を足した。アクションの SHA 固定はせず、既にある `.github/dependabot.yml` の `github-actions` に任せる（PM の指示）。

### SEC-011（低・推定）Docker の `read_only: true` と、外部確認のキャッシュの既定の置き場

- 脅威面：配布物（Docker）
- 該当：`packages/recon/src/cache.ts:16-20`（`UCHIDAI_DATA_DIR` が無ければ `packages/recon/.cache`）、`Dockerfile`（`UCHIDAI_DATA_DIR` を設定していない）、`docker-compose.yml:35`（`read_only: true`、書けるのは `.data` のボリュームと `/tmp`）
- 何が起きるか（コードを読んだ限りの推定）：コンテナでは `packages/recon/.cache` への `mkdir` が EROFS で失敗し、crt.sh と Cert Spotter の両方が失敗扱いになって、外部確認は「証明書の公開ログを参照できなかった」の注記つきで DNS だけになります（`recon.ts:557-566` が例外を注記に落とす）。可用性の問題で、秘密情報には関わりません。
- 確かめ方：`docker compose up` で架空ではない自分のドメインを外部確認し、応答の `notesJa` を見る。この診断では Docker を動かしていません。
- 直し方の案：`Dockerfile` に `ENV UCHIDAI_DATA_DIR=/app/apps/web/.data` を足す（recon のキャッシュも `.data/recon-cache` に入る）。
- 規模：小。
- **対応済み（`3a5328a`）**：確認：イメージを build し、`--read-only --tmpfs /tmp -v <volume>:/app/apps/web/.data` で起動して、コンテナの中で `FileCache` の `set`／`get` が `/app/apps/web/.data/recon-cache` で通ることを確かめた（推定が当たっていたかの検証ではなく、修正後に書けることの確認）。

### SEC-012（低）SSE の接続数の上限を、他サイトのページが使い切れる

- 該当：`apps/web/src/server/routes/requests.ts:85-90`（32 本を超えると 503）
- 何が起きるか：`GET /api/requests/events` は `no-cors` の GET で他サイトから開けます（応答は読めませんが接続は保てます）。32 本を開いたままにすると、利用者の画面の同期が 503 になります。
- 直し方の案：SEC-002 の同一生成元の確認を GET の SSE にも掛ける。
- 規模：小。
- **対応済み（`6ddb302`）**：SEC-002 の middleware が `GET /api/requests/events` にも `Sec-Fetch-Site` の確認を掛ける。

### SEC-013（情報）`UCHIDAI_ALLOW_REMOTE_API=1` は全面開放

- 該当：`remote-guard.ts:27`、`docs/install.md:99`
- 設定すると認証無しで全 API が公開 URL から使えます。文書は「デモ以外では設定しない」と書いています。起動時の標準出力に警告を出すと、設定の残り忘れに気づけます。
- **対応済み（`3a5328a`）**：`index.ts` が起動時に警告を出す。Docker で `-e UCHIDAI_ALLOW_REMOTE_API=1` にして `docker logs` に出ることを確認。

### SEC-014（情報）所有確認の手順で、任意のドメインの TXT を照会できる。トークンに期限が無い

- 該当：`routes/recon.ts:210-278`、`packages/recon/src/ownership.ts:38-40, 111-126`
- 手元の利用者は、どのドメインでもトークンを発行し `verify` を呼べるので、サーバはそのドメインの TXT を DNS に照会し、失敗応答に全 TXT レコードを返します。公開の DNS 情報で、対象ホストにはつながないので、設計の範囲内です。トークンは `randomBytes(16)` の 16 進 32 文字で、期限はありません（`renew` で作り直せる。所有確認の結果は 24 時間で失効）。DNS に置く値なので期限が無くても実害はありません。
- **対応済み（`14550b0`）**：トークンに 7 日の期限を付けた。期限切れのトークンでは所有確認できず（400 と案内）、次の発行で作り直す。`recon-tokens.json` の形は変えず `createdAt` から期限を計算するので、以前の版の記録もそのまま読める（`createdAt` の無い記録は、以前から読み込みで捨てている）。7 日より前に発行したものは安全側に倒して失効扱い（DNS に残っていても、発行し直して TXT を置き直してもらう。古い TXT が残っていても害は無い）。任意のドメインの TXT を照会できる点は、公開の DNS 情報であり設計の範囲内なので変えていません。

### SEC-015（情報）サーバのログに、記事の URL と失敗の詳細が出る

- 該当：`app.ts:87`（`console.error` に例外オブジェクト）、`store/requests.ts:131-133`
- 500 のときに例外をそのまま標準エラーに出します。記事の URL、Anthropic SDK の `APIError`（状態コード、応答ヘッダの `request-id`）が含まれますが、API キーと要求ヘッダは含まれません。利用者に返す文は `publicMessage` がキー・環境変数・絶対パスを伏せます（試験で確認）。
- **対応しない**：ログは手元の標準エラーにしか出ず、キーと要求ヘッダは含まれない。原因の調査に記事の URL が要るので、伏せると困る。

### SEC-016（情報）デモ用の音声 API は本番でも有効

- 該当：`routes/demo.ts`
- `demo/audio/<n>.wav` を配るだけで、番号は 1〜50 の整数に限定（試験で確認）。Docker イメージには `demo/audio` を入れていないので、404 になるだけです。
- **対応しない**：配るのは git 管理外の音声ファイルだけで、番号以外の入力が無く、公開 URL からは remote-guard が断る。

## 確かめて問題なかったもの

公開時の説明に使えるよう、確かめ方を添えます。

| 項目                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 確かめ方                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 記事 URL の検査：`file:`・`data:`・`ftp:`・`javascript:`、ユーザー情報つき、`localhost`・`.local`・`.internal` などの名前、ループバック・私設・リンクローカル・メタデータ（169.254.169.254）・共有アドレス・`0.0.0.0`、10 進・16 進・8 進の IPv4 表記（URL が正規化）、`[::1]`・`[::]`・IPv4 射影（`::ffff:` の 10 進と 16 進）、`fe80::`・`fc00::` を断る                                                                                                                                 | `safe-url.security.test.ts`（33 通り）                                                                                        |
| 名前解決の結果が内部なら断る。公開と内部の両方に解決されても断る                                                                                                                                                                                                                                                                                                                                                                                                                           | 同上                                                                                                                          |
| リダイレクトは 1 段ずつ検査し、内部アドレス・内部名・`file:` への転送を断る。最大 5 回                                                                                                                                                                                                                                                                                                                                                                                                     | 同上、`safe-url.test.ts`、`article-fetch.test.ts`                                                                             |
| 「次のページ」を辿るのは同じホストのページ番号の形だけ。各ページも同じ検査を通る                                                                                                                                                                                                                                                                                                                                                                                                           | `article.ts:915-1017` の読解、`article-fetch.test.ts:275`                                                                     |
| 取得の上限：本文 20MB（`content-length` と受信量の両方）、全体 30 秒、Claude に渡す本文 10 万字、連結 15 万字、PDF 500 ページ、`urls` は 5 件、本文の HTTP 要求は 28MB＋64KB、他は 2MB                                                                                                                                                                                                                                                                                                     | `article.ts:172-178, 404-448`、`series-source.ts:17, 168`、`shared/api.ts:10-15`、`app.ts:49-71`、`article-fetch.test.ts:168` |
| ファイル名に入る ID：`examples/:id`、`case/recorded/:caseId`、AI攻撃者の記録（`profile.id`、`caseId`）、デモ音声の番号は、英数字とハイフン（または 1〜50 の整数）だけ。`../` や `%00` は 400、または記録なしとして扱う                                                                                                                                                                                                                                                                     | `app.security.test.ts`（記録の読み込みの節、ID の検査の節）、`attacker-recording.ts:80, 90, 158`                              |
| サーバが書くファイルは固定の名前（`requests.json`、`recon-tokens.json`、`kev.json`、キャッシュは SHA-256 の名前）で、利用者の入力はファイル名に入らない。一時ファイルに書いてから `rename`                                                                                                                                                                                                                                                                                                 | `store/requests.ts:137-143`、`routes/recon.ts:100-109`、`routes/kev.ts:94-101`、`packages/recon/src/cache.ts:48-51`           |
| `UCHIDAI_DATA_DIR` は `resolve` した絶対パスをそのまま使う（利用者自身の設定なので検証は不要）                                                                                                                                                                                                                                                                                                                                                                                             | `data-dir.ts`                                                                                                                 |
| 公開 URL（転送ヘッダつき）から使えるのは `GET /api/health` と `GET /api/sources` だけ。送信箱、判定、KEV、外部確認、デモ音声は 403                                                                                                                                                                                                                                                                                                                                                         | `app.security.test.ts`、`remote-guard.test.ts`                                                                                |
| CORS は `localhost`・`127.0.0.1`・`[::1]` の生成元だけ。手元以外の生成元には許可を返さず、`DELETE` のプリフライトも通らない                                                                                                                                                                                                                                                                                                                                                                | `app.security.test.ts`、`app.test.ts:309`                                                                                     |
| `/api/health` はキーの有無だけを返し、値は返さない                                                                                                                                                                                                                                                                                                                                                                                                                                         | `app.security.test.ts`                                                                                                        |
| エラー応答：壊れた JSON と形の違う入力は 400 で、スタック・絶対パス・`node_modules` を含まない。`publicMessage` が `sk-ant-` の形、`ANTHROPIC_API_KEY=` などの環境変数、絶対パスを伏せ、300 字で切る                                                                                                                                                                                                                                                                                       | `app.security.test.ts`、`errors.ts`、`errors.test.ts`                                                                         |
| Claude への入力：記事本文は `user` 側の `<article>` に入れ、指示文は `system` に分ける。`</article>` の閉じタグと属性（題と URL）はエスケープし、長さを切る                                                                                                                                                                                                                                                                                                                                | `prompts.ts:198-218`、`client.ts:56-77`                                                                                       |
| Claude の出力の検証：読解の出力は `z.object`（未知の項目は捨てる）。`damageType`・`victim`・`entryKind`・`leakedData` は定義済みの ID だけ、手法 ID は ATT&CK と照合して正規化し存在しないものは破棄、型紙にない手法は破棄、根拠文は原文との照合で実在しなければ消す、Claude が報告した「指示らしき文」も原文に無ければ捨てる。`.passthrough()` と `z.any()` は Claude の出力の検証には使っていない（`onepagerRecording.ts` の `.passthrough()` はデモの記録ファイルの読み込みにだけ使う） | `schema.ts`、`verify.ts`、`verify.test.ts`、`injection.test.ts`、本文の `grep`                                                |
| 一枚の言い換え：Claude には役割名と数値だけを渡し、出力は ID・入力にない数字・禁じた言い回しを検査して、落ちればテンプレート文に戻す                                                                                                                                                                                                                                                                                                                                                       | `onepager-writer.ts:85-131` 以降、`onepager-writer.test.ts`                                                                   |
| 依頼メールの文：Claude の出力は件名 120 字・本文 2000 字で、質問と番号つき選択肢とプレースホルダが揃っていなければテンプレートに切り替える。固有名詞はプログラムが差し込む                                                                                                                                                                                                                                                                                                                 | `writer.ts:94-120` 以降、`writer.test.ts`                                                                                     |
| AI攻撃者：出力は役割・手法 ID・理由の文だけの形。禁止語表（コマンド、ツール、製品、パス、ポート、コード、長い英数字、拡張子）とカルテ由来の固有名詞で各行を検査し、記録の再生でも再検査する                                                                                                                                                                                                                                                                                                | `attacker-safety.ts`、`attacker-safety.test.ts`                                                                               |
| `mailto:` の組み立て：宛先は `encodeURIComponent`、件名と本文は `URLSearchParams` で符号化し、改行や `&` で別の項目を足せない。スキームは固定                                                                                                                                                                                                                                                                                                                                              | `mailer.security.test.ts`                                                                                                     |
| SMTP（nodemailer 10.3.1）：件名と宛先に CR LF を入れても別のヘッダ行にならない                                                                                                                                                                                                                                                                                                                                                                                                             | `mailer.security.test.ts`（`streamTransport` で生のメッセージを確認）                                                         |
| 画面：`dangerouslySetInnerHTML` と `innerHTML` は使っていない。`href` に入るのは出典（`knowledge/sources.yaml`）、KEV の対応表（`knowledge` 内のデータ）、サーバが組んだ `mailto:`、`#/sources?src=`（`encodeURIComponent`）だけで、記事や Claude の出力の URL は `href` に入らない。`target="_blank"` には `rel="noreferrer"`                                                                                                                                                             | `apps/web/src/client` の `grep`                                                                                               |
| 共有リンク `d=`：64KB・展開後 1MB の上限、`base64url` の形、zod（文字列 300/2000 字、配列 50 件）で検証し、React の文字列として描く                                                                                                                                                                                                                                                                                                                                                        | `onepager-share.ts`、`onepager-share.test.ts`                                                                                 |
| localStorage のカルテと事例：zod で最低限の形を見て、壊れていれば捨てる。サーバへ送るときは `CompanyProfile.parse` で再検証                                                                                                                                                                                                                                                                                                                                                                | `storage.ts`、`storage.test.ts`                                                                                               |
| 外部確認：HTTP は `safe-fetch.ts` の 1 か所だけで、crt.sh と Cert Spotter の決まった URL の形以外（別ホスト、別パス、余分なクエリ、認証情報、フラグメント）を拒み、リダイレクトは `error`。`fetch` の識別子が他のファイルに無いこと、動的 import・eval が無いことを試験が検査                                                                                                                                                                                                              | `safe-fetch.ts`、`safety.test.ts`、`recon` の import 一覧（`node:dns/promises`、`undici`、`zod`、`@uchidai/engine` だけ）     |
| 外部確認：所有確認の証（`VerifiedDomain`）は `WeakSet` で発行を記録し、同じ形のオブジェクトを作っても通らない。24 時間で失効。証明書の名前はホスト名として正しいものだけ DNS に問い合わせ、上限 100 件                                                                                                                                                                                                                                                                                     | `ownership.ts`、`recon.ts:568-575`、`ownership.test.ts`                                                                       |
| KEV：取得先は `KEV_URL` と完全一致のときだけ、リダイレクトは `error`、60 秒のタイムアウト                                                                                                                                                                                                                                                                                                                                                                                                  | `routes/kev.ts:54-70`、`kev.test.ts`                                                                                          |
| 秘密情報：`gitleaks git` で 786 コミット（11.4MB）を走査し、検出なし。`.gitignore` の `.env`・`.env.*` が `.env`、`.env.local`、`apps/web/.env`、`.env.production` に効く（`git check-ignore`）。追跡ファイルに鍵・トークンの名前のファイルは無い（`.env.example` と `uchidai.env.example` だけ）。`lefthook` の pre-commit で gitleaks と作者名の検査                                                                                                                                     | この診断で実行                                                                                                                |
| 依存関係：`pnpm audit`（レジストリのプロキシ経由）で「No known vulnerabilities found」                                                                                                                                                                                                                                                                                                                                                                                                     | この診断で実行（2026-11-06）                                                                                                  |
| Docker：`USER node`、`.dockerignore` が `.env`・`.env.*`・`*.pem`・`*.key`・`.data`・`.cache` を除外、`HEALTHCHECK` あり、キーはイメージに入れず実行時に渡す。compose は `127.0.0.1:8787:8787`、`read_only`、`cap_drop: ALL`、`no-new-privileges`、`mem_limit`                                                                                                                                                                                                                             | `Dockerfile`、`docker-compose.yml`、`.dockerignore` の読解                                                                    |
| ポータブル ZIP：`uchidai.env` は `util.parseEnv` で読み、値は表示しない。`API_HOST` は 127.0.0.1 に固定。ポートは 1〜65535 の整数だけ。ブラウザを開くコマンドの引数は `http://127.0.0.1:<整数>/` の固定文字列で、利用者の入力は入らない。Node は `SHASUMS256.txt` と照合して取得                                                                                                                                                                                                           | `launcher.mjs`、`launcher-lib.mjs`、`launcher.test.ts`、`release-zip.yml:61-68`                                               |
| workflow：`pull_request_target` は無い。`workflow_dispatch` の入力は環境変数で受けて形を検査。`permissions` は publish と release で最小（`contents: read`、`packages: write`／`contents: write` は release のジョブだけ）                                                                                                                                                                                                                                                                 | 3 つの workflow の読解                                                                                                        |

## 診断の範囲外・できなかったこと

- 外部のホストへの通信は一切していません。DNS の付け替え（SEC-003、SEC-005）は、仕組みが成り立つ条件（Host を見ない、取得がホスト名で接続する）を手元で確かめただけで、実際の付け替えは行っていません。
- Docker イメージの build と起動（SEC-011 は推定）、Windows と macOS の起動ファイル（`.bat`、`.command`）の実行、ポータブル ZIP の組み立ては行っていません。
- 細工した PDF・HTML による解析ライブラリ（`unpdf`／pdf.js、`linkedom`、`@mozilla/readability`）の実測（SEC-009）はしていません。
- Claude の実際の応答に依存する振る舞い（記事中の指示に従ってしまうか、`damageType` や `clarity` が記事側から変えられるか）は、`verify.ts:11-12` が認めるとおり検証では見分けられません。プロンプトと検知の仕組みを読んだだけで、Claude を呼ぶ試験はしていません（`eval/` の記録は既存のものです）。
- `.env.example` と `scripts/portable/templates/uchidai.env.example` の中身は、作業の約束（`.env*` を読まない）に従って開いていません。gitleaks の結果に含まれています。
- ブラウザ側の防御（Chrome の Local Network Access の確認など）が SEC-002・SEC-003 をどこまで防ぐかは確かめていません。頼らない前提で書いています。
- `eval/`、`demo/`、`scripts/import-attack.ts` など開発時だけのスクリプトと、engine の判定ロジックの正しさは対象外です。
- 認証・認可は「無い」前提の設計なので、その妥当性自体は評価していません。公開 URL やデモで外に出す場合の前提を「中」の 6 件に書きました。

## 試験の実行

`pnpm typecheck`、`pnpm lint`、`pnpm test` を通しています。security.test はすべて修正後の振る舞い（403・415・421・429・拒否・固定）に反転済みで、「通ってしまう」ことを記録したまま残している試験はありません。残りの修正（枝 `claude/security-audit-2`）でも、`demo-snapshot` の出力は前後で同一、`pnpm eval` は 98%／92%、開発サーバでカルテ画面・担当者画面（確認依頼の作成と送信箱）・デモの API が 200 のままであることを確かめました。Docker は build して、read_only での起動、`/api/health`・`/api/examples` の 200、転送ヘッダつきの 403、`Host: evil.example` の 421、recon のキャッシュの書き込み、全面開放の警告を確かめました。
