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
		// 横並びカード(flex-direction: row)の中で.cardの既定align-items: stretchが
		// 効くと、隣接するテキスト列の高さに合わせてサムネイルまで縦に引き伸ばされ、
		// aspectRatioで意図した比率が崩れる(レビュー指摘)。自分だけstretchを外す
		alignSelf: "flex-start",
		aspectRatio,
		borderRadius: "var(--radius-md)",
		objectFit: "cover",
		background: "var(--color-accent-100)",
	};

	if (!src) {
		return <div role="img" aria-label={alt} style={style} />;
	}

	// 隣にcard-titleでタイトルが必ずテキスト表示されるため、実画像側は装飾扱いに
	// してalt=""にする(スクリーンリーダーでの同じ情報の二重読み上げを避ける)。
	// alt propはプレースホルダー側(role="img")の代替テキストとしてのみ使われる
	return <img src={src} alt="" loading="lazy" style={style} />;
}
