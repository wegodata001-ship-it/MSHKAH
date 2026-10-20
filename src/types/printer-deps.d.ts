declare module "bidi-js" {
  type EmbeddingResult = unknown;
  interface BidiApi {
    getEmbeddingLevels(text: string, explicitDirection?: "ltr" | "rtl"): EmbeddingResult;
    getReorderSegments(text: string, embeddingLevels: EmbeddingResult): Array<[number, number]>;
    getReorderedString(text: string, embeddingLevels: EmbeddingResult): string;
  }
  export default function bidiFactory(): BidiApi;
}

declare module "arabic-persian-reshaper" {
  export const ArabicShaper: {
    convertArabic(text: string): string;
  };
  export const PersianShaper: {
    convertArabic(text: string): string;
  };
}
