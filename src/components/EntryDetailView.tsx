import Link from "next/link";
import { SUBTYPE_LABELS, aspectRatioFor } from "@/lib/categories";
import { isPlaceholderIconSrc, resolveEntryImageSrc } from "@/lib/entry-image";
import type { ShelfEntryRow } from "@/db/shelf";

export function EntryDetailView({ entry, backHref }: { entry: ShelfEntryRow; backHref: string }) {
	const imageSrc = resolveEntryImageSrc(entry);
	const isIcon = isPlaceholderIconSrc(imageSrc);

	return (
		<>
			<Link href={backHref} aria-label="一覧に戻る" className="entry-detail-back">
				<svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 5-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
			</Link>

			<div className="entry-detail-stack">
				<div className="entry-detail-art" style={{ aspectRatio: aspectRatioFor(entry.subtype) }}>
					{imageSrc && isIcon && <img src={imageSrc} alt="" style={{ width: "24%", height: "auto" }} />}
					{imageSrc && !isIcon && <img src={imageSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
				</div>

				<header className="entry-detail-heading">
					<p className="card-kicker">{SUBTYPE_LABELS[entry.subtype]}</p>
					<h1>{entry.title}</h1>
					<p className="text-muted">{formatAddedDate(entry.added_at)}</p>
				</header>

				<section className="card entry-detail-meta" aria-label="記録内容">
					<div>
						<p className="card-kicker">評価</p>
						<p className="entry-detail-rating" aria-label={entry.rating ? `${entry.rating}点` : "未評価"}>
							{entry.rating ? `${"★".repeat(entry.rating)}${"☆".repeat(5 - entry.rating)}` : "未評価"}
						</p>
					</div>
					<div>
						<p className="card-kicker">感想</p>
						<p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{entry.comment || "感想はまだありません。"}</p>
					</div>
				</section>
			</div>
		</>
	);
}

function formatAddedDate(timestamp: number) {
	return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric" }).format(new Date(timestamp * 1000));
}
