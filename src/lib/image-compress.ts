// ブラウザ側での画像リサイズ+JPEG圧縮(手動入力エントリの画像アップロード用)。
// アップロード前にクライアント側で圧縮することで、通信量とR2ストレージ使用量を抑える。

const MAX_DIMENSION = 800;
const JPEG_QUALITY = 0.8;

/**
 * 画像ファイルを長辺MAX_DIMENSION px以内にリサイズし、JPEGに圧縮する。
 * createImageBitmap/canvas.toBlobはモダンブラウザ(iOS Safari 15+等)で利用可能。
 */
export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("canvas 2d context is unavailable");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("image compression failed"))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}
