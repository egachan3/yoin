import { describe, expect, it, vi } from "vitest";
import type { Kysely } from "kysely";
import type { Database } from "@/db/schema";

const findUserByHandleMock = vi.fn();
const isBlockedMock = vi.fn();

vi.mock("@/db/user", () => ({
  findUserByHandle: (...args: unknown[]) => findUserByHandleMock(...args),
}));
vi.mock("@/db/blocks", () => ({
  isBlocked: (...args: unknown[]) => isBlockedMock(...args),
}));

const { resolvePublicShelfAccess } = await import("./public-shelf");

const dbStub = {} as Kysely<Database>;

describe("resolvePublicShelfAccess", () => {
  it("ハンドルに対応するユーザーが存在しない場合はnull", async () => {
    findUserByHandleMock.mockResolvedValueOnce(null);

    const result = await resolvePublicShelfAccess(dbStub, "nobody", null);

    expect(result).toBeNull();
  });

  it("is_publicがfalseならallowed:falseを返す(ownerId/handleは含める)", async () => {
    findUserByHandleMock.mockResolvedValueOnce({ id: "u1", handle: "alice", is_public: 0 });

    const result = await resolvePublicShelfAccess(dbStub, "alice", null);

    expect(result).toEqual({ allowed: false, ownerId: "u1", ownerHandle: "alice" });
    // 非公開の時点で弾くべきで、ブロック判定のクエリは発行しない
    expect(isBlockedMock).not.toHaveBeenCalled();
  });

  it("is_publicがtrueで未ログイン(viewerId=null)ならallowed:true、ブロック判定は行わない", async () => {
    findUserByHandleMock.mockResolvedValueOnce({ id: "u1", handle: "alice", is_public: 1 });

    const result = await resolvePublicShelfAccess(dbStub, "alice", null);

    expect(result).toEqual({ allowed: true, ownerId: "u1", ownerHandle: "alice" });
    expect(isBlockedMock).not.toHaveBeenCalled();
  });

  it("is_publicがtrueでもviewerとブロック関係にあればallowed:false", async () => {
    findUserByHandleMock.mockResolvedValueOnce({ id: "u1", handle: "alice", is_public: 1 });
    isBlockedMock.mockResolvedValueOnce(true);

    const result = await resolvePublicShelfAccess(dbStub, "alice", "viewer1");

    expect(result).toEqual({ allowed: false, ownerId: "u1", ownerHandle: "alice" });
    expect(isBlockedMock).toHaveBeenCalledWith(dbStub, "viewer1", "u1");
  });

  it("is_publicがtrueでブロック関係もなければallowed:true", async () => {
    findUserByHandleMock.mockResolvedValueOnce({ id: "u1", handle: "alice", is_public: 1 });
    isBlockedMock.mockResolvedValueOnce(false);

    const result = await resolvePublicShelfAccess(dbStub, "alice", "viewer1");

    expect(result).toEqual({ allowed: true, ownerId: "u1", ownerHandle: "alice" });
  });

  it("handleがnull(オンボーディング未完了で万一is_publicだけ立っている異常系)ならnull扱い", async () => {
    findUserByHandleMock.mockResolvedValueOnce({ id: "u1", handle: null, is_public: 1 });

    const result = await resolvePublicShelfAccess(dbStub, "alice", null);

    expect(result).toBeNull();
  });
});
