import { describe, expect, it } from "vitest";
import { reconToAnswers, reconToAssetHints } from "./answers.ts";
import { fixtureSources, loadDemoFixture, ReconFixture } from "./fixture.ts";
import { verifyOwnership } from "./ownership.ts";
import { guessMailProvider, parseDmarc, parseSpf, recon } from "./recon.ts";
import type { CtLogSource, DnsResolver } from "./sources.ts";
import { ReconResult } from "./types.ts";

const fixture = loadDemoFixture();
const { resolver, ct } = fixtureSources(fixture);
const domain = fixture.domain;
const now = () => new Date("2026-11-02T09:00:00Z");

async function run(overrides: { ct?: CtLogSource } = {}) {
  const check = await verifyOwnership(domain, fixture.verificationToken ?? "", { resolver });
  if (!check.ok) throw new Error(check.reasonJa);
  return recon(domain, { ownership: check.verified, resolver, ct: overrides.ct ?? ct, now });
}

describe("recon（デモ用 fixture）", () => {
  it("結果は zod のスキーマに一致し、出どころは fixture", async () => {
    const result = await run();
    expect(ReconResult.parse(result)).toEqual(result);
    expect(result.sources).toEqual({ dns: "fixture", ct: "fixture" });
    expect(result.checkedAt).toBe("2026-11-02T09:00:00.000Z");
    expect(result.notesJa).toEqual([]);
  });

  it("CT のホスト名は重複を除き、ワイルドカードと有効期限を持つ", async () => {
    const result = await run();
    const names = result.hostnames.map((h) => h.name);
    expect(names).toEqual([
      "*.demo-seiko.example",
      "autodiscover.demo-seiko.example",
      "campaign2019.demo-seiko.example",
      "demo-seiko.example",
      "vpn.demo-seiko.example",
      "www.demo-seiko.example",
    ]);
    const www = result.hostnames.find((h) => h.name === "www.demo-seiko.example");
    expect(www?.certCount).toBe(2);
    expect(www?.activeCertCount).toBe(1);
    expect(www?.firstIssued).toBe("2026-06-01T00:00:00Z");
    expect(www?.lastExpiry).toBe("2026-11-30T23:59:59Z");
    expect(www?.resolves).toBe(true);
    const wildcard = result.hostnames.find((h) => h.wildcard);
    expect(wildcard?.name).toBe("*.demo-seiko.example");
    expect(wildcard?.resolves).toBeNull();
    const vpn = result.hostnames.find((h) => h.name === "vpn.demo-seiko.example");
    expect(vpn?.certCount).toBe(2);
    expect(vpn?.activeCertCount).toBe(1);
    expect(vpn?.addresses).toEqual(["203.0.113.10"]);
    expect(vpn?.sources).toEqual(["ct", "dns"]);
  });

  it("VPN 用と推定されるホスト名を根拠と IPA 事例番号つきで返す", async () => {
    const result = await run();
    expect(result.remoteAccessCandidates).toHaveLength(1);
    const c = result.remoteAccessCandidates[0];
    expect(c?.hostname).toBe("vpn.demo-seiko.example");
    expect(c?.kind).toBe("vpn");
    expect(c?.ipaCases).toEqual([8, 9]);
    expect(c?.evidence.some((e) => e.kind === "ct")).toBe(true);
    expect(c?.evidence.some((e) => e.kind === "dns" && e.value === "203.0.113.10")).toBe(true);
    expect(c?.reasonJa).toContain("DNS で名前も解決できる");
  });

  it("SPF あり（-all、Microsoft 365 の include）、DMARC なし", async () => {
    const result = await run();
    expect(result.mail.spf.present).toBe(true);
    expect(result.mail.spf.allMechanism).toBe("-all");
    expect(result.mail.spf.includes).toEqual(["spf.protection.outlook.com"]);
    expect(result.mail.spf.evidence[0]?.recordType).toBe("TXT");
    expect(result.mail.dmarc.present).toBe(false);
    expect(result.mail.dmarc.policy).toBeUndefined();
  });

  it("MX から Microsoft 365 と推定し、SPF の include からも同じサービスが分かる", async () => {
    const result = await run();
    expect(result.mail.provider.name).toBe("Microsoft 365");
    expect(result.mail.provider.kind).toBe("cloud");
    expect(result.mail.provider.evidence[0]?.value).toContain("mail.protection.outlook.com");
    expect(result.cloudServices.map((c) => c.name)).toEqual(["Microsoft 365"]);
  });

  it("ホームページはレンタルサーバ事業者の配下と推定（CNAME の根拠つき）", async () => {
    const result = await run();
    expect(result.web.hosting.kind).toBe("provider");
    expect(result.web.hosting.name).toBe("さくらインターネット");
    expect(result.web.records).toContainEqual({
      kind: "dns",
      recordType: "CNAME",
      name: "www.demo-seiko.example",
      value: "www0000.sakura.ne.jp",
    });
  });

  it("確認項目はカルテに合う（VPN 露出 warn、SPF ok、DMARC warn）", async () => {
    const result = await run();
    const byId = new Map(result.findings.map((f) => [f.id, f]));
    expect(byId.get("remote_access.vpn")?.severity).toBe("warn");
    expect(byId.get("remote_access.vpn")?.ipaCases).toEqual([8, 9]);
    expect(byId.get("remote_access.vpn")?.sourceJa).toContain("IPA");
    expect(byId.get("mail_auth.spf")?.severity).toBe("ok");
    expect(byId.get("mail_auth.dmarc")?.severity).toBe("warn");
    expect(byId.get("mail_provider.mx")?.titleJa).toContain("Microsoft 365");
    expect(byId.get("web_hosting.hint")?.titleJa).toContain("さくらインターネット");
    expect(byId.get("hostnames.ct")?.titleJa).toContain("6 件");
    expect(byId.has("remote_access.rdp")).toBe(false);
  });

  it("CT が参照できなくても DNS だけで続け、注記を残す", async () => {
    const broken: CtLogSource = {
      listCertificates: async () => {
        throw new Error("503");
      },
    };
    const result = await run({ ct: broken });
    expect(result.sources.ct).toBe("unavailable");
    expect(result.hostnames).toEqual([]);
    expect(result.remoteAccessCandidates).toEqual([]);
    expect(result.mail.spf.present).toBe(true);
    expect(result.notesJa[0]).toContain("crt.sh");
    expect(result.findings.find((f) => f.id === "hostnames.ct")?.titleJa).toContain(
      "参照できなかった",
    );
  });
});

