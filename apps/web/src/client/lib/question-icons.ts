/**
 * 最初の5問の選択肢に添えるアイコン。質問の id と選択肢の値の組から決める（純関数）。
 * 知らない組（新しく足した選択肢など）は undefined を返し、アイコン無しで文字だけを出す。
 * アイコンは Lucide（ISC ライセンス）。出典は「データの扱いと出典」と NOTICE
 */
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
  type LucideIcon,
  Network,
  Server,
  Stethoscope,
  Store,
  Warehouse,
  X,
} from "lucide-react";

const ICONS: Record<string, Record<string, LucideIcon>> = {
  industry: {
    manufacturing: Factory,
    construction: HardHat,
    wholesale_service: Store,
    healthcare: Stethoscope,
    it: Laptop,
    finance: Landmark,
    other: Building2,
  },
  site: {
    factory: Factory,
    warehouse: Warehouse,
    construction_site: HardHat,
    yard: Boxes,
    store: Store,
    clinic: Stethoscope,
    care: HeartHandshake,
    datacenter: Server,
    onsite_team: Network,
    office_only: Building2,
  },
  hosting: {
    onprem: Building2,
    cloud: Cloud,
    provider: Server,
    unknown: CircleHelp,
  },
  remoteAccess: {
    vpn: Network,
    rdp: Laptop,
    vendor_remote: Handshake,
    cloud_only: Cloud,
    unknown: CircleHelp,
  },
  backup: {
    same_network: Building2,
    cloud_sync: Cloud,
    isolated: HardDrive,
    none: X,
    unknown: CircleHelp,
  },
};

/** 質問 id（industry・site・hosting・remoteAccess・backup）と選択肢の値からアイコンを返す。無ければ undefined */
export function optionIcon(questionId: string, value: string): LucideIcon | undefined {
  const byValue = Object.hasOwn(ICONS, questionId) ? ICONS[questionId] : undefined;
  return byValue && Object.hasOwn(byValue, value) ? byValue[value] : undefined;
}
