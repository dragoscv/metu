'use client';
/**
 * Heartbeat skin registry. Each skin is a client component receiving
 * { streams, motionMode, staleAfterDays }.
 *
 * Adding a new skin:
 *   1. create `./<skin>.tsx` with default export + same props.
 *   2. add the key to HEARTBEAT_SKINS in lib/dashboard/types.ts.
 *   3. import + register here.
 */
import type { ComponentType } from 'react';
import type { HeartbeatSkin, StreamItem } from '@/lib/dashboard/types';
import Constellation from './constellation';
import PulseRings from './pulse-rings';
import NowRiver from './now-river';
import Garden from './garden';
import CardStack from './card-stack';

export interface HeartbeatProps {
  streams: StreamItem[];
  motionMode: 'calm' | 'alive';
  staleAfterDays: number;
}

export const HEARTBEAT_REGISTRY: Record<HeartbeatSkin, ComponentType<HeartbeatProps>> = {
  constellation: Constellation,
  'pulse-rings': PulseRings,
  'now-river': NowRiver,
  garden: Garden,
  'card-stack': CardStack,
};

export const HEARTBEAT_LABELS: Record<HeartbeatSkin, { name: string; tagline: string }> = {
  constellation: { name: 'Constellation', tagline: 'streams as stars in a quiet night sky' },
  'pulse-rings': { name: 'Pulse rings', tagline: 'concentric rings — closer means more recent' },
  'now-river': { name: 'Now river', tagline: 'a horizontal flow from past to present' },
  garden: { name: 'Garden', tagline: 'streaks grow tall, pulses bloom, drifts ember' },
  'card-stack': { name: 'Card stack', tagline: 'calm grouped lists — best for reduced motion' },
};

export function pickHeartbeat(skin: HeartbeatSkin): ComponentType<HeartbeatProps> {
  return HEARTBEAT_REGISTRY[skin] ?? Constellation;
}
