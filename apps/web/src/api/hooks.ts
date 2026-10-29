import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuditStatus } from "@answerable/contracts";
import { getApi, type Api, type SavedSource } from "./index";

/** The dev key allows 120 requests a minute; a couple of pollers at this rate stay well under it. */
const POLL_MS = 1500;
const settled = (s: AuditStatus | undefined) => s === "done" || s === "failed";

async function run<T>(fn: (api: Api) => Promise<T>): Promise<T> {
  return fn(await getApi());
}

export function useAudit(id: string) {
  return useQuery({
    queryKey: ["audit", id],
    queryFn: () => run((a) => a.getAudit(id)),
    refetchInterval: (q) => (settled(q.state.data?.status) || q.state.error ? false : POLL_MS),
  });
}

export function useAudits(limit = 50) {
  return useQuery({
    queryKey: ["audits", limit],
    queryFn: () => run((a) => a.listAudits(limit)),
    refetchInterval: (q) => (q.state.data?.some((s) => !settled(s.status)) ? POLL_MS * 2 : false),
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

export function useBulkJobs() {
  return useQuery({
    queryKey: ["bulk"],
    queryFn: () => run((a) => a.listBulk()),
    refetchInterval: (q) => (q.state.data?.some((b) => b.status === "running") ? POLL_MS : false),
  });
}

export function useCreateBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<Api["createBulk"]>[0]) => run((a) => a.createBulk(body)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["bulk"] }),
  });
}

export function useBulk(id: string | null) {
  return useQuery({
    queryKey: ["bulk", id],
    queryFn: () => run((a) => a.getBulk(id!)),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === "done" || q.state.error ? false : POLL_MS),
  });
}

export function useCreatePublicAudit() {
  return useMutation({ mutationFn: (body: Parameters<Api["createPublicAudit"]>[0]) => run((a) => a.createPublicAudit(body)) });
}

export function useAddPublicEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, email }: { id: string; email: string }) => run((a) => a.addPublicEmail(id, email)),
    onSuccess: (r) => qc.setQueryData(["public-audit", r.id], r),
  });
}

export function usePublicAudit(id: string | null) {
  return useQuery({
    queryKey: ["public-audit", id],
    queryFn: () => run((a) => a.getPublicAudit(id!)),
    enabled: !!id,
    refetchInterval: (q) => (settled(q.state.data?.status) || q.state.error ? false : POLL_MS),
  });
}
