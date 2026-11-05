# @uchidai/recon：外部確認

「うちの会社は大丈夫？」に答える材料の一つとして、**所有確認した自社ドメイン**について、第三者に公開済みの情報だけから自社の弱点の手がかりを得る。

参照するのは次の 2 つだけ。

- DNS の公開レコード（TXT、MX、A、AAAA、CNAME、PTR）
- 証明書の公開ログ（Certificate Transparency）。検索サービスは crt.sh の JSON 出力を先に使い、結果が空か失敗のときだけ予備として Cert Spotter（SSLMate）の発行記録 API を使う

**対象のホストへは一切アクセスしない。** ポートスキャン、Web ページの取得、ログイン画面の確認、TLS 接続による証明書の取得を含めて行わない。見つかったホスト名の名前解決は DNS サーバへの問い合わせであり、ホストにはつながない。

これは「国の調査（IPA 事例集の脆弱性事例）で中小企業に実際に見つかった弱点」の確認と位置づける。推定はすべてプログラムの固定表（`src/patterns.ts`）で決め、Claude は使わない。

## 使い方

```ts
import {
  findContradictions,
  generateVerificationToken,
  recon,
  reconToAnswers,
  reconToAssetHints,
  verificationInstructionsJa,
  verifyOwnership,
} from "@uchidai/recon";

// 1. 担当者にトークンを渡し、TXT レコードを設定してもらう
const token = generateVerificationToken(); // 32 文字の 16 進数
verificationInstructionsJa("example.jp", token); // 日本語の手順

// 2. 所有確認（DNS の TXT に uchidai-verify=<token> があるか）
const check = await verifyOwnership("example.jp", token);
if (!check.ok) throw new Error(check.reasonJa);

// 3. 外部確認。verifyOwnership の結果（VerifiedDomain）が無いと動かない
const result = await recon("example.jp", { ownership: check.verified });

// 4. カルテへの反映
const answers = reconToAnswers(result); // 5 問の初期値と「外部から推定」のフラグ
const hints = reconToAssetHints(result); // 資産の役割ごとの属性と緩和策（根拠 external）
const contradictions = findContradictions(result, profile); // カルテとの矛盾
```

デモとテストでは fixture（記録した応答）を再生する。実ネットワークには出ない。

```ts
import { fixtureSources, loadDemoFixture, recon, verifyOwnership } from "@uchidai/recon";

const fixture = loadDemoFixture(); // examples/recon/demo-seiko.example.json
const { resolver, ct } = fixtureSources(fixture);
const check = await verifyOwnership(fixture.domain, fixture.verificationToken ?? "", { resolver });
if (check.ok) {
  const result = await recon(fixture.domain, { ownership: check.verified, resolver, ct });
}
```

## 公開する関数と型

