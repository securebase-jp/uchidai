/**
 * 攻撃者の画面（再現イメージ）。手法 ID と結果を一行ずつ打ち込む。
 * 実際の攻撃手順は書かない。AI攻撃者（source: ai）の経路は別枠に流す。
 */
import { useEffect, useRef, useState } from "react";
import type { Scene } from "../lib/playback.ts";
import { InfoButton } from "./InfoButton.tsx";

function Line({
  text,
  tone,
  ai,
  reduced,
}: {
  text: string;
  tone: string;
  ai: boolean;
  reduced: boolean;
}) {
  const [n, setN] = useState(reduced ? text.length : 0);
  useEffect(() => {
    if (reduced) return;
    let i = 0;
    const id = setInterval(() => {
      i += 2;
      setN(Math.min(text.length, i));
      if (i >= text.length) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
  }, [text, reduced]);
  return (
    <p className={`ln tone-${tone}${ai ? " ai" : ""}`}>
      <span className="pr">&gt; </span>
      {text.slice(0, n)}
    </p>
  );
}

export function AttackerLog({
  scene,
  reduced,
  attackVersion,
}: {
  scene: Scene;
  reduced: boolean;
  attackVersion: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const normal = scene.logs.filter((l) => !l.ai);
  const ai = scene.logs.filter((l) => l.ai);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 行が増えたら末尾へ
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [scene.logs.length]);
  return (
    <aside className="term" ref={ref} aria-label="攻撃者の画面（再現イメージ）">
      <div className="hd">
        <span>
          攻撃者の画面（再現イメージ）
          <InfoButton title="この画面について">
            <p>
              動きの説明のための再現イメージです。手法は MITRE ATT&amp;CK の ID
              と名前の水準までで、実際の攻撃手順・コマンド・製品名は含みません。
            </p>
            <p>AI攻撃者が見つけた経路は、プログラムが検証したものだけを別枠に流します。</p>
          </InfoButton>
        </span>
        <span>ATT&amp;CK v{attackVersion}</span>
      </div>
      {normal.length === 0 && (
        <p className="ln" style={{ color: "var(--term-dim)" }}>
          （待機中）
        </p>
      )}
      {normal.map((l) => (
        <Line key={`${l.at}-${l.text}`} text={l.text} tone={l.tone} ai={false} reduced={reduced} />
      ))}
      {ai.length > 0 && (
        <>
          <div className="ai-hd">AIが見つけた経路（検証済みのものだけ）</div>
          {ai.map((l) => (
            <Line key={`${l.at}-${l.text}`} text={l.text} tone={l.tone} ai reduced={reduced} />
          ))}
        </>
      )}
      {!scene.concluded && (
        <div>
          <span className="cur" aria-hidden="true" />
        </div>
      )}
    </aside>
  );
}
