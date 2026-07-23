import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { scrubSecretLikeText } from "../security/secret-redaction.js";

const CANONICAL_CLI_TIMEOUT_MS = 30_000;
const CANONICAL_CLI_OUTPUT_LIMIT = 1024 * 1024;

export type DexMemoriaV2Destination =
  | { scope: "project" }
  | { scope: "global" }
  | { scope: "theme"; theme: string };

export type DexMemoriaV2Route =
  | { trigger: "L1"; target: "L2" }
  | { trigger: "L1"; target: "L3"; owner_skill: string };

export type DexMemoriaV2Classification = {
  item: string;
  destinations: DexMemoriaV2Destination[];
  route: DexMemoriaV2Route;
  tags: string[];
};

export type DexMemoriaV2OperationRequest = {
  contract: "dex.memory.operation.request.v2";
  implementation_version: "v2";
  scope: "project" | "global" | "theme" | "dual";
  workspace_root: string;
  memory_home: string;
  operation_id: string;
  theme?: string;
};

export type DexMemoriaV2OperationRoute = {
  scope: "project" | "global" | "theme";
  theme?: string;
  resolved_root: string;
  operation_id: string;
  idempotency_key: string;
  transaction_id: string;
  receipt_id: string;
};

export type DexMemoriaV2RouteReceipt = DexMemoriaV2OperationRoute & {
  status: "COMMITTED" | "PENDING";
  receipt_path?: string;
  validation_receipt_path?: string;
  validation_receipt_hash?: string;
  validation_contract?: "dex.memory.capability.unit-receipt.v2";
  validation_ok?: boolean;
  candidate_id?: string;
  content_hash?: string;
  route_identity?: string;
  deduplicated?: boolean;
  write_set_hash?: string;
  failure_code?: string;
};

export type DexMemoriaV2ValidationReceiptRef = {
  scope: "project" | "global" | "theme";
  writer_receipt_id: string;
  validation_receipt_id: string;
  validation_receipt_path: string;
  validation_receipt_hash: string;
  write_set_hash: string;
  candidate_id: string;
  content_hash: string;
  route_identity: string;
  deduplicated: boolean;
  files: string[];
};

export type DexMemoriaV2CanonicalReceipt = {
  contract: "dex.memory.operation.receipt.v2";
  implementation_version: "v2";
  requested_scope: "project" | "global" | "theme" | "dual";
  operation_id: string;
  status: "COMMITTED" | "PARTIAL_PENDING" | "FAILED";
  recovery_mode: "resume_pending_sibling" | null;
  routes: DexMemoriaV2OperationRoute[];
  route_receipts: Record<string, DexMemoriaV2RouteReceipt>;
};

export type DexMemoriaV2WriteCandidate = {
  contract: "dex.memory.write.candidate.v2";
  target_layer: "L2" | "L3";
  slug: string;
  trigger: string;
  title: string;
  body: string;
  tags: string[];
  owner_skill?: string;
};

export type DexMemoriaV2ExecutionInput = {
  operation_request: DexMemoriaV2OperationRequest;
  candidate: DexMemoriaV2WriteCandidate;
};

export type DexMemoriaV2Executor = {
  execute(input: DexMemoriaV2ExecutionInput): Promise<DexMemoriaV2CanonicalReceipt>;
  resume?(receipt: DexMemoriaV2CanonicalReceipt, candidate: DexMemoriaV2WriteCandidate, operationRequest: DexMemoriaV2OperationRequest): Promise<DexMemoriaV2CanonicalReceipt>;
};

export type DexMemoriaV2MiningClassifierInput = {
  flow_id: string;
  candidate_id: string;
  item: string;
  source: "gold_mining" | "parking_lot";
  evidence_score: number;
};

export type DexMemoriaV2ResolvedMiningClassification =
  | {
      status: "resolved";
      density: "light";
      requested_destinations: [DexMemoriaV2Destination, ...DexMemoriaV2Destination[]];
      tags: [string, ...string[]];
      owner_skill?: never;
    }
  | {
      status: "resolved";
      density: "deep";
      requested_destinations: [DexMemoriaV2Destination, ...DexMemoriaV2Destination[]];
      tags: [string, ...string[]];
      owner_skill: string;
    };

