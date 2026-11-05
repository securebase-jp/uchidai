/**
 * 確認依頼の質問表：緩和策 ID ごとに「1 問だけの選択式」の質問と、選択肢 → 回答（status と attrs）の対応を持つ。
 * 文言は専門用語を避け、保守ベンダーが 1 分で答えられる形にする。判定は engine のルールが行い、ここでは材料を集めるだけ。
 */
import type { ControlStatus, Knowledge, Rule } from "@uchidai/engine";

export type AttrValue = string | number | boolean;

export type Choice = {
  id: string;
  labelJa: string;
  status: ControlStatus;
  /** 回答で確定する属性（判定ルールが参照するものだけ） */
  attrs?: Record<string, AttrValue>;
};

/** 役割で意味が変わる緩和策の、役割ごとの文言。choices を省けば共通の選択肢を使う */
export type RoleVariant = { textJa: string; hintJa?: string; choices?: Choice[] };

export type QuestionDef = {
  mitigation: string;
  textJa: string;
  hintJa?: string;
  choices: Choice[];
  /**
   * 役割ごとの文言（同じ緩和策 ID でも、サーバの M1047 は「アクセスログの監査」、ホームページの M1047 は「改ざん検知」のように
   * 判定ルールが見る意味が違う）。questionFor(mitigation, role) が当てはめる。無い役割は共通の文言
   */
  byRole?: Record<string, RoleVariant>;
};

const UNKNOWN: Choice = { id: "unknown", labelJa: "分からない", status: "unknown" };

