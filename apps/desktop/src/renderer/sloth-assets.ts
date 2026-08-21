// Generated from PATCH-sloth-production-assets-512px.zip manifest.json.
export const SLOTH_ASSETS = {
  "sloth_idle_breathe.png": { frames: 8, columns: 8, rows: 1, fps: 5, mode: "loop", groups: {} },
  "sloth_idle_sleepy_blink.png": { frames: 10, columns: 10, rows: 1, fps: 6, mode: "one_shot", groups: {} },
  "sloth_idle_stretch.png": { frames: 12, columns: 12, rows: 1, fps: 5, mode: "one_shot", groups: {} },
  "sloth_idle_look.png": { frames: 12, columns: 12, rows: 1, fps: 5, mode: "one_shot", groups: {} },
  "sloth_wake_active.png": { frames: 12, columns: 12, rows: 1, fps: 6, mode: "one_shot", groups: {} },
  "sloth_thinking.png": { frames: 12, columns: 12, rows: 1, fps: 5, mode: "loop", groups: {} },
  "sloth_success.png": { frames: 12, columns: 12, rows: 1, fps: 6, mode: "one_shot", groups: {} },
  "sloth_error_confused.png": { frames: 12, columns: 12, rows: 1, fps: 5, mode: "one_shot", groups: {} },
  "sloth_drag_reactions.png": { frames: 20, columns: 4, rows: 5, fps: 5, mode: "runtime_groups", groups: {"slow": {"start": 0, "count": 6}, "medium": {"start": 6, "count": 6}, "fast": {"start": 12, "count": 8}} },
  "sloth_drop_settle.png": { frames: 10, columns: 10, rows: 1, fps: 5, mode: "one_shot", groups: {} },
  "sloth_deep_sleep.png": { frames: 12, columns: 12, rows: 1, fps: 2, mode: "loop", groups: {} },
  "sloth_hover_notice.png": { frames: 10, columns: 10, rows: 1, fps: 5, mode: "one_shot_hold", groups: {} },
  "sloth_click_react.png": { frames: 10, columns: 10, rows: 1, fps: 6, mode: "one_shot", groups: {} },
  "sloth_listening.png": { frames: 12, columns: 12, rows: 1, fps: 5, mode: "loop", groups: {} },
  "sloth_responding.png": { frames: 12, columns: 12, rows: 1, fps: 5, mode: "loop", groups: {} },
} as const;

export type SlothAssetName = keyof typeof SLOTH_ASSETS;
