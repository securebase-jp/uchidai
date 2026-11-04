/**
 * トップ画面（#/）の 5 段の手順と「いまの状態」を決める純粋な関数。
 * 画面の状態（外部確認の記録、会社カルテ、選んだ事例）から、各段の状態（短い語と、詳しい文）と色を組む。判定はしない。
 * 画面には短い語（shortJa）だけを出し、詳しい文（statusJa・noteJa）は各段の情報ボタンの中に出す。
 */

export type StepId = "domain" | "questions" | "profile" | "article" | "result";
/** done：済み、todo：まだ、optional：任意で未実施、warn：済みだが未確認が残る */
export type StepTone = "done" | "todo" | "optional" | "warn";

export type HomeInput = {
  /** 外部確認（#/domain）の記録。無ければ未実施 */
  recon: { domain: string; fixture: boolean; checkedAt: string } | undefined;
  /** 会社カルテ（このブラウザに保存されているもの） */
  profile: { companyName: string; fictional: boolean; pending: number } | undefined;
  profileSource: "example" | "answers" | "saved" | undefined;
  /** いま選んでいる事例。recordedId があれば記録済みの読解結果。chosen: false はデモ・録画の URL が読んだ既定の事例（通常は事例を空で始める） */
  theCase: { title: string; recordedId?: string; chosen?: boolean } | undefined;
  /** 日時の表示（テストで固定できるように差し替え可） */
  formatDateTime?: (iso: string) => string;
};

export type HomeStep = {
  id: StepId;
  n: number;
  titleJa: string;
  /** 短い定義（何をする段か） */
  leadJa: string;
  /** カードに出す短い状態（「確認済み」「架空の会社」「事例 1」など） */
  shortJa: string;
  /** 詳しい状態の文（画面には常時出さず、情報ボタンの中に出す） */
  statusJa: string;
  /** 状態の補足（画面には常時出さず、情報ボタンの中に出す） */
  noteJa?: string;
  tone: StepTone;
  /** 主な導線。article は画面内の入力欄なので無い */
  href?: string;
  actionJa?: string;
  /** 前の段が済んでいないので、まだ押せない */
  disabled?: boolean;
};