const defs: QuestionDef[] = [
  {
    mitigation: "M1026",
    textJa: "管理者のパスワードは、全 PC で共通ですか",
    hintJa: "キッティング時に同じ管理者パスワードを入れたままかどうか",
    choices: [
      { id: "shared", labelJa: "全 PC で共通", status: "absent", attrs: { sharedPassword: true } },
      {
        id: "individual",
        labelJa: "PC ごとに個別",
        status: "present",
        attrs: { sharedPassword: false },
      },
      UNKNOWN,
    ],
  },
  {
    mitigation: "M1040",
    textJa:
      "PC に EDR（怪しい動きを見つけて止める仕組み）は入っていますか。入っている場合、アラートを誰かが見ていますか",
    hintJa: "ウイルス対策ソフトとは別のものです",
    choices: [
      {
        id: "present_monitored",
        labelJa: "入っていて、誰かがアラートを見ている",
        status: "present",
        attrs: { monitored: true },
      },
      {
        id: "present_unmonitored",
        labelJa: "入っているが、誰もアラートを見ていない",
        status: "present",
        attrs: { monitored: false },
      },
      { id: "absent", labelJa: "入っていない", status: "absent" },
      UNKNOWN,
    ],
  },
  {
    mitigation: "M1051",
    textJa: "この機器（ソフトウェア）は、修正プログラムが出たら決まった手順で更新していますか",
    choices: [
      { id: "present", labelJa: "決まった手順で更新している", status: "present" },
      { id: "absent", labelJa: "更新していない（導入時のまま）", status: "absent" },
      UNKNOWN,
    ],
    byRole: {
      "entry.web": {
        textJa:
          "ホームページの CMS や追加機能（プラグイン）は、更新が出たら決まった手順で更新していますか",
        hintJa:
          "レンタルサーバやクラウドサービスのサーバ本体（OS）の更新は事業者側の責任なので含めません。会社側で管理する範囲だけ",
      },
    },
  },
  {
    mitigation: "M1032",
    textJa:
      "ログインに、パスワードに加えてもう一つの確認（アプリの承認、SMS のコードなど）が必要ですか",
    choices: [
      { id: "all", labelJa: "全員に必要", status: "present", attrs: { mfaException: false } },
      {
        id: "partial",
        labelJa: "一部の人は例外にしている",
        status: "present",
        attrs: { mfaException: true },
      },
      { id: "absent", labelJa: "パスワードだけ", status: "absent" },
      UNKNOWN,
    ],
    byRole: {
      "entry.vpn": {
        textJa:
          "VPN の接続に、パスワードに加えてもう一つの確認（アプリの承認、SMS のコードなど）が必要ですか",
      },
      "cloud.mail_account.staff": {
        textJa:
          "一般の社員のメールのログインに、パスワードに加えてもう一つの確認（アプリの承認、SMS のコードなど）が必要ですか",
        hintJa: "社長や役員だけでなく、全社員のアカウントについて",
      },
      "entry.web": {
        textJa:
          "ホームページの管理画面（CMS の管理画面、FTP、事業者の管理コンソール）のログインに、パスワードに加えてもう一つの確認が必要ですか",
        choices: [
          { id: "present", labelJa: "必要", status: "present" },
          { id: "absent", labelJa: "パスワードだけ", status: "absent" },
          UNKNOWN,
        ],
      },
      "entry.vendor_remote": {
        textJa:
          "保守用の遠隔接続ツールのログインに、パスワードに加えてもう一つの確認（アプリの承認、SMS のコードなど）が必要ですか",
        choices: [
          { id: "present", labelJa: "必要", status: "present" },
          { id: "absent", labelJa: "パスワードだけ", status: "absent" },
          UNKNOWN,
        ],
      },
    },
  },
  {
    mitigation: "M1042",
    textJa: "この機器は、インターネットから直接つながる状態ですか",
    choices: [
      { id: "exposed", labelJa: "外から直接つながる", status: "absent", attrs: { exposed: true } },
      {
        id: "closed",
        labelJa: "外からはつながらない（社内だけ）",
        status: "present",
        attrs: { exposed: false },
      },
      UNKNOWN,
    ],
  },
  {
    mitigation: "M1035",
    textJa: "接続できる相手（IP アドレスや拠点）を限定していますか",
    choices: [
      { id: "present", labelJa: "限定している", status: "present" },
      { id: "absent", labelJa: "どこからでも接続できる", status: "absent" },
      UNKNOWN,
    ],
    byRole: {
      server: {
        textJa:
          "業務サーバへの管理用の通信（リモートデスクトップ、管理共有など）は、管理者の端末だけに限定していますか",
        choices: [
          { id: "present", labelJa: "管理者の端末だけに限定している", status: "present" },
          { id: "absent", labelJa: "社員の PC からも届く", status: "absent" },
          UNKNOWN,
        ],
      },
    },
  },
  {
    mitigation: "M1030",
    textJa: "業務サーバは、社員の PC とは別のネットワーク区画にありますか",
    choices: [
      { id: "segmented", labelJa: "別の区画にある", status: "present", attrs: { segmented: true } },
      {
        id: "flat",
        labelJa: "PC と同じネットワークにある",
        status: "absent",
        attrs: { segmented: false },
      },
      UNKNOWN,
    ],
  },
  {
    mitigation: "M1057",
    textJa:
      "社内から外へ大量のデータが送られたときに、検知して止める仕組み（DLP など）はありますか",
    choices: [
      { id: "present", labelJa: "ある（検知して止める）", status: "present" },
      { id: "absent", labelJa: "ない", status: "absent" },
      UNKNOWN,
    ],
  },
  {
    mitigation: "M1031",
    textJa:
      "外向きの通信を監視して、不審な通信を遮断する仕組み（UTM・IPS の外向き監視など）はありますか",
    choices: [
      { id: "present", labelJa: "ある（監視して遮断する）", status: "present" },
      { id: "absent", labelJa: "ない（外向きは見ていない）", status: "absent" },
      UNKNOWN,
    ],
  },
  {
    mitigation: "M1053",
    textJa:
      "バックアップは、社内ネットワークやクラウド同期から切り離した保管先にありますか。復旧テストはしましたか",
    choices: [
      {
        id: "isolated_tested",
        labelJa: "切り離した保管先があり、復旧テスト済み",
        status: "present",
        attrs: { isolated: true, restoreTested: true },
      },
      {
        id: "isolated_untested",
        labelJa: "切り離した保管先はあるが、復旧テストはしていない",
        status: "present",
        attrs: { isolated: true, restoreTested: false },
      },
      {
        id: "online_only",
        labelJa: "同じネットワーク内か、クラウド同期だけ",
        status: "present",
        attrs: { isolated: false },
      },
      { id: "absent", labelJa: "バックアップを取っていない", status: "absent" },
      UNKNOWN,
    ],
  },
  {
    mitigation: "M1022",
    textJa: "「リンクを知っている全員」への公開共有は、設定で禁止していますか",
    choices: [
      {
        id: "present",
        labelJa: "設定で禁止している",
        status: "present",
        attrs: { publicLinksDisabled: true },
      },
      {
        id: "absent",
        labelJa: "禁止していない（誰でも作れる）",
        status: "absent",
        attrs: { publicLinksDisabled: false },
      },
      UNKNOWN,
    ],
    byRole: {
      "cloud.saas": {
        textJa:
          "利用しているクラウドサービス（端末管理、グループウェアなど）の閲覧権限や共有は、必要な人・範囲だけに絞っていますか",
        choices: [
          {
            id: "present",
            labelJa: "必要な範囲に絞っている",
            status: "present",
            attrs: { sharingRestricted: true },
          },
          {
            id: "absent",
            labelJa: "絞っていない（広く見られる設定がある）",
            status: "absent",
            attrs: { sharingRestricted: false },
          },
          UNKNOWN,
        ],
      },
      server: {
        textJa: "業務サーバの共有フォルダのアクセス権は、業務に必要な人だけに絞っていますか",
        choices: [
          { id: "present", labelJa: "必要な人だけに絞っている", status: "present" },
          { id: "absent", labelJa: "誰でも読める共有がある", status: "absent" },
          UNKNOWN,
        ],
      },
      file_server: {
        textJa: "ファイルサーバのアクセス権は、業務に必要な人だけに絞っていますか",
        choices: [
          { id: "present", labelJa: "必要な人だけに絞っている", status: "present" },
          { id: "absent", labelJa: "誰でも読める共有がある", status: "absent" },
          UNKNOWN,
        ],
      },
    },
  },
  {
    mitigation: "M1047",
    textJa: "共有設定（誰に何を公開しているか）を定期的に見直していますか",
    choices: [
      { id: "present", labelJa: "定期的に見直している", status: "present" },
      { id: "absent", labelJa: "見直していない", status: "absent" },
      UNKNOWN,
    ],
    byRole: {
      "cloud.saas": {
        textJa: "クラウドサービスの共有・権限設定を、定期的に見直していますか",
        choices: [
          { id: "present", labelJa: "定期的に見直している", status: "present" },
          { id: "absent", labelJa: "見直していない", status: "absent" },
          UNKNOWN,
        ],
      },
      "cloud.mail_account.staff": {
        textJa: "社員のメールに仕込まれた外部への自動転送の設定を、定期的に点検していますか",
        hintJa: "メールの設定画面で、見覚えのない転送ルールがないかを確かめることです",
        choices: [
          { id: "present", labelJa: "定期的に点検している", status: "present" },
          { id: "absent", labelJa: "点検していない", status: "absent" },
          UNKNOWN,
        ],
      },
      server: {
        textJa: "業務サーバのアクセスログを、定期的に確認していますか",
        choices: [
          { id: "present", labelJa: "定期的に確認している", status: "present" },
          { id: "absent", labelJa: "確認していない", status: "absent" },
          UNKNOWN,
        ],
      },
      file_server: {
        textJa: "ファイルサーバのアクセスログを、定期的に確認していますか",
        choices: [
          { id: "present", labelJa: "定期的に確認している", status: "present" },
          { id: "absent", labelJa: "確認していない", status: "absent" },
          UNKNOWN,
        ],
      },
      "entry.web": {
        textJa:
          "ホームページの改ざんを検知する仕組み（ファイルの定期的な照合や改ざん検知サービス）はありますか",
        choices: [
          { id: "present", labelJa: "ある", status: "present" },
          { id: "absent", labelJa: "ない", status: "absent" },
          UNKNOWN,
        ],
      },
    },
  },
  {
    mitigation: "M1027",
    textJa: "パスワードの使い回しを防ぐ仕組み（パスワード管理ツールなど）はありますか",
    choices: [
      { id: "present", labelJa: "ある", status: "present" },
      { id: "absent", labelJa: "ない", status: "absent" },
      UNKNOWN,
    ],
  },
  {
    mitigation: "M1017",
    textJa: "従業員向けの情報セキュリティ研修を実施していますか",
    choices: [
      { id: "present", labelJa: "定期的に実施している", status: "present" },
      { id: "absent", labelJa: "実施していない", status: "absent" },
      UNKNOWN,
    ],
  },
  {
    mitigation: "M1049",
    textJa: "ウイルス対策ソフトは、全 PC に入っていますか",
    choices: [
      { id: "present", labelJa: "全 PC に入っている", status: "present" },
      { id: "absent", labelJa: "入っていない PC がある", status: "absent" },
      UNKNOWN,
    ],
  },
  {
    mitigation: "M1054",
    textJa: "送信ドメイン認証（SPF・DKIM・DMARC）は設定していますか",
    choices: [
      { id: "present", labelJa: "設定している", status: "present" },
      { id: "absent", labelJa: "設定していない", status: "absent" },
      UNKNOWN,
    ],
  },
  {
    mitigation: "M1037",
    textJa: "社内から外へ出る通信を、必要なものだけに絞っていますか",
    choices: [
      { id: "present", labelJa: "絞っている", status: "present" },
      { id: "absent", labelJa: "絞っていない", status: "absent" },
      UNKNOWN,
    ],
  },
  {
    mitigation: "UD-01",
    textJa:
      "振込先の変更や急な送金の指示があったとき、登録済みの電話番号へ折り返して確認する、または二人で承認する手順はありますか",
    choices: [
      { id: "present", labelJa: "手順がある", status: "present" },
      { id: "absent", labelJa: "手順はない", status: "absent" },
      UNKNOWN,
    ],
  },
  {
    mitigation: "M1036",
    textJa:
      "メールのログインに、接続元や端末の条件（会社の端末だけ、など）や、ログインの有効期間を短くする設定をしていますか",
    hintJa: "ログイン済みの状態を盗まれても、別の場所から使えないようにする設定です",
    choices: [
      { id: "present", labelJa: "条件や有効期間の設定をしている", status: "present" },
      { id: "absent", labelJa: "していない", status: "absent" },
      UNKNOWN,
    ],
  },
  {
    mitigation: "UD-05",
    textJa:
      "社長や取引先を名乗る人から SNS やチャットで連絡があり、グループの作成や招待を頼まれたとき、応じない決まりはありますか",
    hintJa: "登録済みの連絡先で本人に確かめるまで、口座や残高の話をしない決まりです",
    choices: [
      { id: "present", labelJa: "応じない決まりがある", status: "present" },
      { id: "absent", labelJa: "決まりはない", status: "absent" },
      UNKNOWN,
    ],
  },
  {
    mitigation: "UD-06",
    textJa: "送金や振込先の変更は、二人目が内容を確かめて承認しないと実行できませんか",
    choices: [
      { id: "present", labelJa: "二人目の承認が要る", status: "present" },
      { id: "absent", labelJa: "一人で実行できる", status: "absent" },
      UNKNOWN,
    ],
  },
  {
    mitigation: "UD-07",
    textJa: "経理担当が一人で送金できる額に、上限を決めていますか",
    hintJa: "上限を超える額は、社長など上位の人の承認が要る設定です",
    choices: [
      { id: "present", labelJa: "上限を決めている", status: "present" },
      { id: "absent", labelJa: "上限はない", status: "absent" },
      UNKNOWN,
    ],
  },
  {
    mitigation: "UD-03",
    textJa:
      "不審なメールが自社から送られていることに気づいたとき、取引先へ速やかに知らせる手順と連絡先はありますか",
    choices: [
      { id: "present", labelJa: "手順と連絡先がある", status: "present" },
      { id: "absent", labelJa: "手順はない", status: "absent" },
      UNKNOWN,
    ],
  },
  {
    mitigation: "UD-02",
    textJa: "保守用の遠隔接続は、作業のときだけ有効にしていますか",
    choices: [
      {
        id: "on_demand",
        labelJa: "作業のときだけ有効にする",
        status: "present",
        attrs: { alwaysOn: false },
      },
      {
        id: "always_on",
        labelJa: "常時つながっている",
        status: "absent",
        attrs: { alwaysOn: true },
      },
      UNKNOWN,
    ],
  },
];

