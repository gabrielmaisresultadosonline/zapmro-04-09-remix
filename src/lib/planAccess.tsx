import { createContext, useContext } from "react";

/** Modo do plano decidido pelo AccessGate (espelhado em _shared/plan-access.ts). */
export type PlanMode = "admin" | "paid" | "trial" | "grandfathered" | "unknown";

export const PlanModeContext = createContext<PlanMode>("unknown");

export function usePlanMode(): PlanMode {
  return useContext(PlanModeContext);
}

/** Teste grátis não inclui Disparo em massa nem Agente I.A. */
export function useIsTrialPlan(): boolean {
  return usePlanMode() === "trial";
}
