// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

import type { IconName } from "@/shared/components/Icon.tsx";

export const ROUTES = {
  today: "today",
  allPayments: "all",
  reports: "reports",
  settings: "settings",
  network: "network",
} as const;

export type Tab = (typeof ROUTES)[keyof typeof ROUTES];

export type RootRouteParams = {
  [ROUTES.today]: undefined;
  [ROUTES.allPayments]: undefined;
  [ROUTES.reports]: undefined;
  [ROUTES.settings]: undefined;
  [ROUTES.network]: undefined;
};

// Only tabs that appear in the nav chrome (bottom bar / sidebar).
export const NAV: ReadonlyArray<{ id: Exclude<Tab, "network">; label: string; icon: IconName }> = [
  { id: ROUTES.today, label: "Today", icon: "dashboard" },
  { id: ROUTES.allPayments, label: "All payments", icon: "list" },
  { id: ROUTES.reports, label: "Reports", icon: "report" },
  { id: ROUTES.settings, label: "Settings", icon: "settings" },
];
