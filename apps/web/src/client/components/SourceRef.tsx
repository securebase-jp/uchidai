/**
 * 出典番号：出典のある数値（報告期限、費用の単価、入口の並び順など）の横に小さく付ける上付きの番号。
 * 押すと「データの扱いと出典」（#/sources）の該当する項目へ移る。出典の文を画面に並べずに、根拠への道を残すための部品。
 * id は knowledge/sources.yaml の sources[].id（例：ppc-leak、ipa-sme-jirei-cost、npa-threat-stats）
 */
type Props = {
  /** knowledge/sources.yaml の出典の id */
  id: string;
  /** 画面に出す番号（同じ画面の中で 1 から振る） */
  n: number;
  /** 読み上げと吹き出しに出す出典の名前（短く） */
  titleJa: string;
};

export function SourceRef({ id, n, titleJa }: Props) {
  return (
    <sup className="src-ref">
      <a
        className="src-ref-link"
        href={`#/sources?src=${encodeURIComponent(id)}`}
        title={`出典：${titleJa}`}
        aria-label={`出典 ${n}：${titleJa}`}
      >
        {n}
      </a>
    </sup>
  );
}
