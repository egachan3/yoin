import { describe, expect, it, vi } from "vitest";
import { attachCoverArt } from "./route";
import type { MusicCandidate } from "@/lib/sources/musicbrainz";

vi.mock("@/lib/sources/musicbrainz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sources/musicbrainz")>("@/lib/sources/musicbrainz");
  return {
    ...actual,
    fetchCoverArtByRelease: vi.fn(async (releaseId: string) => `https://caa.example/${releaseId}`),
    fetchCoverArtByReleaseGroup: vi.fn(async (releaseGroupId: string) => `https://caa.example/${releaseGroupId}`),
  };
});

function makeCandidate(sourceId: string): MusicCandidate {
  return {
    source: "musicbrainz",
    entityType: "release-group",
    sourceId,
    title: `title-${sourceId}`,
    artist: null,
    lengthMs: null,
    releaseIdForCoverArt: null,
  };
}

describe("attachCoverArt", () => {
  it("上位5件のみジャケットを取得し、6件目以降はimageUrl: nullになる(件数境界の確認)", async () => {
    const candidates = Array.from({ length: 10 }, (_, i) => makeCandidate(String(i)));

    const result = await attachCoverArt(candidates);

    expect(result).toHaveLength(10);
    result.slice(0, 5).forEach((c, i) => {
      expect(c.imageUrl).toBe(`https://caa.example/${i}`);
    });
    result.slice(5).forEach((c) => {
      expect(c.imageUrl).toBeNull();
    });
  });

  it("候補がちょうど5件の場合は全件ジャケットを取得する", async () => {
    const candidates = Array.from({ length: 5 }, (_, i) => makeCandidate(String(i)));

    const result = await attachCoverArt(candidates);

    expect(result).toHaveLength(5);
    result.forEach((c, i) => {
      expect(c.imageUrl).toBe(`https://caa.example/${i}`);
    });
  });

  it("候補が5件未満の場合も全件ジャケットを取得する", async () => {
    const candidates = Array.from({ length: 3 }, (_, i) => makeCandidate(String(i)));

    const result = await attachCoverArt(candidates);

    expect(result).toHaveLength(3);
    result.forEach((c, i) => {
      expect(c.imageUrl).toBe(`https://caa.example/${i}`);
    });
  });

  it("候補の順序を維持する", async () => {
    const candidates = Array.from({ length: 7 }, (_, i) => makeCandidate(String(i)));

    const result = await attachCoverArt(candidates);

    expect(result.map((c) => c.sourceId)).toEqual(candidates.map((c) => c.sourceId));
  });
});
