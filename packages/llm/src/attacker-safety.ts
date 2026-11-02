/**
 * AI攻撃者の出力の安全検査：ATT&CK の手法の水準を超える行（コマンド、コード、CVE、製品名、ホスト名）は破棄する。
 * 検査は決定的（固定の表と正規表現）。Claude の判断には頼らない
 */

/** 禁止語の表（小文字で照合）。実在製品の名前、攻撃ツール、コマンド、シェルの語 */
export const BANNED_TERMS: readonly string[] = [
  // 攻撃ツール・コマンド
  "mimikatz",
  "psexec",
  "powershell",
  "cmd.exe",
  "wmic",
  "bloodhound",
  "cobalt strike",
  "metasploit",
  "msfconsole",
  "nmap",
  "masscan",
  "hashcat",
  "john the ripper",
  "hydra",
  "sqlmap",
  "impacket",
  "rubeus",
  "sharphound",
  "ntdsutil",
  "procdump",
  "lsass",
  "secretsdump",
  "crackmapexec",
  "netexec",
  "responder",
  "kerberoast",
  "winrm",
  "ssh ",
  "curl ",
  "wget ",
  "netcat",
  "ncat",
  "bash ",
  "/bin/",
  ".exe",
  ".ps1",
  ".bat",
  ".vbs",
  ".dll",
  "sudo ",
  "chmod ",
  "regsvr32",
  "rundll32",
  "certutil",
  "mshta",
  // 実在製品（カルテに載り得るもの）
  "fortinet",
  "fortios",
  "fortigate",
  "paloalto",
  "palo alto",
  "globalprotect",
  "cisco",
  "anyconnect",
  "ivanti",
  "pulse secure",
  "citrix",
  "netscaler",
  "sonicwall",
  "check point",
  "juniper",
  "watchguard",
  "yamaha",
  "buffalo",
  "teamviewer",
  "anydesk",
  "splashtop",
  "logmein",
  "vnc",
  "screenconnect",
  "connectwise",
  "microsoft 365",
  "office 365",
  "exchange",
  "sharepoint",
  "onedrive",
  "google workspace",
  "dropbox",
  "box.com",
  "vmware",
  "esxi",
  "hyper-v",
  "active directory",
  "windows server",
  "linux",
  "ubuntu",
  "centos",
  "wordpress",
  "apache",
  "nginx",
  "veeam",
  "synology",
  "qnap",
  "lockbit",
  "blackcat",
  "conti",
  "qakbot",
  "emotet",
];

/** 形で分かる禁止：CVE 番号、IP アドレス、URL、ホスト名らしき語、コマンドの引数、コードの記号 */
export const BANNED_PATTERNS: readonly RegExp[] = [
  /CVE-\d{4}-\d+/i,
  /\b\d{1,3}(\.\d{1,3}){3}\b/,
  /https?:\/\//i,
  /\b[a-z0-9-]+\.(com|jp|net|org|io|local|example|co\.jp|ne\.jp)\b/i,
  /(^|\s)--?[a-z][a-z0-9-]*(\s|=|$)/i,
  /[`$|<>{}\\]/,
  /\b(select|insert|union|drop)\b.{0,20}\b(from|table|into)\b/i,
];

export type SafetyCheck = { ok: true } | { ok: false; reasonJa: string };

/** 1 行の文章を検査する。禁止語か禁止パターンを含めば破棄の理由を返す */
export function checkLine(text: string): SafetyCheck {
  const lower = text.toLowerCase();
  for (const term of BANNED_TERMS) {
    if (lower.includes(term)) return { ok: false, reasonJa: `禁止語「${term.trim()}」を含む` };
  }
  for (const re of BANNED_PATTERNS) {
    const m = re.exec(text);
    if (m) return { ok: false, reasonJa: `手法の水準を超える記述「${m[0].trim()}」を含む` };
  }
  return { ok: true };
}

/** カルテ由来の語（社名、製品名、ホスト名など）を追加の禁止語として検査する */
export function checkLineAgainst(text: string, extraTerms: readonly string[]): SafetyCheck {
  const base = checkLine(text);
  if (!base.ok) return base;
  const lower = text.toLowerCase();
  for (const t of extraTerms) {
    const needle = t.trim().toLowerCase();
    if (needle.length >= 3 && lower.includes(needle))
      return { ok: false, reasonJa: "カルテの固有名詞を含む" };
  }
  return { ok: true };
}
