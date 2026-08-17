import { AnimeMangaSearch } from "@/components/search/AnimeMangaSearch";

// アニメとマンガはMAL APIの同じクライアントを種別違いで叩くため実装を共有する
export default function AnimeSearchPage() {
	return <AnimeMangaSearch subtype="anime" />;
}
