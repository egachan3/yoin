// 検索結果カード用の小さいサムネイル画像。5ジャンルの検索画面で共通利用する。
// 画像が無い場合はジャンル別のaspectRatioに合わせたプレースホルダー枠を表示する。

import { isPlaceholderIconSrc } from "@/lib/entry-image";

interface SearchResultThumbnailProps {
	src: string | null;
	alt: string;
	aspectRatio?: "2 / 3" | "1 / 1";
}

export function SearchResultThumbnail({ src, alt, aspectRatio = "2 / 3" }: SearchResultThumbnailProps) {
	const boxStyle: React.CSSProperties = {
		width: 72,
		flexShrink: 0,
		// 横並びカード(flex-direction: row)の中で.cardの既定align-items: stretchが
		// 効くと、隣接するテキスト列の高さに合わせてサムネイルまで縦に引き伸ばされ、
		// aspectRatioで意図した比率が崩れる(レビュー指摘)。自分だけstretchを外す
		alignSelf: "flex-start",
		aspectRatio,
		borderRadius: "var(--radius-image)",
		background: "var(--color-accent-100)",
	};

	if (!src) {
		return <div role="img" aria-label={alt} style={boxStyle} />;
	}

	// /icons/配下のsubtypeアイコン(手動追加で画像未設定の場合)はobject-fit: coverで
	// 引き伸ばすと小さいグリフが不自然にトリミング・拡大される(CategoryCardと同じ理由)。
	// 中央に収める表示に切り替える
	if (isPlaceholderIconSrc(src)) {
		return (
			<div style={{ ...boxStyle, position: "relative", overflow: "hidden" }}>
				{/* eslint-disable-next-line @next/next/no-img-element -- 静的アセットのため次のimage最適化は不要 */}
				<img
					src={src}
					alt=""
					style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "45%" }}
				/>
			</div>
		);
	}

	// 隣にcard-titleでタイトルが必ずテキスト表示されるため、実画像側は装飾扱いに
	// してalt=""にする(スクリーンリーダーでの同じ情報の二重読み上げを避ける)。
	// alt propはプレースホルダー側(role="img")の代替テキストとしてのみ使われる
	return <img src={src} alt="" loading="lazy" style={{ ...boxStyle, objectFit: "cover" }} />;
}
