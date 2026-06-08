import { ROUTES, type Tab } from "@/app/navigation/routes.ts";

export const LINKING_PATHS: Record<Tab, string> = {
  [ROUTES.today]: "/",
  [ROUTES.allPayments]: "/payments",
  [ROUTES.reports]: "/reports",
  [ROUTES.settings]: "/settings",
  [ROUTES.network]: "/network",
};
