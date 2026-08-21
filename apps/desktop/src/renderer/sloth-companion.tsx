import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { SLOTH_ASSETS } from "./sloth-assets";
import { classifyDragSpeed, isDragGesture, type DragBand } from "../shared/companion-motion";
import { CLICK_OPEN_DELAY_MS, DEEP_SLEEP_DELAY_MS, animationForState, stateAfterAnimation, type LocalSlothState, type RuntimeAnimation, type SlothState } from "./sloth-state";

export type { SlothState } from "./sloth-state";

function useReducedMotionPreference(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function useSprite(animation: RuntimeAnimation, reducedMotion: boolean, onComplete?: () => void) {
  const imageRef = useRef<HTMLImageElement>(null);
  const completionRef = useRef(onComplete);
  useEffect(() => { completionRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    const meta = SLOTH_ASSETS[animation.file];
    let frame = animation.start;
    let timer = 0;
    const draw = () => {
      const image = imageRef.current;
      if (!image) return;
      const col = frame % meta.columns;
      const row = Math.floor(frame / meta.columns);
      image.style.width = `${meta.columns * 100}%`;
      image.style.height = `${meta.rows * 100}%`;
      image.style.transform = `translate(${-col * (100 / meta.columns)}%, ${-row * (100 / meta.rows)}%)`;
    };
    draw();
    if (reducedMotion) {
      if (!animation.loop) {
        const completionTimer = window.setTimeout(() => completionRef.current?.(), 120);
        return () => window.clearTimeout(completionTimer);
      }
      return;
    }
    timer = window.setInterval(() => {
      frame += 1;
      if (frame >= animation.start + animation.count) {
        if (animation.loop) frame = animation.start;
        else {
          window.clearInterval(timer);
          frame = animation.start + animation.count - 1;
          draw();
          completionRef.current?.();
          return;
        }
      }
      draw();
    }, Math.max(45, Math.round(1000 / meta.fps)));
    return () => window.clearInterval(timer);
  }, [animation.file, animation.start, animation.count, animation.loop, reducedMotion]);
  return imageRef;
}

function Sprite({ animation, reducedMotion, onComplete }: { animation: RuntimeAnimation; reducedMotion: boolean; onComplete?: () => void }) {
  const ref = useSprite(animation, reducedMotion, onComplete);
  return <div className="sloth-frame"><img ref={ref} src={`./sloth/${animation.file}`} draggable={false} alt="" /></div>;
}

export function SlothCompanion({ providerConfigured, shortcut, externalState }: { providerConfigured: boolean; shortcut: string; externalState: SlothState }) {
  const [state, setState] = useState<LocalSlothState>(externalState);
  const [dragBand, setDragBand] = useState<DragBand | null>(null);
  const [hover, setHover] = useState(false);
  const [idleVariant, setIdleVariant] = useState<RuntimeAnimation | null>(null);
  const [deepSleep, setDeepSleep] = useState(false);
  const pointer = useRef<{ id: number; startX: number; startY: number; lastX: number; lastY: number; lastAt: number; vx: number; vy: number; dragging: boolean } | null>(null);
  const dragFrame = useRef<number | null>(null);
  const pendingDragPoint = useRef<{ screenX: number; screenY: number } | null>(null);
  const reducedMotion = useReducedMotionPreference();

  const flushDragPoint = useCallback(() => {
    if (dragFrame.current !== null) { window.cancelAnimationFrame(dragFrame.current); dragFrame.current = null; }
    const point = pendingDragPoint.current; pendingDragPoint.current = null;
    if (point) void window.patch.companion.moveDrag(point);
  }, []);

  const scheduleDragPoint = useCallback((point: { screenX: number; screenY: number }) => {
    pendingDragPoint.current = point;
    if (dragFrame.current !== null) return;
    dragFrame.current = window.requestAnimationFrame(() => {
      dragFrame.current = null;
      const next = pendingDragPoint.current; pendingDragPoint.current = null;
      if (next) void window.patch.companion.moveDrag(next);
    });
  }, []);

  useEffect(() => () => { if (dragFrame.current !== null) window.cancelAnimationFrame(dragFrame.current); }, []);

  const wake = useCallback(() => {
    setDeepSleep(false);
    setIdleVariant(null);
  }, []);

  useEffect(() => {
    setState(externalState);
    if (externalState !== "idle") wake();
  }, [externalState, wake]);

  useEffect(() => {
    if (state !== "idle" || reducedMotion || hover || dragBand || deepSleep) return;
    const timer = window.setTimeout(() => setDeepSleep(true), DEEP_SLEEP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [state, reducedMotion, hover, dragBand, deepSleep]);

  useEffect(() => {
    if (state !== "idle" || reducedMotion || deepSleep) return;
    const timer = window.setTimeout(() => {
      const variants: RuntimeAnimation[] = [
        { file: "sloth_idle_sleepy_blink.png", start: 0, count: 10, loop: false },
        { file: "sloth_idle_look.png", start: 0, count: 12, loop: false },
        { file: "sloth_idle_stretch.png", start: 0, count: 12, loop: false }
      ];
      setIdleVariant(variants[Math.floor(Math.random() * variants.length)] ?? null);
    }, 8000 + Math.random() * 10_000);
    return () => window.clearTimeout(timer);
  }, [state, idleVariant, reducedMotion, deepSleep]);

  const dragAnimation = dragBand ? (() => {
    const meta = SLOTH_ASSETS["sloth_drag_reactions.png"];
    const group = meta.groups[dragBand];
    return { file: "sloth_drag_reactions.png" as const, start: group.start, count: group.count, loop: true };
  })() : null;
  const animation: RuntimeAnimation = dragAnimation
    ?? (deepSleep && state === "idle" ? { file: "sloth_deep_sleep.png", start: 0, count: 12, loop: true } : null)
    ?? idleVariant
    ?? (hover && state === "idle" ? { file: "sloth_hover_notice.png", start: 0, count: 10, loop: false } : animationForState(state));

  const down = (event: ReactPointerEvent<HTMLButtonElement>) => {
    wake();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.speed = "slow";
    event.currentTarget.style.setProperty("--sloth-rotation", "0deg");
    pointer.current = { id: event.pointerId, startX: event.screenX, startY: event.screenY, lastX: event.screenX, lastY: event.screenY, lastAt: performance.now(), vx: 0, vy: 0, dragging: false };
    void window.patch.companion.beginDrag({ screenX: event.screenX, screenY: event.screenY });
  };

  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const p = pointer.current;
    if (!p || p.id !== event.pointerId) return;
    const now = performance.now();
    const dt = Math.max(8, now - p.lastAt);
    p.vx = (event.screenX - p.lastX) / dt * 1000 * .72 + p.vx * .28;
    p.vy = (event.screenY - p.lastY) / dt * 1000 * .72 + p.vy * .28;
    p.lastX = event.screenX;
    p.lastY = event.screenY;
    p.lastAt = now;
    if (!p.dragging && isDragGesture({ x: p.startX, y: p.startY }, { x: event.screenX, y: event.screenY })) p.dragging = true;
    if (!p.dragging) return;
    const band = classifyDragSpeed(Math.hypot(p.vx, p.vy));
    setDragBand(band);
    event.currentTarget.dataset.speed = band;
    if (!reducedMotion) event.currentTarget.style.setProperty("--sloth-rotation", `${Math.max(-3, Math.min(3, p.vx / 260))}deg`);
    scheduleDragPoint({ screenX: event.screenX, screenY: event.screenY });
  };

  const resetDragVisuals = (target: HTMLButtonElement) => {
    target.dataset.speed = "idle";
    target.style.setProperty("--sloth-rotation", "0deg");
  };

  const up = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const p = pointer.current;
    pointer.current = null;
    setDragBand(null);
    resetDragVisuals(event.currentTarget);
    if (!p) return;
    if (p.dragging) {
      flushDragPoint();
      setState("drop");
      void window.patch.companion.endDrag({ vx: p.vx, vy: p.vy, reducedMotion });
    } else {
      void window.patch.companion.cancelDrag();
      setState("click");
      window.setTimeout(() => void window.patch.openOverlay(), reducedMotion ? 0 : CLICK_OPEN_DELAY_MS);
    }
  };

  const cancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    pointer.current = null;
    pendingDragPoint.current = null;
    if (dragFrame.current !== null) { window.cancelAnimationFrame(dragFrame.current); dragFrame.current = null; }
    setDragBand(null);
    resetDragVisuals(event.currentTarget);
    void window.patch.companion.cancelDrag();
  };

  const animationComplete = useCallback(() => {
    if (idleVariant) setIdleVariant(null);
    else setState(stateAfterAnimation(state));
  }, [idleVariant, state]);

  return <main className="sloth-companion-shell" aria-label="PATCH sloth companion">
    <button
      className="sloth-hit"
      data-speed="idle"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onMouseEnter={() => { wake(); setHover(true); }}
      onMouseLeave={() => setHover(false)}
      title={`Summon PATCH · ${shortcut}`}
      aria-label="Summon PATCH"
    >
      <Sprite animation={animation} reducedMotion={reducedMotion} onComplete={animationComplete} />
      <span className={`sloth-presence ${providerConfigured ? "ready" : "needs-provider"}`} aria-hidden="true" />
    </button>
    <button className="sloth-settings" onClick={() => void window.patch.openSettings()} title="PATCH Settings" aria-label="Open PATCH Settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Zm8.1 4.9-1.8-1.05c.03-.35.03-.7 0-1.05l1.8-1.05-1.8-3.12-1.8 1.04a8.7 8.7 0 0 0-.92-.54V5.25h-3.6v2.08c-.32.16-.63.34-.92.54L9.27 6.83l-1.8 3.12L9.28 11c-.03.35-.03.7 0 1.05L7.47 13.1l1.8 3.12 1.8-1.04c.29.2.6.38.92.54v2.08h3.6v-2.08c.32-.16.63-.34.92-.54l1.8 1.04 1.8-3.12Z"/></svg></button>
  </main>;
}
