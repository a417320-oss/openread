export type OcrOperation =
  | { kind: "open"; url: string }
  | { kind: "text"; page: number }
  | { kind: "recognize"; page: number; language: string }
  | { kind: "release" };

export type OcrCommand = (OcrOperation & { id: number }) | { kind: "cancel" };

export interface RecognitionResult {
  text: string;
  confidence: number;
}

export type OcrMessage =
  | { kind: "ready" }
  | { kind: "error"; id: number; error: string }
  | { kind: "result"; id: number; value: number | string | RecognitionResult | null };
