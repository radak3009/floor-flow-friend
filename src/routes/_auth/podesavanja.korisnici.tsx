import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { listUsersFn, listRolesFn, updateUserRoleFn, toggleUserActiveFn, type UserRow, type RoleRow } from "@/lib/api/users.functions";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

const searchSchema = z.object({
  page: fallback(z.number().int().min(1), 1).default(1),
  pageSize: fallback(z.number().int().min(5).max(100), 20).default(20),
});

export const Route = createFileRoute("/_auth/podesavanja/korisnici")({
  validateSearch: zodValidator(searchSchema),
  component: KorisniciPage,
});

const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function KorisniciPage() {
  const { user } = useAuth();
  const callerRole = norm(user?.roleName);
  const isSuper = callerRole === "super admin";
  const isAdmin = callerRole === "admin";

  const listUsers = useServerFn(listUsersFn);
  const listRoles = useServerFn(listRolesFn);
  const updateRole = useServerFn(updateUserRoleFn);
  const toggleActive = useServerFn(toggleUserActiveFn);
  const qc = useQueryClient();
  const navigate = useNavigate({ from: "/podesavanja/korisnici" });

  const { page: urlPage, pageSize: urlPageSize } = Route.useSearch();

  const usersQ = useQuery({ queryKey: ["settings", "users"], queryFn: () => listUsers(), staleTime: 30_000 });
  const rolesQ = useQuery({ queryKey: ["settings", "roles"], queryFn: () => listRoles(), staleTime: 60_000 });

  const [search, setSearch] = useState("");

  const canEdit = (u: UserRow): boolean => {
    if (isSuper) return true;
    if (!isAdmin) return false;
    const r = norm(u.roleName);
    return r !== "admin" && r !== "super admin";
  };

  const visibleRoles = useMemo<RoleRow[]>(() => {
    const all = rolesQ.data?.roles ?? [];
    if (isSuper) return all;
    if (isAdmin) return all.filter((r) => {
      const n = norm(r.naziv);
      return n !== "admin" && n !== "super admin";
    });
    return [];
  }, [rolesQ.data, isSuper, isAdmin]);

  const filtered = useMemo(() => {
    const list = usersQ.data?.users ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (u) =>
        u.imeIPrezime.toLowerCase().includes(q) ||
        u.idZaposlenog.toLowerCase().includes(q) ||
        (u.pozicija ?? "").toLowerCase().includes(q),
    );
  }, [usersQ.data, search]);

  const pageSize = urlPageSize;
  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(urlPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const paginated = filtered.slice(startIndex, startIndex + pageSize);

  const goToPage = (p: number) => {
    navigate({ search: (prev: { page?: number; pageSize?: number }) => ({ ...prev, page: Math.max(1, Math.min(p, totalPages)) }) });
  };

  const setPageSize = (size: number) => {
    navigate({ search: (prev: { page?: number; pageSize?: number }) => ({ ...prev, pageSize: size, page: 1 }) });
  };

  const roleMut = useMutation({
    mutationFn: async (vars: { userId: string; roleId: string }) =>
      updateRole({ data: { userId: vars.userId, roleId: vars.roleId, currentUserId: user!.id } }),
    onSuccess: () => {
      toast.success("Uloga ažurirana");
      qc.invalidateQueries({ queryKey: ["settings", "users"] });
    },
    onError: (e: any) => toast.error(e?.message || "Greška pri ažuriranju uloge"),
  });

  const activeMut = useMutation({
    mutationFn: async (vars: { userId: string; aktivan: boolean }) =>
      toggleActive({ data: { userId: vars.userId, aktivan: vars.aktivan, currentUserId: user!.id } }),
    onSuccess: () => {
      toast.success("Status korisnika ažuriran");
      qc.invalidateQueries({ queryKey: ["settings", "users"] });
    },
    onError: (e: any) => toast.error(e?.message || "Greška pri promeni statusa"),
  });

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Link to="/podesavanja" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Nazad
        </Link>
        <h1 className="text-xl font-semibold uppercase tracking-wide">Korisnici</h1>
      </div>


      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            navigate({ search: (prev: { page?: number; pageSize?: number }) => ({ ...prev, page: 1 }) });
          }}
          placeholder="Pretraži po imenu ili ID-u…"
          className="pl-9 h-11"
        />
      </div>
      <div className="text-sm text-muted-foreground mb-4">
        {usersQ.isLoading ? "…" : `${totalCount} korisnika`}
      </div>

      <div className="space-y-3">
        {usersQ.isLoading && (
          <>
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </>
        )}
        {!usersQ.isLoading && paginated.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
            Nema korisnika
          </div>
        )}
        {paginated.map((u) => {
          const editable = canEdit(u);
          const opts = [...visibleRoles];
          if (u.roleId && u.roleName && !opts.find((r) => r.id === u.roleId)) {
            opts.push({ id: u.roleId, naziv: u.roleName });
          }
          return (
            <div key={u.id} className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card p-4">
              <div className="size-10 rounded-full bg-primary/10 text-primary grid place-items-center font-semibold text-sm">
                {initials(u.imeIPrezime)}
              </div>
              <div className="flex-1 min-w-[180px]">
                <div className="font-semibold">{u.imeIPrezime || "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {u.idZaposlenog || "—"}
                  {u.pozicija ? ` · ${u.pozicija}` : ""}
                </div>
              </div>
              <div className="w-full sm:w-44">
                <Select
                  value={u.roleId ?? ""}
                  disabled={!editable || roleMut.isPending}
                  onValueChange={(v) => {
                    if (v && v !== u.roleId) roleMut.mutate({ userId: u.id, roleId: v });
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {opts.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.naziv}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={u.aktivan}
                  disabled={!editable || activeMut.isPending}
                  onCheckedChange={(v) => activeMut.mutate({ userId: u.id, aktivan: v })}
                />
                <span
                  className={`inline-flex items-center px-2 h-6 rounded-full text-xs font-medium ${
                    u.aktivan ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {u.aktivan ? "Aktivan" : "Neaktivan"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {!usersQ.isLoading && totalCount > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Prikaži:</span>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="h-8 w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 20, 50].map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>
              {startIndex + 1}–{Math.min(startIndex + pageSize, totalCount)} od {totalCount}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => goToPage(safePage - 1)}
              disabled={safePage <= 1}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="size-4" />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => goToPage(p)}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-sm font-medium ${
                  p === safePage
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-card text-foreground hover:bg-muted"
                }`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => goToPage(safePage + 1)}
              disabled={safePage >= totalPages}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
