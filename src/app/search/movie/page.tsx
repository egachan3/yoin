import { VideoSearch } from "@/components/search/VideoSearch";

// 映画とドラマはTMDBの別エンドポイントを叩くだけの違いなので実装を共有する
export default function MovieSearchPage() {
	return <VideoSearch subtype="movie" />;
}
