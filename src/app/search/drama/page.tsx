import { VideoSearch } from "@/components/search/VideoSearch";

// URLは/search/drama、TMDB側の語彙(=保存するsubtype)は"tv"
export default function DramaSearchPage() {
	return <VideoSearch subtype="tv" />;
}
