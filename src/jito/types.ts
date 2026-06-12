export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown[];
};

export type JsonRpcSuccess<T> = {
  jsonrpc: "2.0";
  id: number;
  result: T;
};

export type JsonRpcFailure = {
  jsonrpc: "2.0";
  id: number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

export type JitoRpcClientOptions = {
  blockEngineUrl: string;
};

export type SendBundleResult = {
  bundle_id: string;
  raw: unknown;
};

export type BundleStatusSource = "inflight" | "final";
export type BundleFinalStatusSource = BundleStatusSource | "timeout";

export type BundleStatusObservation = {
  observed_at: string;
  source: BundleStatusSource;
  status: string | null;
  landed_slot: number | null;
  failed_reason: string | null;
  raw_response?: unknown;
};

export type BundleStatusResult = {
  bundle_id: string;
  observed_statuses: BundleStatusObservation[];
  final_bundle_status?: string;
  final_status_source: BundleFinalStatusSource;
  landed_slot?: number;
  failed_reason?: string;
  timed_out: boolean;
};