| 種別     | 名前                                                                                                                                                                                                    | 内容                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 所有確認 | `generateVerificationToken()`、`verificationRecord(token)`、`verificationInstructionsJa(domain, token)`                                                                                                 | トークンの生成、TXT の値、担当者向けの手順                                                           |
| 所有確認 | `verifyOwnership(domain, token, { resolver? })` → `OwnershipCheck`                                                                                                                                      | 通れば `verified: VerifiedDomain`。通らなければ `reasonJa` と見つかった TXT                          |
| 所有確認 | `isVerifiedDomain(x)`、`assertVerified(domain, proof)`、`OwnershipNotVerifiedError`                                                                                                                     | 発行済みの VerifiedDomain か（同じ形のオブジェクトでは通らない）                                     |
| 確認     | `recon(domain, { ownership, resolver?, ct?, cache?, now?, maxHostLookups? })` → `ReconResult`（`sources.ct` が `"live"` のときは `sources.ctProvider` に実際に使った検索先 `"crtsh"`／`"certspotter"`） | 本体。zod の `ReconResult` で検証して返す                                                            |
| 反映     | `reconToAnswers(result)` → `AnswerHints`、`mergeAnswers(current, hints)`                                                                                                                                | 5 問の初期値（`hosting.mail`、`hosting.web`、`remoteAccess`）と「外部から推定」の項目                |
| 反映     | `reconToAssetHints(result)` → `AssetHint[]`、`applyAssetHints(profile, hints)`                                                                                                                          | 役割ごとの属性（`entry.vpn` の `exposed`、`cloud.mail` の `spf`/`dmarc` など）と緩和策（M1042 なし） |
| 矛盾     | `findContradictions(result, profile)` → `Contradiction[]`                                                                                                                                               | engine の `Contradiction` の形                                                                       |
| 参照先   | `DnsResolver`、`CtLogSource`、`ReconCache`、`ReconSources`                                                                                                                                              | インターフェース                                                                                     |
| 実装     | `NodeDnsResolver`、`CrtShSource`、`CertSpotterSource`、`FallbackCtSource`、`createLiveCtSource()`、`FileCache`、`MemoryCache`                                                                           | 実際の参照。`setDefaultResolver()`、`setDefaultCtSource()` で既定を差し替え可能                      |
| fixture  | `ReconFixture`、`loadFixture(path)`、`loadDemoFixture()`、`fixtureSources(fixture)`、`FixtureDnsResolver`、`FixtureCtSource`                                                                            | 記録した応答の再生                                                                                   |
| 型       | `ReconResult`、`Finding`、`HostnameEntry`、`RemoteAccessCandidate`、`MailInfo`、`SpfInfo`、`DmarcInfo`、`ProviderGuess`、`CloudService`、`WebInfo`、`Evidence`、`OwnershipProof`、`CtCertificate`       | すべて zod スキーマと TypeScript 型の両方                                                            |
| 表       | `REMOTE_ACCESS_PATTERNS`、`MX_PROVIDERS`、`SPF_INCLUDE_SERVICES`、`WEB_HOSTING_PATTERNS`、`IPA_VULN_CASES`                                                                                              | 推定に使う固定表                                                                                     |

## 確認項目（`ReconResult.findings`）

| id                   | 内容                                                                                                               | 根拠                     | IPA 脆弱性事例       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------ | -------------------- |
| `hostnames.ct`       | 証明書の公開ログから集めたホスト名の件数（重複除去、ワイルドカード、有効期限、名前解決の有無）                     | CT                       | ―                    |
| `remote_access.vpn`  | VPN 用と推定されるホスト名（vpn、sslvpn、remote、ras、gw、fw、forti、ssl、access、globalprotect、anyconnect など） | CT、DNS の A/AAAA        | 8・9                 |
| `remote_access.rdp`  | リモートデスクトップ用と推定されるホスト名（rdweb、rdgw、vdi、citrix など）                                        | CT、DNS                  | （番号は S0 が確認） |
| `mail_auth.spf`      | SPF の有無、`all` の種類、include                                                                                  | TXT                      | （番号は S0 が確認） |
| `mail_auth.dmarc`    | DMARC の有無とポリシー（p=none/quarantine/reject）                                                                 | `_dmarc.<domain>` の TXT | （番号は S0 が確認） |
| `mail_provider.mx`   | MX からの提供元の推定（Microsoft 365、Google Workspace、国内のレンタルサーバ数社、ゲートウェイ製品、不明）         | MX                       | ―                    |
| `cloud_services.spf` | SPF の include から分かるクラウドサービス                                                                          | TXT                      | ―                    |
| `web_hosting.hint`   | ホームページの置き場所の手がかり（CNAME 先、A の逆引き名。代表的な国内事業者数社と主要クラウド）                   | CNAME、A、PTR            | ―                    |

ホスト名のパターンは「推定」であり、装置の有無や種類を断定しない。提供元も表にあるものだけを挙げ、無ければ「不明」とする。

## 安全の実装