export type DexMemoriaV2MiningClassification = DexMemoriaV2ResolvedMiningClassification | {
  status: "unresolved";
  reason: "destinations_required" | "tags_required" | "owner_skill_required" | "classifier_unavailable";
};

export type DexMemoriaV2FlowWriterConfig = {
  profile: "v2";
  executor: DexMemoriaV2Executor;
  canonical_root?: string;
  entrypoint?: string;
  memory_home?: string;
  workspace_root?: string;
  classify?: (input: DexMemoriaV2MiningClassifierInput) => DexMemoriaV2MiningClassification;
  default_classification?: DexMemoriaV2MiningClassification;
};

export type DexMemoriaV2AdapterResult = {
  status: "complete" | "partial_pending" | "resume_pending_sibling";
  operation_id: string;
  receipts: DexMemoriaV2CanonicalReceipt[];
  validation_receipts: DexMemoriaV2ValidationReceiptRef[];
  pending_destinations: DexMemoriaV2Destination[];
  failure?: { destination: DexMemoriaV2Destination; message: string };
};

export function classifyDexMemoriaV2Intent(input: {
  item: string;
  density: "light" | "deep";
  requested_destinations: DexMemoriaV2Destination[];
  owner_skill?: string;
  tags: string[];
}): DexMemoriaV2Classification {
  const item = requireNonEmpty(input.item, "item");
  // Scope/theme is an explicit producer decision. Text keywords and implicit
  // project defaults are never routing authority.
  if (!input.requested_destinations?.length) throw new Error("DEX_MEMORIA_V2_DESTINATIONS_REQUIRED");
  const destinations = uniqueDestinations(input.requested_destinations.map(normalizeDestination));
  assertSupportedDestinationSet(destinations);
  const route: DexMemoriaV2Route = input.density === "deep"
    ? { trigger: "L1", target: "L3", owner_skill: requireNonEmpty(input.owner_skill, "owner_skill") }
    : { trigger: "L1", target: "L2" };
  return { item, destinations, route, tags: validateTags(input.tags) };
}

export function buildDexMemoriaV2OperationRequest(input: {
  operation_id: string;
  workspace_root: string;
  memory_home: string;
  classification: DexMemoriaV2Classification;
}): DexMemoriaV2OperationRequest {
  const destinations = input.classification.destinations;
  assertSupportedDestinationSet(destinations);
  const request: DexMemoriaV2OperationRequest = {
    contract: "dex.memory.operation.request.v2",
    implementation_version: "v2",
    scope: requestedScope(destinations),
    workspace_root: requireAbsolute(input.workspace_root, "workspace_root"),
    memory_home: requireAbsolute(input.memory_home, "memory_home"),
    operation_id: requireNonEmpty(input.operation_id, "operation_id")
  };
  if (destinations[0]?.scope === "theme") request.theme = destinations[0].theme;
  return request;
}

