/**
 * Typed bindings to the Rust spatial-sensing commands (`spatial.rs`) plus a
 * few geometry helpers the brain uses to move the assistant window around the
 * desktop.
 *
 * All coordinates are PHYSICAL pixels (what Tauri's setPosition expects via
 * PhysicalPosition), matching what the Rust side returns.
 */
import { invoke } from '@tauri-apps/api/core';

export interface MonitorInfo {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
  primary: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface ForegroundWindow {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function getMonitors(): Promise<MonitorInfo[]> {
  try {
    return await invoke<MonitorInfo[]>('spatial_monitors');
  } catch {
    return [];
  }
}

export async function getCursor(): Promise<Point | null> {
  try {
    return await invoke<Point>('spatial_cursor');
  } catch {
    return null;
  }
}

export async function getForeground(): Promise<ForegroundWindow | null> {
  try {
    return await invoke<ForegroundWindow | null>('spatial_foreground');
  } catch {
    return null;
  }
}

/** Clamp a desired top-left so the assistant (w×h) stays fully on some monitor. */
export function clampToMonitors(
  x: number,
  y: number,
  w: number,
  h: number,
  monitors: MonitorInfo[],
): Point {
  if (monitors.length === 0) return { x, y };
  // Find the monitor whose center is nearest the target; clamp within it.
  const cx = x + w / 2;
  const cy = y + h / 2;
  let best: MonitorInfo = monitors[0]!;
  let bestDist = Infinity;
  for (const m of monitors) {
    const mcx = m.x + m.w / 2;
    const mcy = m.y + m.h / 2;
    const d = (mcx - cx) ** 2 + (mcy - cy) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  const clampedX = Math.min(Math.max(x, best.x), best.x + best.w - w);
  const clampedY = Math.min(Math.max(y, best.y), best.y + best.h - h);
  return { x: clampedX, y: clampedY };
}

/** A random on-screen point for wandering, biased toward screen edges/corners
 * so the assistant feels like it lives at the periphery rather than the middle. */
export function randomWanderTarget(w: number, h: number, monitors: MonitorInfo[]): Point {
  if (monitors.length === 0) {
    return { x: 100, y: 100 };
  }
  const m = monitors[Math.floor(Math.random() * monitors.length)];
  if (!m) return { x: 100, y: 100 };
  const margin = 24;
  const x = m.x + margin + Math.random() * Math.max(1, m.w - w - margin * 2);
  // Bias vertically toward the lower third (taskbar-ish home).
  const lowBand = m.y + m.h * 0.5;
  const y = lowBand + Math.random() * Math.max(1, m.h * 0.5 - h - margin);
  return { x: Math.round(x), y: Math.round(y) };
}