- **所有確認なしの実行を拒否する**：`recon()` は `verifyOwnership()` が返した `VerifiedDomain` を要求する。発行は WeakSet に記録され、同じ形のオブジェクトを外で作っても `OwnershipNotVerifiedError` になる。別ドメインの確認結果も拒否する
- **ネットワークに出る経路は 2 種類だけ**：DNS（`src/dns-node.ts`、Node 標準 `dns/promises`）と、証明書の公開ログの検索（`src/safe-fetch.ts` の `restrictedFetch`。宛先は crt.sh と Cert Spotter の 2 つ）
- **宛先の限定**：`restrictedFetch` は次の 2 形以外を `ForbiddenDestinationError` で拒否する。別ホスト、別パス、余分なパラメータ（`after=` の付加を含む）、順序や値の改変（`include_subdomains=false` など）、認証情報、フラグメント、http を含む。リダイレクトは追わない（`redirect: "error"`）。GET のみ
  - `https://crt.sh/?q=%25.<domain>&output=json`
  - `https://api.certspotter.com/v1/issuances?domain=<domain>&include_subdomains=true&expand=dns_names&expand=issuer`（`domain` は検証済みのホスト名だけ）
- **予備の使い方**：`FallbackCtSource` は crt.sh を先に呼び、0 件または失敗（HTTP エラー、壊れた応答、時間切れ）のときだけ Cert Spotter を呼ぶ。crt.sh が 1 件以上返したら Cert Spotter には問い合わせない。両方使えないときは DNS だけで続け（`sources.ct = "unavailable"`）、`notesJa` に理由を両方残す。Cert Spotter のページングは追わない（1 ページ 100 件に収まらないドメインは「一部のみ」と注記）。API キーは使わない
- **コード上の固定**：`src/safety.test.ts` が、`node:http`／`node:https`／`node:net`／`node:tls`／`node:child_process` などを import しないこと、`fetch` を呼ぶのが `proxy.ts` と `safe-fetch.ts` だけであること、`recon()` が最初に `assertVerified` を通すことをソース走査で確かめる
- **キャッシュ**：crt.sh と Cert Spotter の応答は既定で `packages/recon/.cache/`（gitignore 済み。キーは `crtsh:<domain>`、`certspotter:<domain>`）に 24 時間保存し、同じドメインへの問い合わせを繰り返さない。0 件の応答は保存しない（発行したばかりの証明書が公開ログに載るまで数時間かかるため、やり直せば拾える）
- **プロキシ**：`HTTPS_PROXY` が設定された環境では undici の `EnvHttpProxyAgent` を使う（`packages/llm/src/proxy.ts` と同じ方針）

実ネットワークのテストは書かない（CI では fixture と偽の fetch だけ）。開発中に一度だけ、公開の例示用ドメイン `example.com` に対して DNS 参照と crt.sh の問い合わせ（1 回）が動くことを手元で確かめた。Cert Spotter は、開発者のデモ用ドメインに対して手元で確かめた（結果は `docs/hackathon/claude-code-log.md`）。

## crt.sh の利用条件（2026-11-02 確認）

- crt.sh のトップページ（https://crt.sh/ ）と Advanced ページには、利用規約・レート制限・自動取得の可否に関する記述は**ない**。フッターに「© Sectigo Limited」の表記だけがある。ソースコードは https://github.com/crtsh （certwatch_db、GPL-3.0）で、README にも利用条件の記述はない
- 公式グループ（https://groups.google.com/g/crtsh ）のスレッド「DB's usage policy」（2024-06）で、運営側（sectigo.com のアドレス）は「We don't publish a fair-use policy.」「Some queries are lightweight; other queries tax the database rather a lot.」と述べ、明らかに乱用している IP をブロックし、解除の際に使い方の変更を求める運用だと説明している。PostgreSQL 直接接続（5432 番）には「10 秒間に 5 回を超える接続は落とす」制限があるとしている
- スレッド「Fair Usage」（2024-10）で、「並列ではなく順次、数秒に 1 回」の問い合わせについて運営側は「That sounds fine.」と答えている
- 本パッケージはこれに合わせ、1 ドメインにつき 1 回の GET（`output=json`）だけを行い、応答をディスクにキャッシュし、並列には問い合わせない。利用規約として明文化された文書は確認できなかったので、上記の運営側の発言を根拠とする。確認中に Advanced ページが 502 を返すこともあり、参照できないときは DNS だけで続けて `notesJa` に注記する（`sources.ct = "unavailable"`）

