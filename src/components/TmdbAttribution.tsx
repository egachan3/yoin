// TMDBの帰属表示。ロゴ画像+規定文言の両方が利用規約上必須
// (テキストのみでは不十分)。ロゴはアプリ自体のロゴより目立たせない。
// 参照: shelf-type-app-spec.md セクション5「TMDBの6ヶ月キャッシュ上限への対応」
export function TmdbAttribution() {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "var(--space-6)" }}>
			{/* eslint-disable-next-line @next/next/no-img-element -- next/imageの最適化は不要な小さな固定SVG */}
			<img src="/tmdb-attribution.svg" alt="TMDB" style={{ height: 12, width: "auto" }} />
			<p style={{ fontSize: 11, color: "var(--color-text-muted, #999)", margin: 0 }}>
				This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.
			</p>
		</div>
	);
}
