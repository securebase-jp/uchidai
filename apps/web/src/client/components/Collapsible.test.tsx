import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Collapsible } from "./Collapsible.tsx";
import { StaffBar } from "./StaffBar.tsx";

const body = createElement("p", null, "中身");
const html = (props: Partial<Parameters<typeof Collapsible>[0]>) =>
  renderToStaticMarkup(
    <Collapsible id="staff-x" title="比較" {...props}>
      {body}
    </Collapsible>,
  );

describe("Collapsible", () => {
  it("既定は閉じる：見出しのボタンは aria-expanded=false で、中身は hidden（読み込んだまま）", () => {
    const m = html({});
    expect(m).toContain('aria-expanded="false"');
    expect(m).toMatch(/hidden=""[^>]*class="coll-body"|class="coll-body"[^>]*hidden=""/);
    expect(m).toContain("中身");
    expect(m).toContain("比較");
  });
  it("forceOpen のときは開く", () => {
    const m = html({ forceOpen: true, badge: "未確認 2 件" });
    expect(m).toContain('aria-expanded="true"');
    expect(m).not.toContain(`hidden=""`);
    expect(m).toContain("未確認 2 件");
  });
  it("デモモード（plain）は枠を足さず、従来の余白の div だけ。id は従来のものだけ付く", () => {
    expect(html({ plain: true })).toBe('<div style="margin-top:12px"><p>中身</p></div>');
    expect(html({ plain: true, legacyId: "staff-evidence" })).toBe(
      '<div style="margin-top:12px" id="staff-evidence"><p>中身</p></div>',
    );
  });
});

describe("StaffBar", () => {
  const toc = [
    ["staff-verdict", "結論"],
    ["staff-requests", "確認依頼"],
  ] as const;
  it("件数と目次を出す。0 件は zero の印が付く", () => {
    const m = renderToStaticMarkup(
      createElement(StaffBar, {
        counts: { pending: 3, waiting: 1, answered: 0 },
        toc,
        requestsId: "staff-requests",
        outboxId: "staff-outbox",
        onJump: () => {},
      }),
    );
    expect(m).toContain("未確認 <b>3</b> 件");
    expect(m).toContain("依頼済み <b>1</b> 件");
    expect(m).toMatch(/bar-stat zero[^>]*>回答あり/);
    expect(m).toContain("確認依頼");
  });
});
