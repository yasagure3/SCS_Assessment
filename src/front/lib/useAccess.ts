import useSWR from "swr";
import type { Me } from "../../shared/contracts/access";
import type { ApiSuccess } from "../../shared/contracts/api";
import { getCurrentSession } from "./cognitoClient";
import { fetcher } from "./fetcher";
export function useAccess() {
  const session = useSWR("cognito-session", getCurrentSession);
  const me = useSWR<ApiSuccess<Me>>(
    session.data ? ["/api/v1/me", session.data.accessToken] : null,
    ([url, token]: [string, string]) =>
      fetcher<ApiSuccess<Me>>(url, { headers: { Authorization: `Bearer ${token}` } }),
    { shouldRetryOnError: false, refreshInterval: 60000 },
  );
  return { session, me };
}