## Cert Spotter の利用条件（2026-11-04 確認）

crt.sh が空か失敗のときだけ使う予備の検索先。SSLMate, Inc.（運営会社の表記は Opsmate, Inc.）の Certificate Transparency Search API（Cert Spotter）。

- **認証なしで使えるか**：使える。API リファレンス（https://sslmate.com/help/reference/ct_search_api_v1 ）の Authentication の節に、認証なしの「List Issuances for a Domain」を時間あたりの回数を限って使えるとあり、用途は "for personal or evaluation purposes"（個人または評価）とされている。本番運用に入るときは、アカウントを作って API キー（Bearer または Basic）で認証してほしい、という**お願い**の形で、禁止とは書かれていない
- **レート制限**：料金表（https://sslmate.com/ct_search_api ）の無料枠（Small、0 ドル）は「単一ホスト名の問い合わせ 1 時間 100 回」と「**ドメイン全体の問い合わせ 1 時間 10 回**」。`include_subdomains=true` はドメイン全体の問い合わせなので、本パッケージが使う形は **1 時間 10 回**の枠に当たる（開発中に聞いていた「1 時間 100 回」は、単一ホスト名の枠に当たる）。ほかに 1 分 75 回、1 秒 5 回、1 回のタイムアウトは 15 秒。同ページに「高負荷のときは制限や時間切れが短くなることがある」とある。超えると HTTP 429（エラーコード `rate_limited`）
- **用途の制限・帰属表示**：利用規約（https://sslmate.com/policies/tos 、2026-01-03 改訂。https://sslmate.com/terms は同じページに移る）に、API の用途や商用・非商用の区別、帰属表示（出典の明記）を求める条文は**ない**。規約が定めるのは、違法または許可されない目的での利用の禁止（"illegal or unauthorized purpose"）、アカウント作成を人に限ること（ボットによる登録の禁止）、無保証（"AS IS"）、損害賠償の免責など。API リファレンスの末尾に「無料枠の機能は予告なく変更・制限されることがある」とある
- **サービスの性質**：SSLMate が 40 以上の証明書ログから集めた発行記録を、ドメイン名で引ける。対象のホストにはつながない（本パッケージの制約と矛盾しない）
- **本パッケージの使い方**：認証なし。API キーは使わない。crt.sh の結果が空か失敗のときだけ、1 ドメインにつき 1 回の GET（`domain=<ドメイン>&include_subdomains=true&expand=dns_names&expand=issuer`）を行い、24 時間保存して繰り返さず、並列には問い合わせない。ページングは追わない（最初の 1 ページだけ）。429 のときは DNS だけで続け、しばらくして再実行してもらう
- **残る留意点**：認証なしは「個人または評価」向けと書かれているため、事業として本番で継続利用する場合は、SSLMate のアカウントと API キーに切り替えるのが筋（本パッケージは今は認証を実装していない。ハッカソンの試用とデモの範囲では評価の用途に当たると判断した）。また 1 時間 10 回の枠は、複数の利用者が同じネットワークから使うと使い切りやすい

## fixture の形

`examples/recon/demo-seiko.example.json`（デモ用の架空ドメイン `demo-seiko.example`。IP は文書用の予約範囲）。

```jsonc
{
  "domain": "demo-seiko.example",
  "recordedAt": "2026-11-02T07:00:00Z",
  "verificationToken": "demo-seiko-verification-token-0001",
  "dns": {
    "<名前>": {
      "TXT": [],
      "MX": [{ "exchange": "", "priority": 0 }],
      "A": [],
      "AAAA": [],
      "CNAME": []
    }
  },
  "ptr": { "<IP>": ["<逆引き名>"] },
  "ct": [{ "id": 1, "issuer": "", "names": [], "notBefore": "...", "notAfter": "..." }]
}
```

載っていない名前は NXDOMAIN 扱い。実ドメインの応答を記録して fixture にするときも同じ形にする（crt.sh の行は `normalizeRow` でこの形になる）。

