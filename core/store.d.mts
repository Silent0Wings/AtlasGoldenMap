/** Types for store.mjs (review store). Keep in sync with the implementation. */

export type ReviewStatus = 'new' | 'match' | 'changed' | 'stale' | 'unsettled' | 'volatile';
export type ReviewReason = 'size' | 'pixels' | 'html' | 'config' | 'unsettled';
export type ReviewDecision = 'pending' | 'approved' | 'denied';

export type BBox = { x1: number; y1: number; x2: number; y2: number };
export type CanvasRect = { x: number; y: number; width: number; height: number };

export type ReviewRecord = {
  key: string;
  variant: string;
  file: string;
  id: string;
  nodeId: string;
  label: string;
  kind: string;
  group: string | null;
  tags: string[];
  volatile: boolean;
  actual: string;
  approved: string | null;
  diff: string | null;
  width: number;
  height: number;
  approvedWidth: number | null;
  approvedHeight: number | null;
  diffPixels: number | null;
  diffRatio: number | null;
  bbox: BBox | null;
  threshold: number;
  /** What the comparison used, so stabilize applies the same rules. */
  options: { pixelThreshold: number; ignoreAntialiasing: boolean; failOnHtml: boolean };
  htmlHash: string | null;
  approvedHtmlHash: string | null;
  htmlChanged: boolean;
  configHash: string;
  approvedConfigHash: string | null;
  actualHash: string;
  settled: boolean;
  canvases: CanvasRect[];
  status: ReviewStatus;
  reasons: ReviewReason[];
  htmlIdentical: boolean;
  decision: ReviewDecision;
  note: string;
  capturedAt: string;
  decidedAt: string | null;
};

export type ApprovalMeta = {
  htmlHash: string | null;
  configHash: string;
  width: number;
  height: number;
  approvedAt: string;
  note: string;
};

export type DeniedEntry = { actualHash: string; configHash: string; note: string; at: string };

export type RecordInfo = {
  id: string;
  nodeId: string;
  label: string;
  kind: string;
  group?: string | null;
  tags?: string[];
};

export type HtmlDiffLine = { op: ' ' | '+' | '-'; text: string };
export type HtmlDiff = { available: boolean; lines: HtmlDiffLine[]; truncated: boolean };

export type RunSummary = {
  finishedAt: string;
  status: string;
  total: number;
  failures: { id: string; variant: string; class: 'visual' | 'infra' | 'error'; message: string; retries: number }[];
  flaky: { id: string; variant: string; retries: number; message: string }[];
  warnings: { id: string; variant: string; message: string }[];
};

export type StabilizeRow = {
  node: string;
  variant: string;
  key: string;
  stable: 'yes' | 'no' | 'error';
  diffPixels: number | null;
  bbox: BBox | null;
  cause: string;
};

export type StabilizeReport = {
  generatedAt: string;
  runs: number;
  total: number;
  unstable: number;
  rows: StabilizeRow[];
};

export declare const ROOT: string;
export declare const DIRS: {
  goldens: string; actual: string; diff: string; records: string;
  collections: string; visualFailures: string; summary: string; stabilize: string;
};

export declare function sha256(input: Buffer | string): string;
export declare function writeAtomic(file: string, data: string | Buffer): void;
export declare function paths(variant: string, file: string): {
  actual: string; actualHtml: string; approved: string; approvedHtml: string;
  meta: string; diff: string; record: string;
};
export declare function readMeta(variant: string, file: string): ApprovalMeta | null;
export declare function readDenied(): Record<string, DeniedEntry>;
export declare function writeDenied(obj: Record<string, DeniedEntry>): void;
export declare function compare(
  actualPng: Buffer, approvedPng: Buffer, opts?: { pixelThreshold?: number; ignoreAntialiasing?: boolean },
): {
  width: number; height: number; approvedWidth: number; approvedHeight: number;
  diffPixels: number | null; diffRatio: number | null; bbox: BBox | null; diffPng: Buffer | null;
};
export declare function evaluate(args: {
  variant: string;
  file: string;
  actualPng: Buffer;
  htmlHash?: string | null;
  htmlText?: string | null;
  configHash: string;
  volatile?: boolean;
  info: RecordInfo;
  settled?: boolean;
  canvases?: CanvasRect[];
  failOnHtml?: boolean;
  ignoreAntialiasing?: boolean;
  threshold?: number;
  pixelThreshold?: number;
}): ReviewRecord;
export declare function listRecords(): ReviewRecord[];
export declare function listGoldens(): string[];
export declare function readRecord(key: string): ReviewRecord | null;
export declare function writeRecord(rec: ReviewRecord): ReviewRecord;
export declare function approve(key: string, note?: string): ReviewRecord;
export declare function deny(key: string, note?: string): ReviewRecord;
export declare function approveWhere(predicate: (r: ReviewRecord) => boolean): number;
export declare function htmlDiff(key: string): HtmlDiff;
export declare function cleanActual(): void;
export declare function noteCollection(variant: string, file: string, count: number): number | null;
export declare function markVisualFailure(variant: string, file: string, message: string): void;
export declare function readVisualFailure(variant: string, file: string): string | null;
export declare function clearVisualFailure(variant: string, file: string): void;
export declare function readRunSummary(): RunSummary | null;
export declare function readStabilize(): StabilizeReport | null;