const byId = new Map(defs.map((d) => [d.mitigation, d]));

/** 緩和策の質問。役割を渡せば、役割ごとの文言（byRole）を当てはめた 1 問を返す */
export function questionFor(mitigation: string, role?: string): QuestionDef | undefined {
  const q = byId.get(mitigation);
  if (!q) return undefined;
  const variant = role ? q.byRole?.[role] : undefined;
  if (!variant) return q;
  const { byRole: _byRole, hintJa: _hint, ...rest } = q;
  return {
    ...rest,
    textJa: variant.textJa,
    ...(variant.hintJa ? { hintJa: variant.hintJa } : {}),
    ...(variant.choices ? { choices: variant.choices } : {}),
  };
}
export function allQuestions(): QuestionDef[] {
  return defs;
}

/** 質問の背景：手法 ID、緩和策 ID、ルールの判定の材料 */
export type Background = {
  techniqueId?: string;
  techniqueLabelJa?: string;
  mitigationId: string;
  mitigationLabelJa: string;
  materialsJa?: string;
  ruleId?: string;
};

/** 資産の役割に当たるルールから、質問の背景を組み立てる */
export function backgroundFor(
  mitigation: string,
  role: string | undefined,
  knowledge: Pick<Knowledge, "rules" | "labels">,
): Background {
  const refers = (r: Rule) => r.mitigations.includes(mitigation);
  const rule =
    knowledge.rules.find((r) => r.role === role && refers(r)) ?? knowledge.rules.find(refers);
  const technique = rule?.techniques[0];
  const labels = knowledge.labels;
  const bg: Background = {
    mitigationId: mitigation,
    mitigationLabelJa:
      labels.mitigations[mitigation] ?? labels.custom[mitigation]?.labelJa ?? mitigation,
  };
  if (technique) {
    bg.techniqueId = technique;
    const t = labels.techniques[technique];
    if (t) bg.techniqueLabelJa = t;
  }
  if (rule) {
    bg.ruleId = rule.id;
    if (rule.materialsJa && rule.materialsJa !== "―") bg.materialsJa = rule.materialsJa;
  }
  return bg;
}
