import type { Json } from '../../types';
import type { CallService, Operand, Predicate } from '../expression';
import type { ReadResult, Tri, Viewer } from '../evaluator';
import type { CompositionIssue } from '../json';
import type { LogicEntry, LogicHole, LogicRef } from '../logic-library';
import type { PipelineInputs, PipelineOutput, PipelineRequest, PipelineSource, PipelineStep } from '../pipeline/schema';
import type { Shape } from '../pipeline/shape';

export type Immutable<T> = T extends (...args: never[]) => unknown ? T
  : T extends readonly (infer U)[] ? readonly Immutable<U>[]
    : T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
export type GraphJSON = Immutable<Json>;
export type GraphPipelineStep = PipelineStep;
export type GraphPipelineInputs = PipelineInputs;
export type GraphPipelineSource = PipelineSource;

export type LogicAnchor =
  | { readonly kind: 'page' | 'modal' | 'component' | 'logic' | 'flow'; readonly id: string; readonly nodeId?: string; readonly field: string }
  | { readonly kind: 'document'; readonly id: string; readonly field: string; readonly fingerprint: string };

export interface PortType {
  readonly valueType: 'number' | 'text' | 'yes/no' | 'time' | 'list' | 'entity' | 'record' | 'unresolved';
  readonly representation: 'operand' | 'condition' | 'stream' | 'source-selection';
  readonly shape: Immutable<Shape>;
  readonly nullable: boolean;
  /** Item values never escape this lexical scope. */
  readonly scopeId?: string;
  readonly unit?: string;
}
export interface GraphPort {
  readonly id: string;
  readonly label: string;
  readonly type: PortType;
  readonly required: boolean;
  /** RFC 6901 location inside the payload; absent for structural stream ports. */
  readonly binding?: string;
}

/** Template substitution changes values, never the grammar discriminator. */
export type TemplateAst<T> = T extends readonly (infer U)[] ? TemplateAst<U>[]
  : T extends object ? { [K in keyof T]: K extends 'type' | 'op' ? T[K] : TemplateAst<T[K]> } | LogicRef | LogicHole
    : T | LogicHole;

export type GraphPayload =
  | { readonly kind: 'operand'; readonly value: Immutable<Operand> }
  | { readonly kind: 'source-selection'; readonly value: string }
  | { readonly kind: 'condition'; readonly value: Immutable<Predicate> }
  | { readonly kind: 'call'; readonly value: Immutable<CallService> }
  | { readonly kind: 'template'; readonly value: Immutable<TemplateAst<Operand | Predicate>>; readonly representation: 'operand' | 'condition' }
  | { readonly kind: 'logic-ref'; readonly value: Immutable<LogicRef>; readonly representation: 'operand' | 'condition' }
  | { readonly kind: 'hole'; readonly value: Immutable<LogicHole> }
  | { readonly kind: 'flow'; readonly value: Immutable<GraphPipelineSource> }
  | { readonly kind: 'flow-inputs'; readonly value: Immutable<GraphPipelineInputs> }
  | { readonly kind: 'request'; readonly value: Immutable<PipelineRequest> }
  | { readonly kind: 'step'; readonly value: Immutable<GraphPipelineStep> }
  | { readonly kind: 'output'; readonly value: Immutable<PipelineOutput> }
  | { readonly kind: 'logic-entry'; readonly value: Immutable<LogicEntry> }
  | { readonly kind: 'slot'; readonly value: GraphJSON }
  | { readonly kind: 'document'; readonly value: GraphJSON }
  | { readonly kind: 'opaque'; readonly value: GraphJSON; readonly pointer: string; readonly reason: string };

