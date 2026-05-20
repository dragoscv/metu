/**
 * Static catalog of integrations the UI surfaces, in display order.
 * `mode: 'token'` means a paste-token flow exists; `'oauth-soon'` is a
 * placeholder for OAuth-only providers we haven't wired yet.
 */
import type { IntegrationKind } from '@metu/types';
import {
  Github,
  Send,
  Globe,
  CreditCard,
  CheckSquare,
  BookText,
  Mail,
  Calendar,
  MessageCircle,
  Music,
  Video,
  Camera,
  Facebook,
  MessageSquare,
  Twitter,
  Youtube,
  Linkedin,
  Megaphone,
  type LucideIcon,
} from 'lucide-react';

export interface IntegrationCatalogEntry {
  kind: IntegrationKind;
  name: string;
  description: string;
  icon: LucideIcon;
  mode: 'token' | 'oauth-soon';
  /** Where the user creates the token. */
  tokenUrl?: string;
  /** Hint shown above the token input. */
  tokenHint?: string;
  /** Recommended scopes / fine-grained permissions. */
  scopes?: string[];
}

export const INTEGRATIONS_CATALOG: IntegrationCatalogEntry[] = [
  {
    kind: 'github',
    name: 'GitHub',
    description: 'Repo activity, commits, issues → memory & timeline',
    icon: Github,
    mode: 'token',
    tokenUrl: 'https://github.com/settings/tokens?type=beta',
    tokenHint: 'Fine-grained PAT with read access to your repos.',
    scopes: ['Contents: Read', 'Metadata: Read', 'Issues: Read'],
  },
  {
    kind: 'telegram',
    name: 'Telegram',
    description: 'Inbound capture from a personal bot',
    icon: Send,
    mode: 'token',
    tokenUrl: 'https://t.me/BotFather',
    tokenHint: 'Bot token from @BotFather (format: 123456:ABC-…).',
  },
  {
    kind: 'vercel',
    name: 'Vercel',
    description: 'Deployments → timeline events',
    icon: Globe,
    mode: 'token',
    tokenUrl: 'https://vercel.com/account/tokens',
    tokenHint: 'Personal access token, full account scope is fine for V1.',
  },
  {
    kind: 'stripe',
    name: 'Stripe',
    description: 'Revenue signals per project',
    icon: CreditCard,
    mode: 'token',
    tokenUrl: 'https://dashboard.stripe.com/apikeys',
    tokenHint: 'Restricted secret key (read-only) is recommended.',
  },
  {
    kind: 'linear',
    name: 'Linear',
    description: 'Issues + cycles → tasks & timeline',
    icon: CheckSquare,
    mode: 'token',
    tokenUrl: 'https://linear.app/settings/api',
    tokenHint: 'Personal API key.',
  },
  {
    kind: 'notion',
    name: 'Notion',
    description: 'Pages → memory chunks',
    icon: BookText,
    mode: 'token',
    tokenUrl: 'https://www.notion.so/profile/integrations',
    tokenHint: 'Internal integration token; share specific pages with it.',
  },
  {
    kind: 'gmail',
    name: 'Gmail',
    description: 'Inbox triage + capture (OAuth)',
    icon: Mail,
    mode: 'oauth-soon',
  },
  {
    kind: 'gcal',
    name: 'Calendar',
    description: 'Schedule-aware focus (OAuth)',
    icon: Calendar,
    mode: 'oauth-soon',
  },
  {
    kind: 'slack',
    name: 'Slack',
    description: 'Channel mentions → capture (OAuth)',
    icon: MessageCircle,
    mode: 'oauth-soon',
  },
  {
    kind: 'spotify',
    name: 'Spotify',
    description: 'Listening history as ambient signal (OAuth)',
    icon: Music,
    mode: 'oauth-soon',
  },
  // ─── Social platforms ─────────────────────────────────────────────────
  {
    kind: 'tiktok',
    name: 'TikTok',
    description: 'Video posts + view/like/comment counts (OAuth)',
    icon: Video,
    mode: 'oauth-soon',
  },
  {
    kind: 'instagram',
    name: 'Instagram',
    description: 'Posts, reels, story metrics (OAuth via Meta)',
    icon: Camera,
    mode: 'oauth-soon',
  },
  {
    kind: 'facebook',
    name: 'Facebook',
    description: 'Page posts + insights (OAuth via Meta)',
    icon: Facebook,
    mode: 'oauth-soon',
  },
  {
    kind: 'reddit',
    name: 'Reddit',
    description: 'Submissions + comment activity (OAuth)',
    icon: MessageSquare,
    mode: 'oauth-soon',
  },
  {
    kind: 'twitter',
    name: 'Twitter / X',
    description: 'Tweets + engagement stats (OAuth)',
    icon: Twitter,
    mode: 'oauth-soon',
  },
  {
    kind: 'youtube',
    name: 'YouTube',
    description: 'Video uploads + analytics (OAuth via Google)',
    icon: Youtube,
    mode: 'oauth-soon',
  },
  {
    kind: 'linkedin',
    name: 'LinkedIn',
    description: 'Posts + reactions (OAuth)',
    icon: Linkedin,
    mode: 'oauth-soon',
  },
  // ─── Ad platforms ─────────────────────────────────────────────────────
  {
    kind: 'meta_ads',
    name: 'Meta Ads',
    description: 'Facebook + Instagram campaign spend & ROAS (OAuth)',
    icon: Megaphone,
    mode: 'oauth-soon',
  },
  {
    kind: 'google_ads',
    name: 'Google Ads',
    description: 'Search/display campaigns + GAQL metrics (OAuth)',
    icon: Megaphone,
    mode: 'oauth-soon',
  },
  {
    kind: 'tiktok_ads',
    name: 'TikTok Ads',
    description: 'Campaign performance + creative spend (OAuth)',
    icon: Megaphone,
    mode: 'oauth-soon',
  },
  {
    kind: 'linkedin_ads',
    name: 'LinkedIn Ads',
    description: 'Sponsored content performance (OAuth)',
    icon: Megaphone,
    mode: 'oauth-soon',
  },
];

export function getCatalogEntry(kind: IntegrationKind): IntegrationCatalogEntry | undefined {
  return INTEGRATIONS_CATALOG.find((c) => c.kind === kind);
}
