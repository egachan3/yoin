import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/db/client";
import { listShelfEntries } from "@/db/shelf";
import { TmdbAttribution } from "@/components/TmdbAttribution";
import { STATUS_LABELS } from "@/lib/manual-entry";

export default async function Home() {
	const { env } = await getCloudflareContext({ async: true });
	const auth = createAuth(env);
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session) {
		redirect("/login");
	}
	if (!session.user.handle_normalized) {
		redirect("/onboarding");
	}

	const db = createDb(env.DB);
	const entries = await listShelfEntries(db, session.user.id);

	return (
		<main style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-6)" }}>
				<h1 style={{ fontSize: 24, margin: 0 }}>@{session.user.handle}の棚</h1>
				<div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
					<Link href="/search/books" className="btn btn-primary">
						本を追加
					</Link>
					<Link href="/search/music" className="btn btn-primary">
						曲・アルバムを追加
					</Link>
					<Link href="/search/movies" className="btn btn-primary">
						映画・ドラマを追加
					</Link>
					<Link href="/search/anime-manga" className="btn btn-primary">
						アニメ・マンガを追加
					</Link>
					<Link href="/search/games" className="btn btn-primary">
						ゲームを追加
					</Link>
					<Link href="/entries/new" className="btn btn-secondary">
						見つからない作品を手動で追加
					</Link>
				</div>
			</div>

			{entries.length === 0 ? (
				<p className="text-muted">まだ何も追加されていません。「本を追加」から最初の1冊を記録してみましょう。</p>
			) : (
				<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "var(--space-3)" }}>
					{entries.map((entry) => (
						<div key={entry.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
							{entry.owner_user_id ? (
								// 手動入力(owner_user_id非null)はR2プロキシの対象外
								// (image-proxy.tsのresolveImageSourceが構造的に除外している)。
								// primary_image_refにはpublic/placeholders/配下の静的アセットの
								// パスがそのまま入っているため、プロキシを経由せず直接参照する
								// eslint-disable-next-line @next/next/no-img-element -- publicの静的アセットのため次のimage最適化は不要
								<img
									src={entry.primary_image_ref ?? undefined}
									alt={entry.title}
									loading="lazy"
									style={{ display: "block", width: "100%", aspectRatio: "2 / 3", objectFit: "cover" }}
								/>
							) : entry.primary_image_ref ? (
								// eslint-disable-next-line @next/next/no-img-element -- R2プロキシ配下の自ドメイン画像のため次のimage最適化(next/image)の適用は別途検討
								<img
									src={`/img/${entry.catalog_id}/grid`}
									alt={entry.title}
									loading="lazy"
									style={{ display: "block", width: "100%", aspectRatio: "2 / 3", objectFit: "cover" }}
								/>
							) : (
								<div
									role="img"
									aria-label={entry.title}
									style={{ aspectRatio: "2 / 3", background: "var(--color-accent-100)" }}
								/>
							)}
							<div style={{ padding: "var(--space-2) var(--space-3)" }}>
								<p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{entry.title}</p>
								<p className="card-meta" style={{ marginTop: 4 }}>
									{STATUS_LABELS[entry.status] ?? entry.status}
									{entry.rating ? ` ・ ${"★".repeat(entry.rating)}${"☆".repeat(5 - entry.rating)}` : ""}
								</p>
							</div>
						</div>
					))}
				</div>
			)}

			{entries.some((entry) => entry.genre === "movie_tv") && <TmdbAttribution />}
		</main>
	);
}
