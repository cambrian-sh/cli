// TypeScript interfaces for Cambrian proto messages.
// Hand-written subset of api/proto/cambrian.proto.
// Proto-loader handles runtime serialization; these provide compile-time safety.

// ── Orchestrator service ───────────────────────────────────────────

export interface ListToolsRequest {}
export interface ListToolsResponse {
  tools: ToolDescriptor[];
}
export interface ToolDescriptor {
  name: string;
  description: string;
  schema_json: string;
  dangerous: boolean;
}
export interface ExecuteToolRequest {
  tool_name: string;
  args_json: string;
  session_token_id: string;
  step_index: number;
}
export interface ExecuteToolResponse {
  result_json: string;
  result_cid: string;
  denied: boolean;
  deny_reason: string;
  error: string;
  arg_hash: string;
  result_hash: string;
}

// ── Skills (ADR-0046) ─────────────────────────────────────────────

export interface ListSkillsRequest {}
export interface ListSkillsResponse {
  skills: SkillDescriptor[];
}
export interface SkillDescriptor {
  name: string;
  description: string;
  instructions: string;
  tool_grants: string[];
}

// ── Approvals ──────────────────────────────────────────────────────

export interface WatchApprovalsRequest {}
export interface ApprovalRequest {
  id: string;
  agent_id: string;
  tool_name: string;
  args_preview: string;
}
export interface ApprovalDecisionRequest {
  id: string;
  approve: boolean;
  approver_id: string;
}
export interface ApprovalDecisionResponse {
  ok: boolean;
}

// ── Watches ────────────────────────────────────────────────────────

export interface WatchConfigProto {
  id: string;
  name: string;
  description: string;
  source_type: string;
  source_stream_id: string;
  condition: string;
  condition_type: string;
  action: WatchActionProto | null;
  active: boolean;
  response_mode: string;
  daemon_params: Record<string, string>;
  max_concurrent_plans: number;
}
export interface WatchActionProto {
  type: string;
  target_type: string;
  target: string;
  payload: string;
}
export interface RegisterWatchRequest {
  config: WatchConfigProto | null;
}
export interface RegisterWatchResponse {
  id: string;
}
export interface ListWatchesRequest {}
export interface ListWatchesResponse {
  configs: WatchConfigProto[];
}
export interface DeleteWatchRequest {
  id: string;
}
export interface DeleteWatchResponse {
  id: string;
}
export interface SetWatchActiveRequest {
  id: string;
  active: boolean;
}
export interface SetWatchActiveResponse {
  id: string;
  active: boolean;
}

// ── Memory ─────────────────────────────────────────────────────────

export interface MemoryRequest {
  query: string;
  top_k: number;
}
export interface MemoryResult {
  text: string;
  score: number;
  metadata: string;
}
export interface MemoryResponse {
  results: MemoryResult[];
}
export interface IngestMemoryRequest {
  text: string;
  tags: string[];
  importance: number;
  source: string;
  session_id: string;
}
export interface IngestMemoryResponse {
  doc_id: string;
}

// ── SymbiosisEvent (used by ChatStream, for future phases) ────────

export type SymbiosisEvent =
  | { payload: "status_update"; status_update: StatusUpdate }
  | { payload: "thought_chunk"; thought_chunk: ThoughtChunk }
  | { payload: "agent_log"; agent_log: AgentLog }
  | { payload: "intervention_request"; intervention_request: InterventionRequest }
  | { payload: "auction_event"; auction_event: AuctionEvent }
  | { payload: "plan_topology"; plan_topology: PlanTopology };

export interface StatusUpdate {
  status: string;
  detail: string;
}
export interface ThoughtChunk {
  text: string;
  done: boolean;
}
export interface AgentLog {
  timestamp: string;
  level: string;
  message: string;
  agent_id: string;
}
export interface InterventionRequest {
  step_index: number;
  description: string;
  is_destructive: boolean;
  step_type: string;
}
export interface AuctionEvent {
  task_id: string;
  task_desc: string;
  status: string;
  winner_id: string;
  bids: BidEntry[];
  error_msg: string;
}
export interface BidEntry {
  agent_id: string;
  confidence: number;
  rationale: string;
  latency_ms: number;
  is_tool: boolean;
}
export interface PlanTopology {
  steps: PlanStep[];
  subject: string;
}
export interface PlanStep {
  index: number;
  query: string;
  depends_on: number[];
  is_thought: boolean;
}

// ── OperatorConsole (ADR-0047, ADR CLI-001) ────────────────────────
// Operator-plane service. Distinct from Orchestrator: human Operator/Viewer
// audience, Bearer-token auth (not x-agent-id). Used for login, snapshot,
// StreamEvents, ResolveHITL, QueryAudit, and command RPCs.

export interface LoginRequest {
  username: string;
  password: string;
}
export interface LoginResponse {
  token: string;
  role: string; // "operator" | "viewer"
}

export interface SnapshotRequest {}
export interface PlanInFlightOp {
  session_id: string;
  plan_id: string;
  active_step: number;
  status: string;
  active_agent: string;
  cost_so_far: number;
}
export interface SessionSummaryOp {
  id: string;
  goal: string;
  status: string;
}
export interface SnapshotResponse {
  as_of_seq: number;
  plans: PlanInFlightOp[];
  sessions: SessionSummaryOp[];
  kernel_version: string;
  contract_version: string;
  capabilities: string[];
}

export interface SubscribeRequest {
  last_seq: number;
}

