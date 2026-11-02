/**
 * デモの差し込み口に入れる部品：S6（AI攻撃者・比較）と S7（確認依頼）の実際の画面を、
 * 場面の開始時に自動で動かして右下に重ねる
 */
import { useEffect, useRef } from "react";
import { AiAttackerPanel } from "../components/AiAttackerPanel.tsx";
import { ComparisonPanel } from "../components/ComparisonPanel.tsx";
import { RequestPanel } from "../components/RequestPanel.tsx";
import { useAiAttacker } from "../hooks/useAiAttacker.tsx";
import { useApp } from "../hooks/useApp.tsx";
import { useRequests } from "../hooks/useRequests.ts";
import type { SlotProps } from "./slots.tsx";

/** AI攻撃者：場面に入ったら記録した下見の出力を再生し（毎回同じ映像にする）、過程と結果を表示 */
export function AiAttackerSlot(_props: SlotProps) {
  const app = useApp();
  const ai = useAiAttacker();
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !app.evaluation || ai.busy || ai.paths.length > 0) return;
    started.current = true;
    void ai.run({ replay: true });
  }, [app.evaluation, ai]);
  if (!app.evaluation || !app.knowledge) return null;
  return (
    <div className="demo-slot full">
      <AiAttackerPanel
        graph={app.evaluation.graph}
        verdict={app.evaluation.verdict}
        labels={app.knowledge.labels}
        measures={app.knowledge.measures}
        reduced={false}
      />
    </div>
  );
}

/** 知見なし AI との比較：場面に入ったら取り寄せ（キーが無ければ記録を再生）、3 列で表示 */
export function ComparisonSlot(_props: SlotProps) {
  const app = useApp();
  const ai = useAiAttacker();
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !app.evaluation || ai.compareBusy || ai.comparison) return;
    started.current = true;
    void ai.runCompare();
  }, [app.evaluation, ai]);
  return (
    <div className="demo-slot full">
      <ComparisonPanel />
    </div>
  );
}

/** ベンダーへの確認：場面に入ったら管理者権限（M1026）の確認依頼を 1 件作って送信箱に出す。回答は絵コンテの answers 操作で入る */
export function RequestSlot(_props: SlotProps) {
  const app = useApp();
  const req = useRequests();
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !app.profile || req.busyKey) return;
    const open = req.items.some((r) => r.assetId === "admin" && r.mitigation === "M1026");
    if (open) return;
    started.current = true;
    void req.create("admin", "M1026");
  }, [app.profile, req]);
  return (
    <div className="demo-slot full">
      <RequestPanel />
    </div>
  );
}
