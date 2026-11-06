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
  "alphv",
  "conti",
  "qakbot",
  "emotet",
  "ryuk",
  "revil",
  "sodinokibi",
  "black basta",
  "blackbasta",
  "cl0p",
  "ragnar",
  "akira",
  "8base",
  "hive",
  // 追加のコマンド・ユーティリティ・引数（Windows / Unix）
  "net user",
  "net use",
  "net group",
  "net localgroup",
  "nltest",
  "whoami",
  "ipconfig",
  "ifconfig",
  "tasklist",
  "taskkill",
  "schtasks",
  "reg add",
  "reg save",
  "vssadmin",
  "wbadmin",
  "bcdedit",
  "wevtutil",
  "icacls",
  "cipher ",
  "diskshadow",
  "esentutl",
  "dsquery",
  "adfind",
  "ldapsearch",
  "smbclient",
  "rdesktop",
  "xfreerdp",
  "mstsc",
  "python ",
  "python3",
  "perl ",
  "ruby ",
  "nc ",
  "telnet ",
  "ftp ",
  "scp ",
  "sftp ",
  "rsync ",
  "invoke-",
  "iex(",
  "iex ",
  "downloadstring",
  "frombase64string",
  "-executionpolicy",
  "-encodedcommand",
  "-nop ",
  "cmd /c",
  "cmd.exe",
  "conhost",
  "svchost",
  "ntds.dit",
  "sam ",
  "shadow copy",
  // ファイルパス・レジストリ・システムの場所
  "/etc/",
  "/var/",
  "/tmp/",
  "/usr/",
  "/home/",
  "/root/",
  "c:\\",
  "%appdata%",
  "%temp%",
  "%systemroot%",
  "%programdata%",
  "system32",
  "syswow64",
  "hkey_",
  "hklm",
  "hkcu",
  // コードの記法
  "<script",
  "<?php",
  "#!/",
  "function(",
  "=>",
  "eval(",
  "exec(",
  "system(",
  "subprocess",
  "os.system",
  "import os",
  "require(",
  // 追加の実在製品（国内中小企業のカルテに載り得るもの）
  "sophos",
  "trend micro",
  "trendmicro",
  "ウイルスバスター",
  "kaspersky",
  "symantec",
  "mcafee",
  "crowdstrike",
  "sentinelone",
  "microsoft defender",
  "windows defender",
  "eset",
  "norton",
  "okta",
  "aws",
  "amazon web services",
  "azure",
  "google cloud",
  "gcp",
  "salesforce",
  "kintone",
  "cybozu",
  "sansan",
  "freee",
  "弥生",
  "奉行",
  "zoom",
  "slack",
  "microsoft teams",
  "nec ",
  "allied telesis",
  "aterm",
  "tp-link",
  "netgear",
  "ubiquiti",
  "mikrotik",
  "draytek",
  "zyxel",
  "openvpn",
  "wireguard",
  "softether",
  "rustdesk",
  "chrome remote desktop",
  "magicconnect",
  "マジックコネクト",
  "landisk",
  "terastation",
  "linkstation",
  "fortinet",
  "fortigate",
];

/** 禁止の形。正規表現か、同じ形（source と exec）の検査 */
export type BannedPattern = { readonly source: string; exec(text: string): { 0: string } | null };

const SCHEME_CHAR = /[a-z0-9+.-]/i;
const LETTER = /[a-z]/i;
const WORD_CHAR = /\w/;

/**
 * URL のスキーム（`https://` など）の検出。`\b[a-z][a-z0-9+.-]*:\/\/` と同じ一致を返す。
 * 正規表現だと、`a.a.a.…` のような長い連なりの途中から何度も試して遅くなるため、
 * 「://」を探し、手前の連なりの中の最初の始まり（語の頭の英字）から切り出す
 */
export const SCHEME_PATTERN: BannedPattern = {
  source: "\\b[a-z][a-z0-9+.-]*:\\/\\/ (scheme)",
  exec(text) {
    let from = 0;
    for (;;) {
      const end = text.indexOf("://", from);
      if (end < 0) return null;
      let start = end;
      while (start > 0 && SCHEME_CHAR.test(text.charAt(start - 1))) start--;
      for (let p = start; p < end; p++) {
        if (!LETTER.test(text.charAt(p))) continue;
        if (p === 0 || !WORD_CHAR.test(text.charAt(p - 1))) return { 0: text.slice(p, end + 3) };
      }
      from = end + 3;
    }
  },
};

/** 形で分かる禁止：CVE 番号、IP アドレス、URL、ホスト名らしき語、コマンドの引数、コードの記号 */
export const BANNED_PATTERNS: readonly BannedPattern[] = [
  // 脆弱性番号
  /CVE-\d{4}-\d+/i,
  /\bJVN(DB)?[-#]?\d{2,}/i,
  // IPv4（10 進表記・ポート付きを含む）、IPv6、localhost
  /\b\d{1,3}(\.\d{1,3}){3}\b/,
  /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/i,
  /::1\b|\blocalhost\b/i,
  // URL、スキーム、メールアドレス
  SCHEME_PATTERN,
  /(?<![\w.+-])[\w.+-]+@[\w-]+\.[\w.-]+/,
  // ホスト名らしき語（よくある TLD・内部用の名前）
  /\b[a-z0-9-]+\.(com|jp|net|org|io|dev|app|cloud|info|biz|xyz|onion|local|localdomain|internal|intranet|corp|lan|home|test|example|invalid|co\.jp|ne\.jp|or\.jp|go\.jp|ac\.jp|lg\.jp)\b/i,
  // ポート番号（「ポート 3389」「3389/tcp」「:445」）
  /(?:ポート|port)\s*(?:番号\s*)?(?:[:：]\s*)?\d{2,5}\b/i,
  /\b\d{2,5}\s*(番ポート|\/\s*(tcp|udp))/i,
  /:\d{2,5}\b(?!\d)/,
  // コマンドの引数・パス・UNC・環境変数・レジストリ
  /(^|\s)--?[a-z][a-z0-9-]*(\s|=|$)/i,
  /(^|\s)\/[a-z]{1,3}(\s|$)/i,
  /\\\\[a-z0-9_.$-]+\\/i,
  /\b[a-z]:\\/i,
  /%[a-z]+%/i,
  /\bHK(LM|CU|CR|U|CC)\b/,
  // コードの記号・SQL・Base64 らしき長い文字列
  /[`$|<>{}\\]/,
  /\b(select|insert|union|drop)\b.{0,20}\b(from|table|into)\b/i,
  /[A-Za-z0-9+/]{40,}={0,2}/,
  // 拡張子つきのファイル名
  /\b[\w-]+\.(exe|dll|ps1|bat|cmd|vbs|js|hta|msi|scr|lnk|iso|zip|rar|7z|doc[mx]?|xls[mx]?|sh|py|php|jar)\b/i,
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
