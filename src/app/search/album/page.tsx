import { MusicSearch } from "@/components/search/MusicSearch";

// 棚のカテゴリと検索画面は1対1で対応する(引き継ぎ.md 3.5節)。
// アルバムと曲は同じMusicBrainz/iTunes検索を使うため実装は共有し、
// どちらを探すかだけをここで固定する
export default function AlbumSearchPage() {
	return <MusicSearch subtype="album" />;
}
