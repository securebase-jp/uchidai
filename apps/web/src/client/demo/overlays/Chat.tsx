/**
 * 社長と担当者のチャット風の演出（場面 1・2・9）。比喩は使わず、簡素に。
 * 文字は overlay が出てからの経過秒数（elapsed）から決める（一時停止すると止まる）。
 * chat-reply は場面 9 の途中（社長向けの一枚を見せたあと）から出るので、時刻は出た時点を 0 とする。
 */
import { useLayoutEffect, useRef } from "react";
import { useApp } from "../../hooks/useApp.tsx";
import { yen } from "../../lib/labels.ts";

type Variant = "chat-boss" | "chat-staff" | "chat-reply";
type Props = { variant: Variant; elapsed: number; seconds: number };

const IPA_TITLE = "被害事例1：VPN装置の脆弱性悪用によるランサムウェア感染";
const IPA_SUB = "IPA「中小企業のための実例で学ぶサイバーセキュリティリスク事例集」（2026年3月）";
const IPA_HOST = "ipa.go.jp";
/** サイバー攻撃の被害を伝える記事だと、前提知識のない人にも分かるようにする札と要約（題は実際の事例のまま） */
const IPA_TAG = "サイバー攻撃";
const IPA_SUMMARY =
  "ランサムウェア（データを人質に取るサイバー攻撃）で、製造業の業務が止まった事例";

/** 開始秒 from から 1 秒あたり cps 文字を打つ */
function typed(text: string, elapsed: number, from: number, cps = 9): string {
  if (elapsed < from) return "";
  return text.slice(0, Math.min(text.length, Math.floor((elapsed - from) * cps)));
}
/** from から打ち、hold 秒で消し始める */
function typedThenDeleted(text: string, elapsed: number, from: number, hold: number, cps = 9) {
  const full = typed(text, elapsed, from, cps);
  if (elapsed < hold) return full;
  const removed = Math.floor((elapsed - hold) * cps * 2);
  return text.slice(0, Math.max(0, text.length - removed));
}