describe("SPF / DMARC の読み取り", () => {
  it("SPF は v=spf1 の TXT だけを拾い、include・redirect・all を読む", () => {
    const spf = parseSpf("example.jp", [
      "MS=ms123",
      "v=spf1 ip4:203.0.113.0/24 include:_spf.google.com redirect=_spf.example.net ~all",
    ]);
    expect(spf.present).toBe(true);
    expect(spf.includes).toEqual(["_spf.google.com", "_spf.example.net"]);
    expect(spf.allMechanism).toBe("~all");
    expect(parseSpf("example.jp", ["v=spf1 -all"]).allMechanism).toBe("-all");
    expect(parseSpf("example.jp", ["v=spf1 all"]).allMechanism).toBe("+all");
    expect(parseSpf("example.jp", []).present).toBe(false);
  });
  it("DMARC は p と sp を読む", () => {
    const d = parseDmarc("example.jp", [
      "v=DMARC1; p=quarantine; sp=reject; rua=mailto:x@example.jp",
    ]);
    expect(d.present).toBe(true);
    expect(d.policy).toBe("quarantine");
    expect(d.subdomainPolicy).toBe("reject");
    expect(d.evidence[0]?.name).toBe("_dmarc.example.jp");
    expect(parseDmarc("example.jp", ["v=DMARC1; p=none"]).policy).toBe("none");
    expect(parseDmarc("example.jp", ["v=spf1 -all"]).present).toBe(false);
  });
});

describe("MX からの提供元の推定", () => {
  it("自社ドメイン内の MX は社内の可能性、表にないものは不明、MX なしも不明", () => {
    expect(
      guessMailProvider("example.jp", [{ exchange: "mail.example.jp", priority: 10 }]).kind,
    ).toBe("onprem");
    expect(
      guessMailProvider("example.jp", [{ exchange: "mx.unknown.example", priority: 10 }]).kind,
    ).toBe("unknown");
    expect(guessMailProvider("example.jp", []).kind).toBe("unknown");
  });
  it("Null MX（exchange が空や「.」）はメールを受け取らない宣言として扱う", () => {
    const guess = guessMailProvider("example.jp", [{ exchange: "", priority: 0 }]);
    expect(guess.kind).toBe("unknown");
    expect(guess.reasonJa).toContain("Null MX");
    expect(guessMailProvider("example.jp", [{ exchange: ".", priority: 0 }]).reasonJa).toContain(
      "Null MX",
    );
  });
  it("優先度の高い MX から見る。ゲートウェイは受信箱の提供元を不明とする", () => {
    const guess = guessMailProvider("example.jp", [
      { exchange: "mx0b-0001.pphosted.com", priority: 10 },
      { exchange: "example-jp.mail.protection.outlook.com", priority: 20 },
    ]);
    expect(guess.name).toBe("Proofpoint");
    expect(guess.kind).toBe("unknown");
  });
});

