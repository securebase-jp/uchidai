/**
 * デモモードの URL パラメータ（?demo=1&scene=N&autostart=1&captions=1&hud=1&controls=0&police=1）。
 * 画面側（確認依頼の再適用など）も「いまはデモか」をここで見る
 */
export type DemoParams = {
  on: boolean;
  startIndex: number;
  autostart: boolean;
  captions: boolean;
  hud: boolean;
  /** 画面下の操作バー。?controls=0 で出さない（録画用） */
  controls: boolean;
  /** 警察庁の数字の小さな表示。&police=1 で出す、&police=0 で消す（指定がなければ storyboard.json の options） */
  police: boolean | undefined;
};

export function parseDemoParams(search: string = location.search): DemoParams {
  const p = new URLSearchParams(search);
  const n = Number(p.get("scene") ?? "1");
  return {
    on: p.get("demo") === "1",
    startIndex: Number.isFinite(n) && n >= 1 ? Math.floor(n) - 1 : 0,
    autostart: p.get("autostart") === "1",
    captions: p.get("captions") === "1",
    hud: p.get("hud") === "1",
    controls: p.get("controls") !== "0",
    police: p.get("police") === "1" ? true : p.get("police") === "0" ? false : undefined,
  };
}

/** デモモードか（?demo=1）。送信箱の古い回答を再適用しない、などの判断に使う */
export function isDemoMode(): boolean {
  return typeof location !== "undefined" && parseDemoParams().on;
}