/** 日時は月/日だけの短い形（11/3）にする */
export const defaultFormatDateTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getMonth() + 1}/${d.getDate()}`;
};

/** 上部の進み具合で強調する「いまの段」：最初の未・要確認の段（任意の段は飛ばす）。すべて済んでいれば最後の段 */
export function currentStepId(steps: HomeStep[]): StepId {
  const step = steps.find((s) => s.tone === "todo" || s.tone === "warn");
  return (step ?? steps[steps.length - 1])?.id ?? "domain";
}

/** 記録済みの事例の番号（ipa-case-1 → 「 1 」）。番号が取れなければ空 */
const recordedNo = (id: string | undefined): string => {
  const m = id?.match(/(\d+)$/);
  return m ? ` ${m[1]} ` : "";
};

/** 事例の短い状態：記録済みは「事例 1」、読んだ記事は「記事」 */
const shortCase = (c: { recordedId?: string | undefined }): string => {
  if (!c.recordedId) return "記事";
  const no = c.recordedId.match(/(\d+)$/)?.[1];
  return no ? `事例 ${no}` : "記録済み";
};

export function homeSteps(input: HomeInput): HomeStep[] {
  const fmt = input.formatDateTime ?? defaultFormatDateTime;
  const { recon, profile, profileSource, theCase } = input;

  const domain: HomeStep = recon
    ? {
        id: "domain",
        n: 1,
        titleJa: "自社のドメインを外から見る",
        leadJa:
          "DNS の公開レコードと証明書の公開ログだけから、VPN らしいホスト名や SPF・DMARC を確かめます。",
        shortJa: recon.fixture ? "架空のドメイン" : "確認済み",
        statusJa: recon.fixture
          ? `架空のドメイン ${recon.domain} の記録を再生（${fmt(recon.checkedAt)}）`
          : `${recon.domain} を確認済み（${fmt(recon.checkedAt)}）`,
        tone: "done",
        href: "#/domain",
        actionJa: "もう一度見る",
      }
    : {
        id: "domain",
        n: 1,
        titleJa: "自社のドメインを外から見る",
        leadJa:
          "DNS の公開レコードと証明書の公開ログだけから、VPN らしいホスト名や SPF・DMARC を確かめます。",
        shortJa: "未実施",
        statusJa: "未実施",
        noteJa: "任意です。結果は 5 問の初期値とカルテの属性になります。",
        tone: "optional",
        href: "#/domain",
        actionJa: "ドメインを外から見る",
      };

  const questions: HomeStep = {
    id: "questions",
    n: 2,
    titleJa: "最初の5問に答える",
    leadJa:
      "業種、現場、置き場所、社外からのつなぎ方、バックアップ。選択式だけで構成図の枠ができます。",
    ...(profile
      ? {
          shortJa:
            profileSource === "answers"
              ? "回答済み"
              : profileSource === "example"
                ? "架空の会社"
                : "保存済み",
          statusJa:
            profileSource === "answers"
              ? `回答済み：${profile.companyName}`
              : profileSource === "example"
                ? `架空の会社：${profile.companyName}（自社のカルテではありません）`
                : `このブラウザに保存済みのカルテ：${profile.companyName}`,
          tone: "done" as const,
          actionJa: "もう一度答える（カルテを作り直す）",
        }
      : {
          shortJa: "未回答",
          statusJa: "まだ答えていません",
          tone: "todo" as const,
          actionJa: "最初の5問に答える",
        }),
    href: "#/questions",
  };

  const profileStep: HomeStep = {
    id: "profile",
    n: 3,
    titleJa: "カルテの詳細を登録する",
    leadJa:
      "対策の有無を自分で答えるか、ベンダーに聞きます。数値（人数、1 日の売上、復旧日数）も入れます。未確認は「止まる」とは扱いません。",
    href: "#/profile",
    ...(!profile
      ? {
          shortJa: "カルテなし",
          statusJa: "カルテがまだありません（5問に答えると枠ができます）",
          tone: "todo" as const,
          actionJa: "カルテを開く",
          disabled: true,
        }
      : profileSource === "example" || profile.fictional
        ? {
            shortJa: "架空の会社",
            statusJa: `架空の会社：${profile.companyName}（登録は要りません）`,
            tone: "done" as const,
            actionJa: "カルテを見る",
          }
        : profile.pending > 0
          ? {
              shortJa: `未確認 ${profile.pending} 件`,
              statusJa: `未確認 ${profile.pending} 件`,
              noteJa: "未確認が残る間、結論は最悪の想定か「確認中」になります。",
              tone: "warn" as const,
              actionJa: "未確認を減らす",
            }
          : {
              shortJa: "未確認 0 件",
              statusJa: "未確認 0 件",
              tone: "done" as const,
              actionJa: "カルテを見直す",
            }),
  };

  const article: HomeStep = {
    id: "article",
    n: 4,
    titleJa: "記事を貼る",
    leadJa:
      "報道記事の URL・本文・PDF を Claude が読み、攻撃の段階を手法 ID に対応づけます。キーが無ければ記録済みの事例から選びます。",
    // 事例は担当者が選ぶ（初期値は空）。「未」は事例も記事も無いときだけ。chosen: false はデモ・録画の URL が読んだ既定の事例
    ...(theCase && theCase.chosen === false
      ? {
          shortJa: shortCase(theCase),
          statusJa: `記録済みの事例${recordedNo(theCase.recordedId)}を使用中：${theCase.title}`,
          noteJa:
            "担当者が選んだ事例ではなく、既定の事例です。記事を貼るか、記録済みの事例から選ぶと差し替わります。",
          tone: "done" as const,
        }
      : theCase
        ? {
            shortJa: shortCase(theCase),
            statusJa: theCase.recordedId
              ? `記録済みの事例${recordedNo(theCase.recordedId)}を使用中：${theCase.title}`
              : `記事を使用中：${theCase.title}`,
            tone: "done" as const,
          }
        : { shortJa: "未選択", statusJa: "事例を選んでください", tone: "todo" as const }),
  };

  const ready = Boolean(profile && theCase);
  const result: HomeStep = {
    id: "result",
    n: 5,
    titleJa: "結論を見る",
    leadJa:
      "記事と同じ攻撃が自社の構成をどう進むかを再生し、止められるかを根拠つきで示します。社長向けの一枚にまとめます。",
    shortJa: ready ? "見られる" : "待ち",
    statusJa: ready
      ? "結論を見られます"
      : !profile && !theCase
        ? "カルテと事例が揃うと見られます"
        : !profile
          ? "カルテができると見られます"
          : "事例を選ぶと見られます",
    tone: ready ? "done" : "todo",
    href: "#/staff",
    actionJa: "担当者画面",
    ...(ready ? {} : { disabled: true }),
  };

  return [domain, questions, profileStep, article, result];
}
