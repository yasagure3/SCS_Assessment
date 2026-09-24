import useSWR from "swr";
import type { Me } from "../../shared/contracts/access";
import { getCurrentSession } from "./cognitoClient";
import { useApi } from "./api";
export function useAccess() {
  const session = useSWR("cognito-session", getCurrentSession);
  const me = useApi<Me>("/api/v1/me", { refreshInterval: 60000 });
  return { session, me };
}
