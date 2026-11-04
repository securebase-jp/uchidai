/**
 * 一枚の操作列の「PDF をダウンロード」（主）と「印刷する」（副）。
 * ダウンロードは印刷ダイアログを使わず、ブラウザの中で .pdf を作って保存する（exportPdf.ts）。
 * 失敗したときは理由と「印刷ダイアログで開く」を出す。
 */
import { useEffect, useRef, useState } from "react";
import { InfoButton } from "../components/InfoButton.tsx";

type State = { status: "idle" } | { status: "working" } | { status: "error"; messageJa: string };

export function PdfActions({ filename }: { filename: string | undefined }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // 別の一枚に変わったら、前の失敗の知らせは消す
  // biome-ignore lint/correctness/useExhaustiveDependencies: 一枚（ファイル名）が変わったときだけ戻す
  useEffect(() => setState({ status: "idle" }), [filename]);

  async function download() {
    const sheet = document.querySelector<HTMLElement>(".onepager .op-sheet");
    if (!sheet || !filename) return;
    setState({ status: "working" });
    try {
      // 重いライブラリは、押したときに読み込む
      const { renderOnePagerPdf, saveBlob } = await import("./exportPdf.ts");
      saveBlob(await renderOnePagerPdf(sheet), filename);
      if (alive.current) setState({ status: "idle" });
    } catch (e) {
      if (alive.current)
        setState({
          status: "error",
          messageJa: e instanceof Error && e.message ? e.message : "原因は分かりませんでした",
        });
    }
  }

  const working = state.status === "working";
  return (
    <>
      <button
        type="button"
        className="btn primary"
        onClick={() => void download()}
        disabled={!filename || working}
        aria-busy={working}
      >
        {working ? "作っています…" : "PDF をダウンロード"}
      </button>
      <button type="button" className="btn" onClick={() => window.print()} disabled={working}>
        印刷する
      </button>
      <InfoButton title="PDF について" align="end">
        <p>
          「PDF
          をダウンロード」は、このブラウザの中だけで一枚をファイルにします。会社の情報をサーバに送ることはありません。
        </p>
        <p>
          紙面は画像として貼り付けるため、PDF の中の文字は選択できません。文字を選べる PDF
          がほしいときは、「印刷する」から出る印刷ダイアログで「PDF として保存」を選んでください。
        </p>
      </InfoButton>
      {state.status === "error" && (
        <p className="err small" role="alert" style={{ flexBasis: "100%", margin: 0 }}>
          PDF を作れませんでした（{state.messageJa}）。
          <button type="button" className="btn sm" onClick={() => window.print()}>
            印刷ダイアログで開く
          </button>
        </p>
      )}
    </>
  );
}
