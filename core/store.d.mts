/** Types for store.mjs (review store). Keep in sync with the implementation. */

export type ReviewStatus = 'new' | 'match' | 'changed' | 'volatile';
export type ReviewReason = 'size' | 'pixels' | 'html' | 'config';
export type ReviewDecision = 'pending' | 'approved' | 'denied';

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
  htmlHash: string | null;
  approvedHtmlHash: string | null;
  configHash: string;
  approvedConfigHash: string | null;
  actualHash: string;
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

export declare const ROOT: string;
export declare const DIRS: { goldens: string; actual: string; diff: string; records: string };

export declare function sha256(input: Buffer | string): string;
export declare function writeAtomic(file: string, data: string | Buffer): void;
export declare function paths(variant: string, file: string): {
  actual: string; approved: string; meta: string; diff: string; record: string;
};
export declare function readMeta(variant: string, file: string): ApprovalMeta | null;
export declare function readDenied(): Record<string, DeniedEntry>;
export declare function writeDenied(obj: Record<string, DeniedEntry>): void;
export declare function compare(
  actualPng: Buffer, approvedPng: Buffer, opts?: { pixelThreshold?: number },
): {
  width: number; height: number; approvedWidth: number; approvedHeight: number;
  diffPixels: number | null; diffRatio: number | null; diffPng: Buffer | null;
};
export declare function evaluate(args: {
  variant: string;
  file: string;
  actualPng: Buffer;
  htmlHash?: string | null;
  configHash: string;
  volatile?: boolean;
  info: RecordInfo;
  threshold?: number;
  pixelThreshold?: number;
}): ReviewRecord;
export declare function listRecords(): ReviewRecord[];
export declare function readRecord(key: string): ReviewRecord | null;
export declare function writeRecord(rec: ReviewRecord): ReviewRecord;
export declare function approve(key: string, note?: string): ReviewRecord;
export declare function deny(key: string, note?: string): ReviewRecord;
export declare function approveWhere(predicate: (r: ReviewRecord) => boolean): number;
export declare function cleanActual(): void;
