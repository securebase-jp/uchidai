/**
 * セキュリティ診断（docs/security-review-2026-11-06.md）で確かめた、メールの組み立て。
 * nodemailer は streamTransport（送らずに文面を組むだけ）で動かす。外へ出る通信はしない。
 */
import { createTransport } from "nodemailer";
import { describe, expect, it } from "vitest";
import { CreateRequest } from "../../shared/requests.ts";
import { mailtoUrl } from "./mailer.ts";

describe("mailto: の組み立て（問題なかったもの）", () => {
  it("件名・本文の改行と & は百分率符号化され、別のヘッダを足せない", () => {
    const url = mailtoUrl({
      to: "vendor@example.com",
      subject: "x\r\nBcc: other@example.com",
      text: "hi&cc=other@example.com",
    });
    expect(url.startsWith("mailto:vendor%40example.com?")).toBe(true);
    expect(url).not.toMatch(/[\r\n]/);
    expect(url).not.toContain("&cc=");
    expect(url).toContain("subject=x%0D%0ABcc");
  });
  it("宛先の ? と & も符号化され、宛先の中からクエリを足せない", () => {
    const url = mailtoUrl({ to: "a@example.com?bcc=b@example.com", subject: "s", text: "t" });
    expect(url.split("?").length).toBe(2);
  });
});

describe("SMTP（nodemailer 10）のヘッダ注入（問題なかったもの）", () => {
  it("件名と宛先に CR LF を入れても、別のヘッダ行にならない", async () => {
    const transport = createTransport({ streamTransport: true, newline: "unix", buffer: true });
    const info = await transport.sendMail({
      from: "uchidai@localhost",
      to: "vendor@example.com\r\nBcc: other@example.com",
      subject: "x\r\nX-Injected: 1",
      text: "body",
    });
    const raw = String(info.message);
    const headers = raw.split("\n\n")[0] ?? "";
    expect(headers).not.toMatch(/^Bcc:/m);
    expect(headers).not.toMatch(/^X-Injected:/m);
  });
});

describe("SEC-007：宛先（to）の形を検証していない", () => {
  it("複数の宛先やアドレスでない文字列も受け付ける", () => {
    const base = {
      profile: { companyName: "テスト", assets: [{ id: "a", role: "r", label: "l" }] },
      assetId: "a",
      mitigation: "M1032",
    };
    expect(CreateRequest.safeParse({ ...base, to: "a@example.com, b@example.com" }).success).toBe(
      true,
    );
    expect(CreateRequest.safeParse({ ...base, to: "not an address" }).success).toBe(true);
  });
});