export async function executeDexMemoriaV2Adapter(input: {
  operation_id: string;
  slug: string;
  workspace_root: string;
  memory_home: string;
  classification: DexMemoriaV2Classification;
  executor: DexMemoriaV2Executor;
  resume_receipts?: DexMemoriaV2CanonicalReceipt[];
}): Promise<DexMemoriaV2AdapterResult> {
  const request = buildDexMemoriaV2OperationRequest(input);
  const candidate = buildWriteCandidate(input.slug, input.classification);
  const prior = input.resume_receipts?.find((receipt) => receipt.operation_id === request.operation_id);
  let receipt: DexMemoriaV2CanonicalReceipt;
  try {
    receipt = prior?.status === "PARTIAL_PENDING"
      ? await requireResume(input.executor)(prior, candidate, request)
      : await input.executor.execute({ operation_request: request, candidate });
  } catch (error) {
    return {
      status: "partial_pending",
      operation_id: request.operation_id,
      receipts: prior ? [prior] : [],
      validation_receipts: [],
      pending_destinations: destinationsFromRequest(request),
      failure: {
        destination: destinationsFromRequest(request)[0]!,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
  try {
    const validatedFilesByScope = await validateCanonicalReceipt(receipt, request, candidate);
    const validationReceipts = validationReceiptRefs(receipt, validatedFilesByScope);
    return {
      status: receipt.status === "COMMITTED" ? "complete" : receipt.status === "PARTIAL_PENDING" ? "resume_pending_sibling" : "partial_pending",
      operation_id: request.operation_id,
      receipts: [receipt],
      validation_receipts: validationReceipts,
      pending_destinations: pendingDestinations(receipt)
    };
  } catch (error) {
    if (!isReceiptEvidenceError(error)) throw error;
    return {
      status: "partial_pending",
      operation_id: request.operation_id,
      receipts: [receipt],
      validation_receipts: [],
      pending_destinations: destinationsFromRequest(request),
      failure: {
        destination: destinationsFromRequest(request)[0]!,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

export function createDexMemoriaV2CliExecutor(config: {
  canonical_root: string;
  entrypoint: string;
  node_executable?: string;
}): DexMemoriaV2Executor {
  if (!path.isAbsolute(config.canonical_root) || !path.isAbsolute(config.entrypoint)) {
    throw new Error("DEX_MEMORIA_V2_CANONICAL_PATHS_MUST_BE_ABSOLUTE");
  }
  const canonicalRoot = path.resolve(config.canonical_root);
  const entrypoint = path.resolve(config.entrypoint);
  if (!isInsideOrEqual(canonicalRoot, entrypoint)) throw new Error("DEX_MEMORIA_V2_ENTRYPOINT_OUTSIDE_CANONICAL_ROOT");
  const nodeExecutable = config.node_executable ?? process.execPath;
  return {
    execute: async (input) => {
      await runCanonicalCli<Record<string, unknown>>({
        canonicalRoot, entrypoint, nodeExecutable, args: ["v2", "plan"], payload: input.operation_request, acceptedExitCodes: [0]
      });
      return await runCanonicalCli<DexMemoriaV2CanonicalReceipt>({
        canonicalRoot,
        entrypoint,
        nodeExecutable,
        args: ["v2", "apply"],
        payload: { contract: "dex.memory.apply.request.v2", request: input.operation_request, candidate: input.candidate },
        acceptedExitCodes: [0, 5]
      });
    },
    resume: async (receipt, candidate, operationRequest) => await runCanonicalCli<DexMemoriaV2CanonicalReceipt>({
      canonicalRoot,
      entrypoint,
      nodeExecutable,
      args: ["v2", "resume"],
      payload: {
        contract: "dex.memory.resume.request.v2",
        candidate,
        receipt,
        request: operationRequest
      },
      acceptedExitCodes: [0, 5]
    })
  };
}

async function runCanonicalCli<T>(input: {
  canonicalRoot: string;
  entrypoint: string;
  nodeExecutable: string;
  args: string[];
  payload: unknown;
  acceptedExitCodes: number[];
}): Promise<T> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.nodeExecutable, [input.entrypoint, ...input.args], {
      cwd: input.canonicalRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout: NodeJS.Timeout;
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    timeout = setTimeout(() => {
      child.kill();
      finishReject(new Error(`DEX_MEMORIA_V2_CANONICAL_CLI_TIMEOUT: limit_ms=${CANONICAL_CLI_TIMEOUT_MS}`));
    }, CANONICAL_CLI_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout = appendBoundedOutput(stdout, chunk); });
    child.stderr.on("data", (chunk: string) => { stderr = appendBoundedOutput(stderr, chunk); });
    child.on("error", (error) => finishReject(error));
    child.on("close", (exitCode) => {
      if (settled) return;
      clearTimeout(timeout);
      if (!input.acceptedExitCodes.includes(exitCode ?? -1)) {
        return finishReject(new Error(`DEX_MEMORIA_V2_CANONICAL_CLI_FAILED: exit=${exitCode}; stderr=${scrubSecretLikeText(stderr.trim())}`));
      }
      try {
        const parsed = JSON.parse(stdout) as T;
        settled = true;
        resolve(parsed);
      } catch (error) {
        finishReject(new Error(`DEX_MEMORIA_V2_CANONICAL_RECEIPT_INVALID_JSON: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
    child.stdin.end(JSON.stringify(input.payload));
  });
}

function appendBoundedOutput(current: string, chunk: string): string {
  if (current.length >= CANONICAL_CLI_OUTPUT_LIMIT) return current;
  return (current + chunk).slice(0, CANONICAL_CLI_OUTPUT_LIMIT);
}

async function validateCanonicalReceipt(receipt: DexMemoriaV2CanonicalReceipt, request: DexMemoriaV2OperationRequest, candidate: DexMemoriaV2WriteCandidate): Promise<Map<string, string[]>> {
  if (receipt.contract !== "dex.memory.operation.receipt.v2" || receipt.implementation_version !== "v2") throw new Error("DEX_MEMORIA_V2_RECEIPT_CONTRACT_INVALID");
  if (receipt.operation_id !== request.operation_id || receipt.requested_scope !== request.scope) throw new Error("DEX_MEMORIA_V2_RECEIPT_OPERATION_MISMATCH");
  const expectedScopes = request.scope === "dual" ? ["project", "global"] : [request.scope];
  if (receipt.routes.map((route) => route.scope).join(",") !== expectedScopes.join(",")) throw new Error("DEX_MEMORIA_V2_RECEIPT_ROUTES_INVALID");
  for (const identity of ["idempotency_key", "transaction_id", "receipt_id"] as const) {
    if (new Set(receipt.routes.map((route) => route[identity])).size !== receipt.routes.length) throw new Error("DEX_MEMORIA_V2_RECEIPTS_NOT_INDEPENDENT");
  }
  const committedRouteReceipts = receipt.routes.map((route) => receipt.route_receipts[route.scope]).filter((routeReceipt) => routeReceipt?.status === "COMMITTED");
  if (committedRouteReceipts.some((routeReceipt) => !/^[a-f0-9]{64}$/.test(routeReceipt!.candidate_id ?? "") || !/^[a-f0-9]{64}$/.test(routeReceipt!.content_hash ?? "") || !/^[a-f0-9]{64}$/.test(routeReceipt!.route_identity ?? ""))) {
    throw new Error("DEX_MEMORIA_V2_ROUTE_CONTENT_IDENTITY_INVALID");
  }
  if (new Set(committedRouteReceipts.map((routeReceipt) => routeReceipt!.candidate_id)).size > 1) {
    throw new Error("DEX_MEMORIA_V2_CROSS_SCOPE_CONTENT_IDENTITY_MISMATCH");
  }
  const expectedCandidateId = hashCanonicalJson(candidate);
  if (committedRouteReceipts.some((routeReceipt) => routeReceipt!.candidate_id !== expectedCandidateId)) {
    throw new Error("DEX_MEMORIA_V2_CORE_CANDIDATE_ID_MISMATCH");
  }
  if (new Set(committedRouteReceipts.map((routeReceipt) => routeReceipt!.route_identity)).size !== committedRouteReceipts.length) {
    throw new Error("DEX_MEMORIA_V2_ROUTE_IDENTITIES_NOT_INDEPENDENT");
  }
  const validatedFilesByScope = new Map<string, string[]>();
  for (const route of receipt.routes) {
    if (!samePath(route.resolved_root, expectedResolvedRoot(request, route.scope, route.theme))) {
      throw new Error("DEX_MEMORIA_V2_RECEIPT_ROOT_MISMATCH");
    }
    const routeReceipt = receipt.route_receipts[route.scope];
    if (!routeReceipt || routeReceipt.operation_id !== route.operation_id || routeReceipt.idempotency_key !== route.idempotency_key || routeReceipt.transaction_id !== route.transaction_id || routeReceipt.receipt_id !== route.receipt_id) {
      throw new Error("DEX_MEMORIA_V2_ROUTE_RECEIPT_IDENTITY_MISMATCH");
    }
    if (routeReceipt.status === "COMMITTED") {
      validatedFilesByScope.set(route.scope, await validateIndependentValidationReceipt(routeReceipt, candidate));
    }
  }
  const committed = receipt.routes.filter((route) => receipt.route_receipts[route.scope]?.status === "COMMITTED").length;
  const expectedStatus = committed === receipt.routes.length ? "COMMITTED" : committed > 0 ? "PARTIAL_PENDING" : "FAILED";
  if (receipt.status !== expectedStatus || receipt.recovery_mode !== (expectedStatus === "PARTIAL_PENDING" ? "resume_pending_sibling" : null)) throw new Error("DEX_MEMORIA_V2_RECEIPT_STATUS_INVALID");
  return validatedFilesByScope;
}

function requestedScope(destinations: DexMemoriaV2Destination[]): DexMemoriaV2OperationRequest["scope"] {
  if (destinations.length === 2) return "dual";
  return destinations[0]!.scope;
}

function assertSupportedDestinationSet(destinations: DexMemoriaV2Destination[]): void {
  const keys = destinations.map(destinationKey);
  if (keys.length === 0 || keys.length > 2 || (keys.length === 2 && keys.join(",") !== "project,global")) {
    throw new Error("DEX_MEMORIA_V2_DESTINATION_SET_UNSUPPORTED");
  }
}

function destinationsFromRequest(request: DexMemoriaV2OperationRequest): DexMemoriaV2Destination[] {
  if (request.scope === "dual") return [{ scope: "project" }, { scope: "global" }];
  if (request.scope === "theme") return [{ scope: "theme", theme: request.theme! }];
  return [{ scope: request.scope }];
}

function pendingDestinations(receipt: DexMemoriaV2CanonicalReceipt): DexMemoriaV2Destination[] {
  return receipt.routes
    .filter((route) => receipt.route_receipts[route.scope]?.status === "PENDING")
    .map((route) => route.scope === "theme" ? { scope: "theme", theme: route.theme! } : { scope: route.scope });
}

function requireResume(executor: DexMemoriaV2Executor): NonNullable<DexMemoriaV2Executor["resume"]> {
  if (!executor.resume) throw new Error("DEX_MEMORIA_V2_RESUME_EXECUTOR_REQUIRED");
  return executor.resume.bind(executor);
}

function buildWriteCandidate(slug: string, classification: DexMemoriaV2Classification): DexMemoriaV2WriteCandidate {
  const normalizedSlug = requireNonEmpty(slug, "slug");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedSlug)) throw new Error("DEX_MEMORIA_V2_SLUG_INVALID");
  const title = classification.item.replace(/\s+/g, " ").trim().slice(0, 96);
  const candidate: DexMemoriaV2WriteCandidate = {
    contract: "dex.memory.write.candidate.v2",
    target_layer: classification.route.target,
    slug: normalizedSlug,
    trigger: title,
    title,
    body: classification.item,
    tags: classification.tags
  };
  if (classification.route.target === "L3") candidate.owner_skill = classification.route.owner_skill;
  return candidate;
}

async function validateIndependentValidationReceipt(
  receipt: DexMemoriaV2RouteReceipt,
  candidate: DexMemoriaV2WriteCandidate
): Promise<string[]> {
  const validationPath = requireNonEmpty(receipt.validation_receipt_path, "validation_receipt_path");
  const validationHash = requireNonEmpty(receipt.validation_receipt_hash, "validation_receipt_hash");
  const writerPath = requireNonEmpty(receipt.receipt_path, "receipt_path");
  const writeSetHash = requireNonEmpty(receipt.write_set_hash, "write_set_hash");
  if (receipt.validation_contract !== "dex.memory.capability.unit-receipt.v2" || receipt.validation_ok !== true) {
    throw new Error("DEX_MEMORIA_V2_VALIDATION_RECEIPT_FAILED");
  }
  if (validationPath === writerPath || validationPath === receipt.receipt_id || validationHash === writeSetHash) {
    throw new Error("DEX_MEMORIA_V2_VALIDATION_RECEIPT_NOT_INDEPENDENT");
  }
  assertPathInside(receipt.resolved_root, validationPath, "VALIDATION_RECEIPT_PATH_OUTSIDE_ROOT");
  assertPathInside(receipt.resolved_root, writerPath, "WRITER_RECEIPT_PATH_OUTSIDE_ROOT");

  let validationBytes: Buffer;
  let writerBytes: Buffer;
  try {
    [validationBytes, writerBytes] = await Promise.all([
      readAuthorizedEvidenceFile(receipt.resolved_root, validationPath),
      readAuthorizedEvidenceFile(receipt.resolved_root, writerPath)
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("REPARSE_BOUNDARY")) throw error;
    throw new Error("DEX_MEMORIA_V2_RECEIPT_EVIDENCE_UNREADABLE");
  }
  if (sha256(validationBytes) !== validationHash) throw new Error("DEX_MEMORIA_V2_VALIDATION_RECEIPT_HASH_MISMATCH");

  const validation = parseReceiptJson(validationBytes, "VALIDATION_RECEIPT_JSON_INVALID") as Record<string, unknown>;
  const writer = parseReceiptJson(writerBytes, "WRITER_RECEIPT_JSON_INVALID") as Record<string, unknown>;
  if (validation.contract !== "dex.memory.capability.unit-receipt.v2" || validation.ok !== true || !await sameExistingPath(String(validation.resolved_root ?? ""), receipt.resolved_root)) {
    throw new Error("DEX_MEMORIA_V2_VALIDATION_RECEIPT_CONTRACT_MISMATCH");
  }
  for (const field of ["scope", "resolved_root", "operation_id", "idempotency_key", "transaction_id", "receipt_id", "status", "validation_receipt_hash", "write_set_hash", "candidate_id", "content_hash", "route_identity", "deduplicated"] as const) {
    const expected = receipt[field];
    const actual = writer[field];
    if (field === "resolved_root" ? !samePath(String(actual ?? ""), String(expected ?? "")) : actual !== expected) {
      throw new Error("DEX_MEMORIA_V2_WRITER_RECEIPT_MISMATCH");
    }
  }
  if (writer.contract !== "dex.memory.route.receipt.v2" || writer.validation_contract !== "dex.memory.capability.unit-receipt.v2" || writer.validation_ok !== true) {
    throw new Error("DEX_MEMORIA_V2_WRITER_RECEIPT_MISMATCH");
  }

  const evidence = validation.evidence as Record<string, unknown> | undefined;
  const files = evidence?.files;
  if (!Array.isArray(files) || files.length !== 2) throw new Error("DEX_MEMORIA_V2_VALIDATION_WRITE_SET_INVALID");
  if (!Array.isArray(validation.touched_files) || JSON.stringify(validation.touched_files) !== JSON.stringify(files)) {
    throw new Error("DEX_MEMORIA_V2_VALIDATION_WRITE_SET_INVALID");
  }
  const observed: Array<{ relativePath: string; absolutePath: string; bytes: Buffer }> = [];
  for (const entry of files) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("DEX_MEMORIA_V2_VALIDATION_WRITE_SET_INVALID");
    const relativePath = String((entry as Record<string, unknown>).path ?? "").replace(/\\/g, "/");
    const expectedHash = String((entry as Record<string, unknown>).sha256 ?? "");
    const absolutePath = path.resolve(receipt.resolved_root, ...relativePath.split("/"));
    assertPathInside(receipt.resolved_root, absolutePath, "VALIDATION_TARGET_OUTSIDE_ROOT");
    let bytes: Buffer;
    try { bytes = await readAuthorizedEvidenceFile(receipt.resolved_root, absolutePath); }
    catch (error) {
      if (error instanceof Error && error.message.includes("REPARSE_BOUNDARY")) throw error;
      throw new Error("DEX_MEMORIA_V2_VALIDATION_TARGET_UNREADABLE");
    }
    if (sha256(bytes) !== expectedHash) throw new Error("DEX_MEMORIA_V2_VALIDATION_TARGET_HASH_MISMATCH");
    observed.push({ relativePath, absolutePath: await realpath(absolutePath), bytes });
  }
  const l1Candidates = observed.filter((entry) => !entry.relativePath.includes("/") && entry.relativePath.toLowerCase() === "lembranca.md");
  const expectedDestination = candidate.target_layer === "L2"
    ? `memorias/${candidate.slug}.md`
    : `conhecimento/${candidate.slug}/README.md`;
  const destinationCandidates = observed.filter((entry) => entry.relativePath === expectedDestination);
  const l1 = l1Candidates[0];
  const destination = destinationCandidates[0];
  if (!l1 || !destination || receipt.content_hash !== sha256(destination.bytes) || sha256(Buffer.concat([l1.bytes, Buffer.from("\0"), destination.bytes])) !== writeSetHash) {
    throw new Error("DEX_MEMORIA_V2_VALIDATION_WRITE_SET_MISMATCH");
  }
  if (l1Candidates.length !== 1 || destinationCandidates.length !== 1 || observed.some((entry) => entry !== l1 && entry !== destination)) {
    throw new Error("DEX_MEMORIA_V2_VALIDATION_WRITE_SET_MISMATCH");
  }
  return [l1.absolutePath, destination.absolutePath];
}

function isReceiptEvidenceError(error: unknown): boolean {
  return error instanceof Error && /(?:VALIDATION|WRITER|RECEIPT_EVIDENCE|REPARSE_BOUNDARY)/.test(error.message);
}

function validationReceiptRefs(receipt: DexMemoriaV2CanonicalReceipt, validatedFilesByScope: Map<string, string[]>): DexMemoriaV2ValidationReceiptRef[] {
  return receipt.routes.flatMap((route) => {
    const routeReceipt = receipt.route_receipts[route.scope];
    if (routeReceipt?.status !== "COMMITTED") return [];
    return [{
      scope: route.scope,
      writer_receipt_id: routeReceipt.receipt_id,
      validation_receipt_id: routeReceipt.validation_receipt_path!,
      validation_receipt_path: routeReceipt.validation_receipt_path!,
      validation_receipt_hash: routeReceipt.validation_receipt_hash!,
      write_set_hash: routeReceipt.write_set_hash!,
      candidate_id: routeReceipt.candidate_id!,
      content_hash: routeReceipt.content_hash!,
      route_identity: routeReceipt.route_identity!,
      deduplicated: routeReceipt.deduplicated === true,
      files: [...(validatedFilesByScope.get(route.scope) ?? [])]
    }];
  });
}

function normalizeDestination(destination: DexMemoriaV2Destination): DexMemoriaV2Destination {
  return destination.scope === "theme" ? { scope: "theme", theme: requireNonEmpty(destination.theme, "theme") } : { scope: destination.scope };
}

function uniqueDestinations(destinations: DexMemoriaV2Destination[]): DexMemoriaV2Destination[] {
  const seen = new Set<string>();
  return destinations.filter((destination) => !seen.has(destinationKey(destination)) && Boolean(seen.add(destinationKey(destination))));
}

function destinationKey(destination: DexMemoriaV2Destination): string {
  return destination.scope === "theme" ? `theme:${destination.theme.toLowerCase()}` : destination.scope;
}

function requireAbsolute(value: string, field: string): string {
  const normalized = requireNonEmpty(value, field);
  if (!path.isAbsolute(normalized)) throw new Error(`DEX_MEMORIA_V2_${field.toUpperCase()}_MUST_BE_ABSOLUTE`);
  return path.resolve(normalized);
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function expectedResolvedRoot(request: DexMemoriaV2OperationRequest, scope: DexMemoriaV2OperationRoute["scope"], theme?: string): string {
  if (scope === "project") return path.join(request.workspace_root, ".agents");
  if (scope === "global") return path.join(request.memory_home, "global");
  return path.join(request.memory_home, "temas", requireNonEmpty(theme ?? request.theme, "theme"));
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32" ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase() : normalizedLeft === normalizedRight;
}

async function sameExistingPath(left: string, right: string): Promise<boolean> {
  try { return samePath(await realpath(left), await realpath(right)); }
  catch { return false; }
}

function assertPathInside(root: string, candidate: string, code: string): void {
  if (!isInsideOrEqual(path.resolve(root), path.resolve(candidate))) throw new Error(`DEX_MEMORIA_V2_${code}`);
}

function parseReceiptJson(bytes: Buffer, code: string): unknown {
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`DEX_MEMORIA_V2_${code}`); }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hashCanonicalJson(value: unknown): string {
  return sha256(Buffer.from(JSON.stringify(sortJsonValue(value)), "utf8"));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJsonValue((value as Record<string, unknown>)[key])]));
  }
  return value;
}

async function readAuthorizedEvidenceFile(root: string, filePath: string): Promise<Buffer> {
  const lexicalRoot = path.resolve(root);
  const lexicalFile = path.resolve(filePath);
  assertPathInside(lexicalRoot, lexicalFile, "REPARSE_BOUNDARY_PATH_OUTSIDE_ROOT");
  const rootInfo = await lstat(lexicalRoot, { bigint: true });
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("DEX_MEMORIA_V2_REPARSE_BOUNDARY_ROOT_REJECTED");
  const relativeSegments = path.relative(lexicalRoot, lexicalFile).split(path.sep).filter(Boolean);
  let cursor = lexicalRoot;
  for (const segment of relativeSegments) {
    cursor = path.join(cursor, segment);
    const segmentInfo = await lstat(cursor, { bigint: true });
    if (segmentInfo.isSymbolicLink()) throw new Error("DEX_MEMORIA_V2_REPARSE_BOUNDARY_LINK_REJECTED");
  }
  const [realRoot, realFile, before] = await Promise.all([
    realpath(lexicalRoot),
    realpath(lexicalFile),
    lstat(lexicalFile, { bigint: true })
  ]);
  if (!samePath(realRoot, realFile) && !isInsideOrEqual(path.resolve(realRoot), path.resolve(realFile))) {
    throw new Error("DEX_MEMORIA_V2_REPARSE_BOUNDARY_REALPATH_OUTSIDE_ROOT");
  }
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("DEX_MEMORIA_V2_REPARSE_BOUNDARY_NOT_PLAIN_FILE");

  const fileHandle = await open(lexicalFile, "r");
  try {
    const opened = await fileHandle.stat({ bigint: true });
    if (!opened.isFile() || !sameFileIdentity(before, opened)) throw new Error("DEX_MEMORIA_V2_REPARSE_BOUNDARY_CHANGED_BEFORE_READ");
    const bytes = await fileHandle.readFile();
    const [after, realFileAfter] = await Promise.all([lstat(lexicalFile, { bigint: true }), realpath(lexicalFile)]);
    if (after.isSymbolicLink() || !sameFileIdentity(opened, after) || !samePath(realFile, realFileAfter)) {
      throw new Error("DEX_MEMORIA_V2_REPARSE_BOUNDARY_CHANGED_DURING_READ");
    }
    return bytes;
  } finally {
    await fileHandle.close();
  }
}

function sameFileIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function requireNonEmpty(value: string | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`DEX_MEMORIA_V2_${field.toUpperCase()}_REQUIRED`);
  return normalized;
}

function validateTags(tags: string[]): string[] {
  if (!Array.isArray(tags) || tags.length === 0 || new Set(tags).size !== tags.length) {
    throw new Error("DEX_MEMORIA_V2_TAGS_REQUIRED_UNIQUE");
  }
  for (const tag of tags) {
    if (typeof tag !== "string" || !/^#[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/.test(tag)) {
      throw new Error("DEX_MEMORIA_V2_TAG_INVALID");
    }
  }
  return [...tags].sort((left, right) => left.localeCompare(right));
}
