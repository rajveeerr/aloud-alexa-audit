import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicAuditResult } from "@aloud/contracts";
import type { PublicAuditInput } from "@/api/types";
import { pollUntil } from "@/api/polling";
import { getPublicApi, type PublicApi } from "@/api/public";

async function run<T>(fn: (api: PublicApi) => Promise<T>): Promise<T> {
  return fn(await getPublicApi());
}

export function useCreatePublicAudit() {
  return useMutation({ mutationFn: (body: PublicAuditInput) => run((a) => a.createPublicAudit(body)) });
}

const QUOTA_POLL_MS = 60_000;

/** `since` is when the visitor started the check: the public result has no createdAt to cap polling by. */
export function usePublicAudit(id: string | null, since: number | null) {
  return useQuery({
    queryKey: ["public-audit", id],
    queryFn: () => run((a) => a.getPublicAudit(id!)),
    enabled: !!id,
    retry: false,
    // Parked behind the model's daily quota, the result can be hours away: check once a minute, with no cap.
    refetchInterval: (q) =>
      q.state.data?.waiting === "quota"
        ? QUOTA_POLL_MS
        : pollUntil<PublicAuditResult>(
            (d) => d.status === "done" || d.status === "failed",
            () => since ?? undefined,
          )(q),
  });
}

export function useAddPublicEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, email }: { id: string; email: string }) => run((a) => a.addPublicEmail(id, email)),
    onSuccess: (r) => qc.setQueryData(["public-audit", r.id], r),
  });
}
