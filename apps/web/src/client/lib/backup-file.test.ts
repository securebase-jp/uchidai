import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyBackup,
  BACKUP_VERSION,
  backupFileName,
  backupText,
  buildBackup,
  KEYS,
  parseBackupFile,
} from "./backup-file.ts";
import { personalHints } from "./choice-hints.ts";
import { kevHints } from "./kevHints.ts";
import { staffName } from "./profile.ts";
import { exportText } from "./profile-file.ts";
import { reconHints } from "./reconHints.ts";
import { storage } from "./storage.ts";
import type { CompanyProfile } from "./types.ts";

const demo = JSON.parse(
  readFileSync(new URL("../../../../../examples/demo-seiko.json", import.meta.url), "utf8"),
) as CompanyProfile;

class MemStore {
  m = new Map<string, string>();
  quota = Number.POSITIVE_INFINITY;
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => {
    if (this.m.size >= this.quota && !this.m.has(k)) throw new Error("QuotaExceeded");
    this.m.set(k, v);
  };
  removeItem = (k: string) => void this.m.delete(k);
}

let mem: MemStore;
beforeEach(() => {
  mem = new MemStore();
  vi.stubGlobal("localStorage", mem);
});
afterEach(() => vi.unstubAllGlobals());

const NOW = new Date(2026, 10, 7, 9, 30);
const firstAsset = demo.assets[0]?.id ?? "";

function seedSettings() {
  storage.saveProfile(demo);
  personalHints.save({ [demo.id]: { [firstAsset]: { bucket: "gt1000", sensitiveUnknown: true } } });
  staffName.save("情シス太郎");
  reconHints.setDomain("example.co.jp");
  storage.setTheme("light");
  storage.setReduceMotion(true);
}