export interface GraphNode {
  readonly id: string;
  readonly catalogKey: string;
  readonly payload: GraphPayload;
  readonly inputs: readonly GraphPort[];
  readonly outputs: readonly GraphPort[];
  readonly scopeId: string;
  readonly origins: readonly string[];
  readonly provenance: 'lifted' | 'authored' | 'opaque';
  readonly position?: { readonly x: number; readonly y: number };
}
export interface GraphEdge {
  readonly id: string;
  readonly kind: PortType['representation'];
  readonly from: { readonly nodeId: string; readonly portId: string };
  readonly to: { readonly nodeId: string; readonly portId: string };
  readonly binding: string;
}
export type GraphScopeKind = 'document' | 'template' | 'flow' | 'flow-parameter' | 'flow-request' | 'flow-step' | 'flow-output' | 'repeat' | 'placeholder' | 'for-each';
export interface GraphScope {
  readonly id: string;
  readonly kind: GraphScopeKind;
  readonly parentId?: string;
  readonly ownerNodeId?: string;
  readonly itemShape?: Immutable<Shape>;
}
export interface GraphDestination {
  readonly kind: 'operand' | 'condition' | 'call' | 'flow' | 'document' | 'fragment' | 'slot';
  readonly type?: PortType;
  readonly allowControl?: boolean;
  /** The actual consuming field; required for standalone slots, whose native rules vary by destination. */
  readonly context?: { readonly document: GraphJSON; readonly pointer: string };
}
export interface GraphRoot {
  readonly nodeId: string;
  readonly portId: string;
  readonly anchor: LogicAnchor;
  readonly destination: GraphDestination;
}
export interface LogicGraph {
  readonly version: 1;
  readonly roots: readonly GraphRoot[];
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly scopes: readonly GraphScope[];
  readonly frames: readonly { readonly id: string; readonly scopeId: string; readonly nodeIds: readonly string[]; readonly label?: string }[];
  readonly original: GraphJSON;
}
export interface GraphDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly hint?: true;
  readonly code: CompositionIssue['code'] | 'opaque_region' | 'invalid_layout' | 'scope_mismatch' | 'occupied_input' | 'cycle' | 'recipe_disabled' | 'average_fallback_overflow';
  readonly message: string;
  readonly anchor: LogicAnchor;
  readonly nodeId?: string;
  readonly portId?: string;
  readonly pointer: string;
  readonly capability?: string;
  readonly usePointer?: string;
  readonly authoredPointer?: string;
  readonly documentPointer?: string;
}
export interface BudgetMeter {
  readonly kind: string;
  readonly pointer: string;
  readonly used: number;
  readonly limit: number | null;
  readonly ratio: number | null;
  readonly visible: boolean;
  readonly exceeded: boolean;
}
export interface GraphBudget {
  readonly anchor: LogicAnchor;
  readonly nodes: number | null;
  readonly depth: number | null;
  readonly conditions: readonly { readonly pointer: string; readonly nodes: number | null; readonly depth: number | null; readonly astNodes: number | null; readonly astDepth: number | null }[];
  readonly scopes: readonly {
    readonly id: string;
    readonly kind: 'expression' | 'predicate';
    readonly pointer: string;
    readonly nodes: number | null;
    readonly depth: number | null;
    readonly nodeLimit: number | null;
    readonly depthLimit: number | null;
    readonly entries: readonly string[];
    readonly nodeAccounting: 'compiler' | 'unavailable';
  }[];
  readonly counterResets: readonly { readonly pointer: string; readonly kind: 'choose' | 'count' | 'confirmation' | 'restore'; readonly scopeId?: string }[] | null;
  readonly cases: number | null;
  readonly steps: number | null;
  readonly capabilities: readonly string[];
  readonly duplicatedUseCost: number | null;
  readonly generatedFlowCount: number | null;
  readonly accepted: boolean;
  readonly compilerIssues: readonly CompositionIssue[];
  readonly accounting: 'partial' | 'unavailable';
  readonly accountingUnavailableReason: string;
  readonly runtimeLimit: number;
  readonly meters: readonly BudgetMeter[];
  readonly compactVisible: boolean;
  readonly firstExceedingPointer?: string;
}
export interface GraphSourceLocation {
  readonly pointer: string;
  readonly nodeId: string;
  readonly portId?: string;
  readonly anchor: LogicAnchor;
  readonly usePointer?: string;
  readonly authoredPointer?: string;
  readonly stage?: 'expanded';
}
export type GraphSourceMap = readonly GraphSourceLocation[];
export interface ASTReplacement { readonly anchor: LogicAnchor; readonly ast: GraphJSON }
export type LoweringResult =
  | {
    readonly ok: true;
    readonly ast: Json;
    readonly replacements: readonly ASTReplacement[];
    readonly generatedSources: readonly GraphPipelineSource[];
    readonly generatedLibrary: readonly LogicEntry[];
    readonly sourceMap: GraphSourceMap;
    readonly budgets: readonly GraphBudget[];
    readonly capabilities: readonly string[];
    readonly diagnostics: readonly GraphDiagnostic[];
  }
  | { readonly ok: false; readonly original: GraphJSON; readonly errors: readonly GraphDiagnostic[]; readonly budgets: readonly GraphBudget[] };
export interface OpaqueRegion {
  readonly nodeId: string;
  readonly pointer: string;
  readonly original: GraphJSON;
  readonly reason: string;
}
export interface LiftResult {
  readonly graph: LogicGraph;
  readonly sourceMap: GraphSourceMap;
  readonly opaqueRegions: readonly OpaqueRegion[];
  readonly warnings: readonly GraphDiagnostic[];
}