export interface ResyncRequired {
  latest_seq: number;
}
export interface BidEntryOp {
  agent_id: string;
  confidence: number;
  rationale: string;
  latency_ms: number;
}
export interface AuctionEventOp {
  task_id: string;
  task_desc: string;
  status: string;
  winner_id: string;
  bids: BidEntryOp[];
  error_msg: string;
}
export interface AgentReadyOp {
  agent_id: string;
  source_hash: string;
  trust_score: number;
  capabilities: string[];
  interview_ms: number;
}
export interface SessionDormantOp {
  session_id: string;
  ttl_seconds: number;
}
export interface SessionCompletedOp {
  session_id: string;
  documents_merged: number;
}
export interface MemoryPressureOp {
  total_documents: number;
  index_size_bytes: number;
  trigger: string;
}
export interface DaemonCrashedOp {
  agent_id: string;
  stream_id: string;
}
export interface WatchTriggeredOp {
  watch_config_id: string;
  stream_id: string;
  action_target: string;
}
export interface MemoryWrittenOp {
  doc_id: string;
  doc_type: string;
  session_id: string;
  source: string;
  summary: string;
}
export interface HITLRaisedOp {
  intervention_id: string;
  session_id: string;
  agent_id: string;
  description: string;
  is_destructive: boolean;
}
export interface VerifierRoundOp {
  task_id: string;
  winner_agent: string;
  quality_score: number;
  bid_confidence: number;
  critique: string;
}
export interface LLMHealthOp {
  model_id: string;
  state: string;
  reason: string;
}
export interface PlanStateOp {
  session_id: string;
  plan_id: string;
  active_step: number;
  status: string;
  active_agent: string;
  cost_so_far: number;
  terminal: boolean;
}
export interface TokenChunkOp {
  session_id: string;
  step_index: number;
  text: string;
}
export interface AuditOp {
  id: string;
  command_id: string;
  actor: string;
  role: string;
  action_type: string;
  target_type: string;
  target_id: string;
  before: string;
  after: string;
  reason: string;
  result: string;
}

// OperatorEvent is the sequenced envelope. seq is the global monotonic
// cursor. payload is a oneof. token events have seq=0 and are live-only.
export type OperatorEvent =
  | { payload: "resync"; seq: number; resync: ResyncRequired }
  | { payload: "auction"; seq: number; auction: AuctionEventOp }
  | { payload: "agent_ready"; seq: number; agent_ready: AgentReadyOp }
  | { payload: "session_dormant"; seq: number; session_dormant: SessionDormantOp }
  | { payload: "session_completed"; seq: number; session_completed: SessionCompletedOp }
  | { payload: "memory_pressure"; seq: number; memory_pressure: MemoryPressureOp }
  | { payload: "daemon_crashed"; seq: number; daemon_crashed: DaemonCrashedOp }
  | { payload: "watch_triggered"; seq: number; watch_triggered: WatchTriggeredOp }
  | { payload: "memory_written"; seq: number; memory_written: MemoryWrittenOp }
  | { payload: "hitl_raised"; seq: number; hitl_raised: HITLRaisedOp }
  | { payload: "verifier_round"; seq: number; verifier_round: VerifierRoundOp }
  | { payload: "llm_health"; seq: number; llm_health: LLMHealthOp }
  | { payload: "plan_state"; seq: number; plan_state: PlanStateOp }
  | { payload: "audit"; seq: number; audit: AuditOp }
  | { payload: "token"; seq: number; token: TokenChunkOp };

// CommandAck is the result of a mutating command. deduped=true means
// command_id was already applied (idempotent retry).
export interface CommandAck {
  command_id: string;
  deduped: boolean;
}

// All mutating commands carry command_id (idempotency) + reason (audit).
export interface ResolveHITLRequest {
  command_id: string;
  reason: string;
  intervention_id: string;
  approve: boolean;
}
export interface SessionCommandRequest {
  command_id: string;
  reason: string;
  session_id: string;
}
export interface SetToolGrantRequest {
  command_id: string;
  reason: string;
  agent_id: string;
  tool_name: string;
  granted: boolean;
}
export interface TagMemoryRequest {
  command_id: string;
  reason: string;
  doc_id: string;
  tag: string;
  add: boolean;
}
export interface SetScopeRequest {
  command_id: string;
  reason: string;
  agent_id: string;
  required_tags: string[];
  any_of_tags: string[];
  forbidden_tags: string[];
}
export interface RegisterSkillRequest {
  command_id: string;
  reason: string;
  name: string;
  description: string;
  instructions: string;
  tool_grants: string[];
  scope_tags: string[];
}
export interface RegisterMCPRequest {
  command_id: string;
  reason: string;
  name: string;
  command: string;
  url: string;
}
export interface TriggerConsolidationRequest {
  command_id: string;
  reason: string;
  scope: string;
}
export interface CreateSessionRequest {
  command_id: string;
  reason: string;
  goal: string;
  parent_id: string;
}
export interface CreateSessionResponse {
  command_id: string;
  deduped: boolean;
  session_id: string;
}
export interface SendMessageRequest {
  command_id: string;
  reason: string;
  session_id: string;
  text: string;
}
export interface InjectCorrectionRequest {
  command_id: string;
  reason: string;
  session_id: string;
  instruction: string;
}

export interface QueryAuditRequest {
  actor: string;
  target_type: string;
  target_id: string;
  action_type: string;
  limit: number;
}
export interface QueryAuditResponse {
  entries: AuditOp[];
}