/** 動きを減らす設定か（画面の設定を優先し、なければ OS の設定） */
function reducedMotion(): boolean {
  const set = document.documentElement.dataset.reduced;
  if (set === "true") return true;
  if (set === "false") return false;
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** chat-reply の時刻：一枚を送る、社長が入力中になる、一拍おいて返事が出る */
const T_SHEET = 0.3;
const T_BOSS_TYPING = 2.6;
const T_BOSS_REPLY = 4.8;

/** chat-staff の時刻：入力欄で打ち始める（チャットにも「入力中」を出す）、打ち終えて送る */
const T_STAFF_TYPING = 1.2;
const T_STAFF_SENT = 13.2;

/** 情シス担当の返答が出てから、社長が読んだことにするまでの秒数 */
const READ_AFTER = 1;

/** 社長は左、情シス担当は右から出す。時刻は吹き出しの外側の下端、既読は情シス担当の吹き出しの下 */
function Bubble({
  who,
  children,
  card,
  time,
  read,
}: {
  who: "boss" | "staff";
  children?: React.ReactNode;
  card?: React.ReactNode;
  time?: string;
  read?: boolean;
}) {
  const stamp = time && <span className="chat-time">{time}</span>;
  return (
    <div className={`chat-msg ${who}`}>
      <div className="chat-avatar" aria-hidden="true">
        {who === "boss" ? "社長" : "情シス"}
      </div>
      <div className="chat-body">
        <div className="chat-name">{who === "boss" ? "社長" : "情シス担当"}</div>
        {card && (
          <div className="chat-line">
            {card}
            {!children && stamp}
          </div>
        )}
        {children && (
          <div className="chat-line">
            <div className="chat-bubble">{children}</div>
            {stamp}
          </div>
        )}
        {read && <div className="chat-read">既読</div>}
      </div>
    </div>
  );
}

function LinkCard({
  title,
  sub,
  host,
  tag,
  summary,
}: {
  title: string;
  sub: string;
  host: string;
  tag?: string;
  summary?: string;
}) {
  return (
    <div className="chat-card">
      <div className="chat-card-host">
        {tag && <span className="chat-card-tag">{tag}</span>}
        {host}
      </div>
      <div className="chat-card-title">{title}</div>
      {summary && <div className="chat-card-summary">{summary}</div>}
      <div className="chat-card-sub">{sub}</div>
    </div>
  );
}

function Typing() {
  return (
    <span className="chat-typing" role="img" aria-label="入力中">
      <i />
      <i />
      <i />
    </span>
  );
}

export function ChatOverlay({ variant, elapsed }: Props) {
  const app = useApp();
  const ev = app.evaluation;
  const company = app.profile?.companyName ?? "うちの会社";
  // 既読：情シス担当の返答が出て 1 秒後（動きを減らす設定では最初から）
  const reduced = reducedMotion();
  const isRead = (shownAt: number) => reduced || elapsed >= shownAt + READ_AFTER;

  // 吹き出しは上から下へ積む（ふつうのチャットと同じ）。窓に収まらなくなったときだけ、新しい発言が見えるよう下へ送る
  const logRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const over = el.scrollHeight > el.clientHeight + 1;
    el.dataset.overflow = over ? "true" : "false";
    if (over) el.scrollTop = el.scrollHeight;
  });

  const history = (
    <>
      <Bubble
        who="boss"
        time="8:41"
        card={
          <LinkCard
            title={IPA_TITLE}
            sub={IPA_SUB}
            host={IPA_HOST}
            tag={IPA_TAG}
            summary={IPA_SUMMARY}
          />
        }
      />
      <Bubble who="boss" time="8:41">
        これ、うちは大丈夫？
      </Bubble>
    </>
  );

  return (
    <div className="demo-overlay chat" role="dialog" aria-label="社内チャット（演出）">
      <div className="chat-window">
        <div className="chat-head">
          <span>社内チャット</span>
          <span className="muted">社長、情シス担当</span>
        </div>
        <div className="chat-log" ref={logRef}>
          {variant === "chat-boss" && (
            <>
              {elapsed >= 1 && (
                <Bubble
                  who="boss"
                  time="8:41"
                  card={
                    <LinkCard
                      title={IPA_TITLE}
                      sub={IPA_SUB}
                      host={IPA_HOST}
                      tag={IPA_TAG}
                      summary={IPA_SUMMARY}
                    />
                  }
                />
              )}
              {elapsed >= 4 && (
                <Bubble who="boss" time="8:41">
                  {typed("これ、うちは大丈夫？", elapsed, 4, 6)}
                </Bubble>
              )}
              {elapsed >= 10 && (
                <Bubble who="staff">
                  <Typing />
                </Bubble>
              )}
            </>
          )}
          {variant === "chat-staff" && (
            <>
              {history}
              {/* 入力欄で打っているあいだ、チャットの側にも「入力中」を出す（打ち終えて送るまで） */}
              {elapsed >= T_STAFF_TYPING && elapsed < T_STAFF_SENT && (
                <Bubble who="staff">
                  <Typing />
                </Bubble>
              )}
              {elapsed >= T_STAFF_SENT && (
                <Bubble who="staff" time="8:53" read={isRead(T_STAFF_SENT)}>
                  少し時間をください。調べます。
                </Bubble>
              )}
            </>
          )}
          {variant === "chat-reply" && (
            <>
              {history}
              <Bubble who="staff" time="8:53" read>
                少し時間をください。調べます。
              </Bubble>
              {elapsed >= T_SHEET && (
                <Bubble
                  who="staff"
                  time="10:12"
                  read={isRead(T_SHEET)}
                  card={
                    <div className="chat-card sheet">
                      <div className="chat-card-host">社長向けの一枚　／　{company}</div>
                      <div className="chat-card-title">
                        {ev?.verdict.headlineJa ?? "うちの会社は、大丈夫ではありませんでした"}
                      </div>
                      <ul className="chat-card-list">
                        <li>
                          止まる業務：
                          {ev?.verdict.impact.stopped.map((s) => s.name).join("・") || "—"}（最長{" "}
                          {ev?.verdict.impact.downtimeDays ?? 0} 日）
                        </li>
                        <li>売上への影響の目安：{yen(ev?.verdict.impact.revenueImpactJpy)}</li>
                        <li>
                          期限：
                          {ev?.verdict.timeline
                            .filter((e) => e.kind === "legal" || e.kind === "insurance")
                            .slice(0, 2)
                            .map((e) => `${e.day} 日目 ${e.labelJa.replace(/（.*$/, "")}`)
                            .join("、") || "—"}
                        </li>
                        <li>必要な対策：VPN 装置の更新（保守ベンダーに依頼）ほか</li>
                      </ul>
                      <div className="chat-card-sub">
                        リンクを開くとスマホでも読めます・PDF にも
                      </div>
                    </div>
                  }
                >
                  {typed(
                    "まとめました。結論と、やることと、費用の目安です。",
                    elapsed,
                    T_SHEET + 0.5,
                    10,
                  )}
                </Bubble>
              )}
              {elapsed >= T_BOSS_TYPING && elapsed < T_BOSS_REPLY && (
                <Bubble who="boss">
                  <Typing />
                </Bubble>
              )}
              {elapsed >= T_BOSS_REPLY && (
                <Bubble who="boss" time="10:14">
                  {typed("じゃあ、それやろう", elapsed, T_BOSS_REPLY, 7)}
                </Bubble>
              )}
            </>
          )}
        </div>
        <div className="chat-compose">
          {variant === "chat-staff" ? (
            <div className="chat-input">
              {elapsed < T_STAFF_SENT ? (
                <>
                  {elapsed < 8.5
                    ? typedThenDeleted("たぶん大丈夫だと思いますが…", elapsed, T_STAFF_TYPING, 6, 6)
                    : typed("少し時間をください。調べます。", elapsed, 9, 7)}
                  <span className="chat-caret" aria-hidden="true" />
                </>
              ) : (
                <span className="muted">メッセージを入力</span>
              )}
            </div>
          ) : (
            <div className="chat-input muted">メッセージを入力</div>
          )}
          <button type="button" className="btn sm" tabIndex={-1} aria-hidden="true">
            送信
          </button>
        </div>
      </div>
      <p className="demo-fine">演出です。会社・人物・やりとりはすべて架空です。</p>
    </div>
  );
}
