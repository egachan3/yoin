// 検索結果カード用の小さいサムネイル画像。5ジャンルの検索画面で共通利用する。
// 画像が無い場合はジャンル別のaspectRatioに合わせたプレースホルダー枠を表示する。

interface SearchResultThumbnailProps {
	src: string | null;
	alt: string;
	aspectRatio?: "2 / 3" | "1 / 1";
}

export function SearchResultThumbnail({ src, alt, aspectRatio = "2 / 3" }: SearchResultThumbnailProps) {
	const style: React.CSSProperties = {
		width: 56,
		flexShrink: 0,
		aspectRatio,
		borderRadius: "var(--radius-md)",
		objectFit: "cover",
		background: "var(--color-accent-100)",
	};

	if (!src) {
		return <div role="img" aria-label={alt} style={style} />;
	}

	// eslint-disable-next-line @next/next/no-img-element -- 外部CDN(TMDB/MAL/IGDB/MusicBrainz/Google Books)の画像のため次のimage最適化は使わない
	return <img src={src} alt="" loading="lazy" style={style} />;
}