## デモ用の実ドメインに設定してもらう DNS レコード

デモの実ドメイン（開発者が用意）で fixture と同じ結果を出すには、次のレコードが要る。

| 種別     | 名前                    | 値                                                        | 役割                                                                                                                                         |
| -------- | ----------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| TXT      | `<domain>`              | `uchidai-verify=<token>`                                  | 所有確認（トークンは `generateVerificationToken()` で生成）                                                                                  |
| A        | `vpn.<domain>`          | 任意（例：文書用の 203.0.113.10。実際の装置は不要）       | VPN 用と推定されるホスト名。証明書の公開ログにも載せるなら、この名前で証明書を 1 枚発行する（Let's Encrypt の DNS 認証でよい。ホストは不要） |
| TXT      | `<domain>`              | `v=spf1 include:spf.protection.outlook.com -all`          | SPF あり                                                                                                                                     |
| （なし） | `_dmarc.<domain>`       | 設定しない                                                | DMARC なし                                                                                                                                   |
| MX       | `<domain>`              | `0 <tenant>.mail.protection.outlook.com`                  | Microsoft 365 と推定される MX（実際に受信しなくてよい）                                                                                      |
| CNAME    | `www.<domain>`          | レンタルサーバ事業者配下の名前（例：`xxxx.sakura.ne.jp`） | ホームページの置き場所の手がかり                                                                                                             |
| A        | `campaign2019.<domain>` | 任意                                                      | 廃止済みの旧キャンペーンサイト（カルテで `decommissioned: true`、`hostname` に同じ名前）。矛盾表示の例                                       |

## 出典

- IPA「中小企業のための実例で学ぶサイバーセキュリティリスク事例集」（2026年3月）：VPN 用ホスト名の推定の根拠として脆弱性事例 8・9 を注記。本文はリポジトリに入れない
- crt.sh（Sectigo Limited）：https://crt.sh/ 。証明書の公開ログの検索サービス
- Cert Spotter（SSLMate, Inc.）：https://sslmate.com/ct_search_api 。crt.sh が空か失敗のときの予備。利用条件の確認は上の「Cert Spotter の利用条件」
- Node.js `dns/promises`：DNS の問い合わせ

## 監査後の補足（2026-11-02）

- **所有確認の有効期限**：`verifyOwnership` の結果は 24 時間で失効し、`recon` は期限切れなら再確認を求める。録画の直前に確認し直す
- **参照先の固定**：fixture（記録の再生）で通した所有確認を、実際の DNS・crt.sh を参照する `recon` に渡すことはできない（確認の由来と参照先の種類が一致しないと拒否）。所有していないドメインを実参照する経路を塞ぐため
- **CT 由来のホスト名**：証明書の公開ログは第三者が書けるデータなので、ホスト名の検証を通らない名前は DNS に問い合わせず、注記だけ残す
- **過去の痕跡**：期限切れの証明書だけに現れ DNS に無い名前は `current: false` とし、5 問の初期値・資産の属性・矛盾の材料には使わない。`certificates.expired` に件数を残す
- **メール認証**：SPF や DMARC のレコードが 2 件以上ある、DMARC に `p=` が無い、は警告にする
- **CNAME 連鎖**：3 段まで追う
- **資産への反映**：`applyAssetHints` は前回の外部確認の値だけを置き換え、担当者登録やベンダー回答は消さない。矛盾は engine の根拠の優先順位（外部確認 > ベンダー回答 > 担当者登録）で出る。`findContradictions` は `applyAssetHints` の前に呼ぶ

- **廃止済み資産と証明書の属性**：`applyAssetHints(profile, hints, result)` に外部確認の結果を渡すと、カルテで廃止済み（`attrs.decommissioned: true`、`attrs.hostname`）の資産に `externallySeen`（DNS で解決できる、または有効な証明書がある）、`externallySeenAt`、`lastCertExpiry` を、現役の資産に `certExpiry`／`certWildcard` を根拠 external で付ける。engine はこれらから「廃止済みだが外部に残っている可能性」の矛盾を再現する
