/**
 * 依存なしの ZIP の書き込みと読み込み（ポータブル ZIP の組み立てと検査で使う）。
 *
 * - ファイル名は UTF-8（一般目的ビットの 11）。日本語名（ウチダイを起動.bat など）を Windows・macOS で正しく展開できる
 * - Unix のファイルの権限を外部属性に入れる（.command と start.sh の実行権限を保つ）
 * - シンボリックリンクは扱わない（Windows で壊れるため、入れない）
 * - 並びは名前順、時刻は固定で渡す（同じ入力から同じ ZIP になる）
 * - ZIP64 は使わない。4GB 以上のファイルと 65535 件以上の項目は拒む
 */
import { closeSync, openSync, writeSync } from "node:fs";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

export type ZipEntry = {
  name: string;
  method: 0 | 8;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
  /** Unix の権限（ファイルの種別を含む 16 ビット） */
  mode: number;
  isDirectory: boolean;
};

/** DOS の日時（ZIP の形式。展開する側はローカルの時刻として読む）。1980 年より前は 1980 年にする */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

type Pending = { name: string; header: Buffer; entry: ZipEntry };

export class ZipWriter {
  private readonly fd: number;
  private position = 0;
  private readonly pending: Pending[] = [];
  private readonly names = new Set<string>();
  private readonly mtime: Date;
  private closed = false;

  constructor(path: string, options: { mtime: Date }) {
    this.fd = openSync(path, "w");
    this.mtime = options.mtime;
  }

  private write(buffer: Buffer): void {
    let written = 0;
    while (written < buffer.length) {
      written += writeSync(this.fd, buffer, written, buffer.length - written);
    }
    this.position += buffer.length;
  }

  /** ファイルを 1 つ足す。name は区切りが / の相対パス。mode は 0o644 や 0o755 */
  addFile(name: string, data: Buffer, mode = 0o644): void {
    this.add(name, data, 0o100000 | (mode & 0o777), false);
  }

  /** 空のフォルダも項目として残したいときだけ使う（通常は不要） */
  addDirectory(name: string, mode = 0o755): void {
    this.add(
      name.endsWith("/") ? name : `${name}/`,
      Buffer.alloc(0),
      0o040000 | (mode & 0o777),
      true,
    );
  }

  private add(name: string, data: Buffer, mode: number, isDirectory: boolean): void {
    if (this.closed) throw new Error("ZIP はすでに閉じています");
    if (this.pending.length >= MAX_ENTRIES)
      throw new Error("ZIP の項目が多すぎます（65535 件まで）");
    if (data.length > MAX_SIZE) throw new Error(`${name} が大きすぎます（4GB まで）`);
    if (this.names.has(name)) throw new Error(`ZIP に同じ名前が 2 回入ります: ${name}`);
    this.names.add(name);

    const nameBytes = Buffer.from(name, "utf8");
    if (nameBytes.length > 0xffff) throw new Error(`名前が長すぎます: ${name}`);
    const deflated = data.length > 0 ? deflateRawSync(data, { level: 9 }) : data;
    // 縮まないものはそのまま入れる（すでに圧縮された画像やフォントなど）
    const method: 0 | 8 = data.length > 0 && deflated.length < data.length ? 8 : 0;
    const body = method === 8 ? deflated : data;
    const checksum = crc32(data);
    const stamp = dosDateTime(this.mtime);
    const offset = this.position;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4); // 展開に必要な版
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    this.write(local);
    this.write(nameBytes);
    this.write(body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // 作成した環境：Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // 追加情報
    central.writeUInt16LE(0, 32); // コメント
    central.writeUInt16LE(0, 34); // ディスク番号
    central.writeUInt16LE(0, 36); // 内部属性
    central.writeUInt32LE(((mode << 16) | (isDirectory ? 0x10 : 0)) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    this.pending.push({
      name,
      header: Buffer.concat([central, nameBytes]),
      entry: {
        name,
        method,
        crc: checksum,
        compressedSize: body.length,
        size: data.length,
        offset,
        mode,
        isDirectory,
      },
    });
  }

  /** 中央ディレクトリを書いて閉じる。項目の一覧を返す */
  finish(): ZipEntry[] {
    if (this.closed) throw new Error("ZIP はすでに閉じています");
    const start = this.position;
    for (const p of this.pending) this.write(p.header);
    const size = this.position - start;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_SIGNATURE, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.pending.length, 8);
    end.writeUInt16LE(this.pending.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(start, 16);
    end.writeUInt16LE(0, 20);
    this.write(end);
    this.closed = true;
    closeSync(this.fd);
    return this.pending.map((p) => p.entry);
  }
}

/** ZIP の中央ディレクトリを読む（ZIP64 と暗号化には非対応） */
export function readZipEntries(zip: Buffer): ZipEntry[] {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === END_SIGNATURE) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("ZIP の終端が見つかりません");
  const count = zip.readUInt16LE(end + 10);
  let pos = zip.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(pos) !== CENTRAL_SIGNATURE)
      throw new Error("中央ディレクトリが壊れています");
    const flags = zip.readUInt16LE(pos + 8);
    const method = zip.readUInt16LE(pos + 10);
    if (method !== 0 && method !== 8) throw new Error(`未対応の圧縮方式です: ${method}`);
    if (flags & 1) throw new Error("暗号化された項目は読めません");
    const nameLength = zip.readUInt16LE(pos + 28);
    const extraLength = zip.readUInt16LE(pos + 30);
    const commentLength = zip.readUInt16LE(pos + 32);
    const madeBy = zip.readUInt16LE(pos + 4) >> 8;
    const external = zip.readUInt32LE(pos + 38);
    const name = zip.toString("utf8", pos + 46, pos + 46 + nameLength);
    const isDirectory = name.endsWith("/") || (external & 0x10) !== 0;
    entries.push({
      name,
      method,
      crc: zip.readUInt32LE(pos + 16),
      compressedSize: zip.readUInt32LE(pos + 20),
      size: zip.readUInt32LE(pos + 24),
      offset: zip.readUInt32LE(pos + 42),
      mode: madeBy === 3 ? external >>> 16 : 0,
      isDirectory,
    });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** 項目の中身を取り出し、サイズと CRC を確かめる */
export function readZipEntryData(zip: Buffer, entry: ZipEntry): Buffer {
  if (zip.readUInt32LE(entry.offset) !== LOCAL_SIGNATURE)
    throw new Error(`${entry.name}: 局所ヘッダが壊れています`);
  const nameLength = zip.readUInt16LE(entry.offset + 26);
  const extraLength = zip.readUInt16LE(entry.offset + 28);
  const start = entry.offset + 30 + nameLength + extraLength;
  const body = zip.subarray(start, start + entry.compressedSize);
  const data = entry.method === 8 ? inflateRawSync(body) : Buffer.from(body);
  if (data.length !== entry.size) throw new Error(`${entry.name}: サイズが合いません`);
  if (crc32(data) !== entry.crc) throw new Error(`${entry.name}: CRC が合いません`);
  return data;
}
