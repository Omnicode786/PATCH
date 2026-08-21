import { SLOTH_ASSETS } from "./sloth-assets";

export type SlothState = "idle" | "active" | "thinking" | "success" | "error" | "listening" | "responding" | "drop";
export type LocalSlothState = SlothState | "click";
export type RuntimeAnimation = Readonly<{ file: keyof typeof SLOTH_ASSETS; start: number; count: number; loop: boolean }>;

export const DEEP_SLEEP_DELAY_MS = 5 * 60_000;
export const CLICK_OPEN_DELAY_MS = 240;

const stateAnimations: Readonly<Record<LocalSlothState, RuntimeAnimation>> = {
  idle: { file: "sloth_idle_breathe.png", start: 0, count: 8, loop: true },
  active: { file: "sloth_wake_active.png", start: 0, count: 12, loop: false },
  thinking: { file: "sloth_thinking.png", start: 0, count: 12, loop: true },
  success: { file: "sloth_success.png", start: 0, count: 12, loop: false },
  error: { file: "sloth_error_confused.png", start: 0, count: 12, loop: false },
  listening: { file: "sloth_listening.png", start: 0, count: 12, loop: true },
  responding: { file: "sloth_responding.png", start: 0, count: 12, loop: true },
  drop: { file: "sloth_drop_settle.png", start: 0, count: 10, loop: false },
  click: { file: "sloth_click_react.png", start: 0, count: 10, loop: false }
};

export function animationForState(state: LocalSlothState): RuntimeAnimation {
  return stateAnimations[state];
}

export function stateAfterAnimation(state: LocalSlothState): LocalSlothState {
  return state === "success" || state === "error" || state === "active" || state === "drop" || state === "click"
    ? "idle"
    : state;
}