describe("推定の境界（fixture を組み替えて確かめる）", () => {
  const base = loadDemoFixture();
  async function runWith(fx: ReconFixture) {
    const sources = fixtureSources(fx);
    const check = await verifyOwnership(fx.domain, fx.verificationToken ?? "", {
      resolver: sources.resolver,
    });
    if (!check.ok) throw new Error(check.reasonJa);
    return recon(fx.domain, { ownership: check.verified, ...sources, now });
  }

  it("証明書が期限切れで DNS にも無い VPN 用の名前は「過去の痕跡」（current: false）で、推定やカルテの初期値には使わない", async () => {
    const fx = ReconFixture.parse({
      ...base,
      ct: [
        {
          issuer: "C=US, O=Old CA",
          names: ["remote.demo-seiko.example"],
          notBefore: "2019-01-01T00:00:00Z",
          notAfter: "2020-01-01T00:00:00Z",
        },
      ],
    });
    const result = await runWith(fx);
    expect(result.remoteAccessCandidates).toHaveLength(1);
    expect(result.remoteAccessCandidates[0]).toMatchObject({
      hostname: "remote.demo-seiko.example",
      current: false,
    });
    const finding = result.findings.find((f) => f.id === "remote_access.vpn");
    expect(finding?.severity).toBe("info");
    expect(finding?.titleJa).toContain("過去に");
    expect(reconToAnswers(result).answers.remoteAccess).toBeUndefined();
    expect(reconToAssetHints(result).some((h) => h.role === "entry.vpn")).toBe(false);
    // 把握していない資産の手がかりとして hostnames.ct に載る
    expect(result.findings.find((f) => f.id === "hostnames.ct")?.detailJa).toContain(
      "remote.demo-seiko.example",
    );
  });

  it("今も DNS で解決できる VPN 用の名前は current: true で warn", async () => {
    const result = await run();
    expect(result.remoteAccessCandidates[0]?.current).toBe(true);
    expect(result.findings.find((f) => f.id === "remote_access.vpn")?.severity).toBe("warn");
  });

  it("証明書が期限切れのまま DNS に残る名前は、IPA 事例 16 を添えて warn", async () => {
    const fx = ReconFixture.parse({
      ...base,
      dns: { ...base.dns, "shop.demo-seiko.example": { A: ["203.0.113.90"] } },
      ct: [
        ...base.ct,
        {
          issuer: "C=US, O=Let's Encrypt, CN=R3",
          names: ["shop.demo-seiko.example"],
          notBefore: "2024-01-01T00:00:00Z",
          notAfter: "2024-03-31T23:59:59Z",
        },
      ],
    });
    const result = await runWith(fx);
    const f = result.findings.find((x) => x.id === "certificates.expired");
    expect(f).toMatchObject({ severity: "warn", ipaCases: [16] });
    expect(f?.detailJa).toContain("shop.demo-seiko.example");
    expect(f?.detailJa).toContain("2024-03-31");
    // 今も有効な証明書がある www は載らない
    expect(f?.detailJa).not.toContain("www.demo-seiko.example");
  });

  it("ワイルドカード証明書の件数を hostnames.ct の説明に添える", async () => {
    const result = await run();
    expect(result.findings.find((f) => f.id === "hostnames.ct")?.detailJa).toContain(
      "ワイルドカード証明書（*.）が 1 件",
    );
  });

  it("証明書にホスト名として扱えない名前があれば、DNS に問い合わせずに注記する", async () => {
    const fx = ReconFixture.parse({
      ...base,
      ct: [
        ...base.ct,
        {
          issuer: "C=US, O=Weird CA",
          names: ["bad name.demo-seiko.example"],
          notBefore: "2026-01-01T00:00:00Z",
          notAfter: "2027-01-01T00:00:00Z",
        },
      ],
    });
    const calls: string[] = [];
    const sources = fixtureSources(fx);
    const r = sources.resolver;
    const spy: DnsResolver = {
      resolveTxt: (n) => r.resolveTxt(n),
      resolveMx: (n) => r.resolveMx(n),
      resolve6: (n) => r.resolve6(n),
      resolveCname: (n) => r.resolveCname(n),
      resolve4: async (name) => {
        calls.push(name);
        return r.resolve4(name);
      },
    };
    const check = await verifyOwnership(fx.domain, fx.verificationToken ?? "", { resolver: spy });
    if (!check.ok) throw new Error(check.reasonJa);
    const result = await recon(fx.domain, {
      ownership: check.verified,
      resolver: spy,
      ct: sources.ct,
      now,
    });
    expect(calls).not.toContain("bad name.demo-seiko.example");
    expect(result.notesJa.some((n) => n.includes("bad name.demo-seiko.example"))).toBe(true);
  });

  it("SPF のレコードが 2 件あれば warn（受信側で無効扱い）", async () => {
    const fx = ReconFixture.parse({
      ...base,
      dns: {
        ...base.dns,
        "demo-seiko.example": {
          ...base.dns["demo-seiko.example"],
          TXT: [
            ...(base.dns["demo-seiko.example"]?.TXT ?? []),
            "v=spf1 include:_spf.google.com ~all",
          ],
        },
      },
    });
    const result = await runWith(fx);
    const f = result.findings.find((x) => x.id === "mail_auth.spf");
    expect(f?.severity).toBe("warn");
    expect(f?.titleJa).toContain("2 件");
    expect(result.mail.spf.evidence).toHaveLength(2);
  });

  it("DMARC に p= が無ければ warn、2 件あっても warn", async () => {
    const one = ReconFixture.parse({
      ...base,
      dns: {
        ...base.dns,
        "_dmarc.demo-seiko.example": { TXT: ["v=DMARC1; rua=mailto:x@demo-seiko.example"] },
      },
    });
    const r1 = await runWith(one);
    expect(r1.mail.dmarc.present).toBe(true);
    expect(r1.mail.dmarc.policy).toBeUndefined();
    const f1 = r1.findings.find((x) => x.id === "mail_auth.dmarc");
    expect(f1?.severity).toBe("warn");
    expect(f1?.detailJa).toContain("p= の指定が読み取れない");
    const two = ReconFixture.parse({
      ...base,
      dns: {
        ...base.dns,
        "_dmarc.demo-seiko.example": { TXT: ["v=DMARC1; p=reject", "v=DMARC1; p=none"] },
      },
    });
    const f2 = (await runWith(two)).findings.find((x) => x.id === "mail_auth.dmarc");
    expect(f2?.severity).toBe("warn");
    expect(f2?.titleJa).toContain("2 件");
  });

  it("CNAME の連鎖（www → 自社の cdn → 事業者）を上限つきでたどり、事業者を推定する", async () => {
    const fx = ReconFixture.parse({
      ...base,
      dns: {
        ...base.dns,
        "www.demo-seiko.example": { CNAME: ["cdn.demo-seiko.example"] },
        "cdn.demo-seiko.example": { CNAME: ["www0000.sakura.ne.jp"] },
      },
    });
    const result = await runWith(fx);
    expect(result.web.hosting.name).toBe("さくらインターネット");
    expect(result.web.records.map((r) => r.value)).toEqual(
      expect.arrayContaining(["cdn.demo-seiko.example", "www0000.sakura.ne.jp"]),
    );
  });

  it("ゲートウェイの語でもメール用（mail-gw）は VPN 候補にしない", async () => {
    const fx = ReconFixture.parse({
      ...base,
      dns: { ...base.dns, "mail-gw.demo-seiko.example": { A: ["203.0.113.25"] } },
      ct: [
        ...base.ct,
        {
          issuer: "C=US, O=Let's Encrypt, CN=R11",
          names: ["mail-gw.demo-seiko.example"],
          notBefore: "2026-09-01T00:00:00Z",
          notAfter: "2026-11-30T23:59:59Z",
        },
      ],
    });
    const result = await runWith(fx);
    expect(result.remoteAccessCandidates.map((c) => c.hostname)).toEqual([
      "vpn.demo-seiko.example",
    ]);
  });
});
