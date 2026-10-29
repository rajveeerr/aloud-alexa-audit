import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuditStatus } from "@answerable/contracts";
import { getApi, type Api, type SavedSource } from "./index";
import { pollUntil } from "./polling";

const settled = (s: AuditStatus) => s === "done" || s === "failed";
/** The bulk list is a summary of many jobs; it doesn't need the detail view's pace. */
const LIST_POLL_MS = 5000;

async function run<T>(fn: (api: Api) => Promise<T>): Promise<T> {
  return fn(await getApi());
}

// Polled queries don't use React Query's retry: the interval does the retrying, with backoff.

export function useAudit(id: string) {
  return useQuery({
    queryKey: ["audit", id],
    queryFn: () => run((a) => a.getAudit(id)),
    retry: false,
    refetchInterval: pollUntil(
      (d) => settled(d.status),
      (d) => d.createdAt,
    ),
  });
}

export function useAudits(limit = 50) {
  return useQuery({
    queryKey: ["audits", limit],
    queryFn: () => run((a) => a.listAudits(limit)),
    retry: false,
    refetchInterval: pollUntil(
      (d) => d.every((s) => settled(s.status)),
      (d) => d.find((s) => !settled(s.status))?.createdAt,
      LIST_POLL_MS,
    ),
  });
}

export function useListings(source: SavedSource) {
  return useQuery({ queryKey: ["listings", source], queryFn: () => run((a) => a.listings(source)), staleTime: 5 * 60_000 });
}

export function useCreateAudit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<Api["createAudit"]>[0]) => run((a) => a.createAudit(body)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["audits"] }),
  });
}

export function useCreateBriefs() {
  return useMutation({ mutationFn: (id: string) => run((a) => a.createBriefs(id)) });
}

export function useHistory(asin: string) {
  return useQuery({ queryKey: ["history", asin], queryFn: () => run((a) => a.history(asin)) });
}

export function useRescore() {
  return useMutation({ mutationFn: (body: Parameters<Api["rescore"]>[0]) => run((a) => a.rescore(body)) });
}

/** Summaries only, polled slowly and only while a job is still running. */
export function useBulkJobs() {
  return useQuery({
    queryKey: ["bulk-list"],
    queryFn: () => run((a) => a.listBulk(10)),
    retry: false,
    refetchInterval: pollUntil(
      (d) => d.every((b) => b.status === "done"),
      (d) => d.find((b) => b.status === "running")?.createdAt,
      LIST_POLL_MS,
    ),
  });
}

export function useCreateBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<Api["createBulk"]>[0]) => run((a) => a.createBulk(body)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["bulk-list"] }),
  });
}

export function useBulk(id: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["bulk", id],
    queryFn: async () => {
      const b = await run((a) => a.getBulk(id!));
      // Keep the list's summary in step without polling the list at the detail's pace.
      if (b.status === "done") void qc.invalidateQueries({ queryKey: ["bulk-list"] });
      return b;
    },
    enabled: !!id,
    retry: false,
    refetchInterval: pollUntil(
      (d) => d.status === "done",
      (d) => d.createdAt,
    ),
  });
}
