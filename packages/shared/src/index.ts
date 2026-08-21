export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type RequestId = Brand<string, "RequestId">;
export type SessionId = Brand<string, "SessionId">;
export type TargetId = Brand<string, "TargetId">;

export type Rectangle = Readonly<{ x: number; y: number; width: number; height: number }>;
export type Point = Readonly<{ x: number; y: number }>;

export type PatchErrorCode =
  | "AI_PROVIDER_AUTH_FAILED"
  | "AI_PROVIDER_RATE_LIMITED"
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_PROVIDER_INVALID_REQUEST"
  | "AI_PROVIDER_UNSUPPORTED_MODEL"
  | "AI_PROVIDER_UNSUPPORTED_CAPABILITY"
  | "AI_PROVIDER_NETWORK_ERROR"
  | "AI_PROVIDER_TIMEOUT"
  | "SCREEN_CAPTURE_DENIED"
  | "WINDOW_NOT_FOUND"
  | "TARGET_NOT_FOUND"
  | "AMBIGUOUS_TARGET"
  | "TOOL_UNAVAILABLE"
  | "ACTION_DENIED"
  | "ACTION_FAILED"
  | "ACTION_VERIFICATION_FAILED"
  | "VALIDATION_FAILED"
  | "ADAPTER_DISCONNECTED"
  | "BROWSER_ADAPTER_NOT_CONNECTED"
  | "ACTIVE_TAB_NOT_AVAILABLE"
  | "BROWSER_CONTEXT_EMPTY"
  | "TOOL_NOT_ELIGIBLE"
  | "ACTION_NOT_CLASSIFIED"
  | "PLANNER_DID_NOT_RETURN_ACTION"
  | "PLAN_VALIDATION_FAILED"
  | "NATIVE_MESSAGE_FAILED"
  | "PATCH_EXECUTION_FAILED"
  | "VERIFICATION_FAILED"
  | "PROTOCOL_MISMATCH"
  | "INTERNAL_ERROR";

export class PatchError extends Error {
  readonly code: PatchErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: PatchErrorCode, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = "PatchError";
    this.code = code;
    this.details = details;
  }
}

export type Result<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: PatchError }>;

export const success = <T>(value: T): Result<T> => ({ ok: true, value });
export const failure = <T = never>(error: PatchError): Result<T> => ({ ok: false, error });

export const unreachable = (value: never): never => {
  throw new Error(`Unreachable value: ${String(value)}`);
};
