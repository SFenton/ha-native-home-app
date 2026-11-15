/** Shapes returned by the Studio's `/native/api/ha/*` endpoints (server/ha-publication.ts). */
export interface HaPublicationEntry { revision: number; publishedAt: string; publishedBy: string | null; envelopeSha256: string; capabilities: string[] }
export interface HaPublicationSummary { epoch: string; current: HaPublicationEntry | null; history: HaPublicationEntry[]; storedAssets: number; /** Whether the app serves the draft's document now; null when unknown. */ draftIsLive?: boolean | null; /** The saved draft revision that answer is about. */ draftRevision?: number }
export interface HaPublishResult { epoch: string; revision: number; envelopeSha256: string; uploadedAssets?: number; skippedAssets?: number }