describe("バックアップの書き出しと復元", () => {
  it("ファイル名は日付つき", () => {
    expect(backupFileName(NOW)).toBe("ウチダイ-バックアップ-2026-11-07.json");
  });

  it("往復で設定が元どおりになる（件数区分と「分からない」を含む）", () => {
    seedSettings();
    const text = backupText(buildBackup(storage.loadProfile(), NOW));
    mem.m.clear();

    const r = parseBackupFile(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("backup");
    expect(r.skipped).toEqual([]);
    expect(applyBackup(r)).toEqual({ ok: true });

    expect(storage.loadProfile()?.companyName).toBe(demo.companyName);
    expect(personalHints.load()[demo.id]?.[firstAsset]).toEqual({
      bucket: "gt1000",
      sensitiveUnknown: true,
    });
    expect(staffName.load()).toBe("情シス太郎");
    expect(reconHints.domain()).toBe("example.co.jp");
    expect(storage.theme()).toBe("light");
    expect(storage.reduceMotion()).toBe(true);
  });

  it("キー定数が各 load と一致している（保存名のずれを検知）", () => {
    seedSettings();
    kevHints.record(demo.id, firstAsset, "v1", "2026-11-07T00:00:00Z", []);
    expect([...mem.m.keys()].sort()).toEqual(
      [
        KEYS.profile,
        KEYS.personalHints,
        KEYS.staffName,
        KEYS.reconDomain,
        KEYS.theme,
        KEYS.reduceMotion,
        KEYS.kev,
      ].sort(),
    );
    const b = buildBackup(demo, NOW);
    expect(b.settings.kev).toBeDefined();
    mem.m.delete(KEYS.kev);
    const r = parseBackupFile(backupText(b));
    expect(r.ok && applyBackup(r).ok).toBe(true);
    expect(kevHints.load()?.profileId).toBe(demo.id);
  });

  it("旧形式（カルテ単体）も読める。設定は触らない", () => {
    const r = parseBackupFile(exportText(demo));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("profile");
    expect(r.profile?.companyName).toBe(demo.companyName);
    expect(r.items.map((i) => i.key)).toEqual(["profile"]);
  });

  it("壊れた項目だけ読み飛ばし、ほかは復元できる", () => {
    const b = buildBackup(demo, NOW);
    const broken = JSON.stringify({
      ...b,
      settings: { staffName: "花子", theme: "blue", reduceMotion: "yes", case: { x: 1 } },
    });
    const r = parseBackupFile(broken);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.map((i) => i.key).sort()).toEqual(["profile", "staffName"]);
    expect(r.skipped).toHaveLength(3);
  });

  it("カルテが壊れていても設定は復元できる", () => {
    const r = parseBackupFile(
      JSON.stringify({
        app: "uchidai",
        format: "backup",
        version: 1,
        profile: { id: "x" },
        settings: { staffName: "花子" },
      }),
    );
    expect(r.ok && r.profile).toBeFalsy();
    expect(r.ok && r.items.map((i) => i.key)).toEqual(["staffName"]);
    expect(r.ok && r.skipped[0]?.labelJa).toBe("会社カルテ");
  });

  it("復元できる項目が無ければ失敗する", () => {
    const r = parseBackupFile(
      JSON.stringify({ app: "uchidai", format: "backup", version: 1, settings: {} }),
    );
    expect(r.ok).toBe(false);
  });

  it("新しすぎる版・別アプリ・壊れた JSON・大きすぎるファイルを拒む", () => {
    const base = { app: "uchidai", format: "backup", settings: { staffName: "a" } };
    expect(parseBackupFile(JSON.stringify({ ...base, version: BACKUP_VERSION + 1 })).ok).toBe(
      false,
    );
    expect(parseBackupFile(JSON.stringify({ ...base, app: "other", version: 1 })).ok).toBe(false);
    expect(parseBackupFile("{").ok).toBe(false);
    expect(parseBackupFile("[]").ok).toBe(false);
    expect(parseBackupFile(" ".repeat(2_000_001)).ok).toBe(false);
  });

  it("深すぎる入れ子と __proto__ を拒む／持ち込まない", () => {
    let deep: unknown = "x";
    for (let i = 0; i < 40; i++) deep = { a: deep };
    const d = parseBackupFile(
      JSON.stringify({ app: "uchidai", format: "backup", version: 1, settings: { kev: deep } }),
    );
    expect(d.ok).toBe(false);

    const p = parseBackupFile(
      '{"app":"uchidai","format":"backup","version":1,"settings":{"__proto__":{"polluted":1},"staffName":"a"}}',
    );
    expect(p.ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(p.ok && Object.keys(p.settings)).toEqual(["staffName"]);
  });

  it("復元で所有確認（domainVerified）は信用せず false に戻す", () => {
    const b = buildBackup({ ...demo, domainVerified: true }, NOW);
    const r = parseBackupFile(backupText(b));
    expect(r.ok && r.profile?.domainVerified).toBe(false);
  });

  it("書き込みに失敗したら元の状態に戻す", () => {
    storage.saveProfile(demo);
    staffName.save("元の担当者");
    const before = new Map(mem.m);
    const b = buildBackup(demo, NOW);
    b.settings = { staffName: "新しい担当者", reconDomain: "a.example", theme: "dark" };
    const r = parseBackupFile(backupText(b));
    if (!r.ok) throw new Error("parse");
    mem.quota = mem.m.size + 1; // 新しいキーは 1 つしか書けない
    const res = applyBackup(r);
    expect(res.ok).toBe(false);
    expect(new Map(mem.m)).toEqual(before);
  });

  it("バックアップに無い項目は触らない／カルテを戻すと架空の会社の選択を外す", () => {
    staffName.save("そのまま");
    storage.saveExampleId("some-example");
    storage.saveNoCompany();
    const r = parseBackupFile(backupText({ ...buildBackup(demo, NOW), settings: {} }));
    if (!r.ok) throw new Error("parse");
    expect(applyBackup(r).ok).toBe(true);
    expect(staffName.load()).toBe("そのまま");
    expect(storage.loadExampleId()).toBeUndefined();
    expect(storage.loadNoCompany()).toBe(false);
  });
});