export interface StudioCanvasMetadata {
  readonly version: 1;
  readonly canvases: readonly {
    readonly id: string;
    readonly roots: readonly LogicAnchor[];
    readonly nodes: readonly { readonly id: string; readonly origins: readonly string[]; readonly x: number; readonly y: number }[];
    readonly viewport?: { readonly x: number; readonly y: number; readonly zoom: number };
    readonly groups?: readonly { readonly id: string; readonly label: string; readonly nodeIds: readonly string[] }[];
  }[];
  readonly bundles?: readonly { readonly id: string; readonly name: string; readonly outputs: readonly { readonly name: string; readonly logicId: string }[] }[];
}
export interface LogicUseBinding {
  readonly use: LogicAnchor;
  readonly argument: string;
  readonly from: { readonly kind: 'use-tile'; readonly field: string };
}

export type SimulationResult =
  | { readonly kind: 'condition'; readonly answer: Tri }
  | { readonly kind: 'operand'; readonly answer: Immutable<ReadResult> };
export interface SimulationClock { readonly now: string; readonly utcOffsetMinutes: number }
export type ReadCapture = {
  readonly sourceId: string;
  readonly answer: Immutable<ReadResult>;
} & (
  | { readonly access?: 'read'; readonly path: readonly string[] }
  | { readonly access: 'raw-state' | 'last-changed'; readonly path?: never }
);
export type SimulationPin =
  | ({ readonly kind: 'source'; readonly blockId: string } & ReadCapture)
  | { readonly kind: 'output'; readonly blockId: string; readonly portId: string; readonly result: SimulationResult };
export interface SimulationCase {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly fingerprint: string;
  readonly capturedAt: string;
  readonly base: {
    readonly reads: readonly ReadCapture[];
    readonly flowResponses: readonly { readonly sourceId: string; readonly requestFingerprint: string; readonly response: GraphJSON; readonly at: string; readonly trimmed: boolean }[];
    readonly clock: SimulationClock;
    readonly previousText: readonly { readonly output: LogicAnchor; readonly text: string }[];
    readonly viewer?: Immutable<Viewer>;
    readonly viewerPerson?: Immutable<ReadResult>;
  };
  readonly pins: readonly SimulationPin[];
  readonly clock?: SimulationClock;
  readonly expected: readonly (
    { readonly output: LogicAnchor; readonly kind: 'condition'; readonly answer: Tri }
    | { readonly output: LogicAnchor; readonly kind: 'operand'; readonly answer: Immutable<ReadResult>; readonly absoluteTolerance?: number }
  )[];
}
export interface TraceEvent {
  readonly runId: string;
  readonly root: LogicAnchor;
  readonly blockId: string;
  readonly pointer: string;
  readonly portId?: string;
  readonly item?: { readonly index: number; readonly identity?: string };
  readonly inputs: readonly { readonly portId: string; readonly result: SimulationResult }[];
  readonly output?: SimulationResult;
  readonly provenance: 'live' | 'capture' | 'scenario' | 'pin' | 'computed';
  readonly state: 'evaluated' | 'skipped' | 'overridden' | 'failed';
  readonly reason?: string;
  readonly clock: SimulationClock;
  readonly cost: { readonly used: number; readonly limit: number };
}

export interface CanvasSnapshot { readonly document: GraphJSON; readonly revision: string }
export interface CanvasOutput { readonly anchor: LogicAnchor; readonly name: string; readonly type: PortType }
export interface CanvasUse { readonly anchor: LogicAnchor; readonly output: LogicAnchor; readonly arguments: Readonly<Record<string, GraphJSON>> }
export type CanvasLens = { readonly kind: 'values' | 'stand-in' } | { readonly kind: 'use'; readonly anchor: LogicAnchor };
export type CanvasWriteResult =
  | { readonly status: 'applied' | 'saved'; readonly snapshot: CanvasSnapshot }
  | { readonly status: 'conflict'; readonly remote: CanvasSnapshot }
  | { readonly status: 'invalid'; readonly diagnostics: readonly GraphDiagnostic[] };
export interface CanvasHost {
  open(anchor: LogicAnchor): void;
  openOutput(output: CanvasOutput): void;
  snapshot(): CanvasSnapshot;
  apply(transaction: { readonly revision: string; readonly label: string; readonly replacements: readonly ASTReplacement[]; readonly generatedSources: readonly Immutable<GraphPipelineSource>[]; readonly generatedLibrary: readonly Immutable<LogicEntry>[] }): Promise<CanvasWriteResult>;
  save(revision: string): Promise<CanvasWriteResult>;
  compareConflict(local: CanvasSnapshot, remote: CanvasSnapshot): void;
  readonly data: { readonly sources: readonly { readonly id: string; readonly name: string; readonly shape?: Immutable<Shape> }[] };
  readonly targetCapabilities: readonly string[];
  uses(output: LogicAnchor): readonly CanvasUse[];
  preview(lens: CanvasLens): void;
}
