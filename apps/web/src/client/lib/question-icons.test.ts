import {
  Boxes,
  Building2,
  CircleHelp,
  Cloud,
  Factory,
  Handshake,
  HardDrive,
  HardHat,
  HeartHandshake,
  Landmark,
  Laptop,
  Network,
  Server,
  Stethoscope,
  Store,
  Warehouse,
  X,
} from "lucide-react";
import { describe, expect, it } from "vitest";
import { optionIcon } from "./question-icons.ts";

describe("optionIcon（最初の5問の選択肢のアイコン）", () => {
  it("業種", () => {
    expect(optionIcon("industry", "manufacturing")).toBe(Factory);
    expect(optionIcon("industry", "construction")).toBe(HardHat);
    expect(optionIcon("industry", "wholesale_service")).toBe(Store);
    expect(optionIcon("industry", "healthcare")).toBe(Stethoscope);
    expect(optionIcon("industry", "it")).toBe(Laptop);
    expect(optionIcon("industry", "finance")).toBe(Landmark);
    expect(optionIcon("industry", "other")).toBe(Building2);
  });
  it("現場", () => {
    expect(optionIcon("site", "factory")).toBe(Factory);
    expect(optionIcon("site", "warehouse")).toBe(Warehouse);
    expect(optionIcon("site", "construction_site")).toBe(HardHat);
    expect(optionIcon("site", "yard")).toBe(Boxes);
    expect(optionIcon("site", "store")).toBe(Store);
    expect(optionIcon("site", "clinic")).toBe(Stethoscope);
    expect(optionIcon("site", "care")).toBe(HeartHandshake);
    expect(optionIcon("site", "datacenter")).toBe(Server);
    expect(optionIcon("site", "onsite_team")).toBe(Network);
    expect(optionIcon("site", "office_only")).toBe(Building2);
  });
  it("置き場所・社外からのつなぎ方・バックアップ", () => {
    expect(optionIcon("hosting", "onprem")).toBe(Building2);
    expect(optionIcon("hosting", "cloud")).toBe(Cloud);
    expect(optionIcon("hosting", "provider")).toBe(Server);
    expect(optionIcon("hosting", "unknown")).toBe(CircleHelp);
    expect(optionIcon("remoteAccess", "vpn")).toBe(Network);
    expect(optionIcon("remoteAccess", "rdp")).toBe(Laptop);
    expect(optionIcon("remoteAccess", "vendor_remote")).toBe(Handshake);
    expect(optionIcon("remoteAccess", "cloud_only")).toBe(Cloud);
    expect(optionIcon("remoteAccess", "unknown")).toBe(CircleHelp);
    expect(optionIcon("backup", "same_network")).toBe(Building2);
    expect(optionIcon("backup", "cloud_sync")).toBe(Cloud);
    expect(optionIcon("backup", "isolated")).toBe(HardDrive);
    expect(optionIcon("backup", "none")).toBe(X);
    expect(optionIcon("backup", "unknown")).toBe(CircleHelp);
  });
  it("知らない質問・値は無アイコン", () => {
    expect(optionIcon("industry", "space_travel")).toBeUndefined();
    expect(optionIcon("unknown_question", "vpn")).toBeUndefined();
    // Object.prototype の名前を値に取られても拾わない
    expect(optionIcon("industry", "constructor")).toBeUndefined();
    expect(optionIcon("toString", "vpn")).toBeUndefined();
  });
});
