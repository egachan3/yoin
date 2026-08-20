import { TmdbAttribution } from "@/components/TmdbAttribution";

// ログイン不要で見られる「このアプリについて」ページ。
// TMDBの帰属表示はprofile/settingsにも集約しているが、そちらはログイン必須のため、
// 公開棚(/u/[handle]、ログイン不要)からの訪問者が帰属表示に到達する手段が
// なくなってしまう問題があった。この公開ページを設け、公開棚側からリンクする
export default function AboutPage() {
	return (
		<main style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
			<h1 style={{ fontSize: 24, marginBottom: "var(--space-6)" }}>このアプリについて</h1>
			<TmdbAttribution />
		</main>
	);
}
