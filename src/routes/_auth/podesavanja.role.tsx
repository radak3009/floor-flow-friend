import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";
import {
  listRolePermissionsFn,
  updateRolePermissionFn,
  type PermissionField,
  type RolePermissionsRow,
} from "@/lib/api/roles.functions";
import { useAuth } from "@/context/AuthContext";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_auth/podesavanja/role")({
  component: RoleIDozvolePage,
});

const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();

const SECTIONS: { title: string; fields: { key: PermissionField; label: string }[] }[] = [
  {
    title: "view",
    fields: [
      { key: "viewAssignedMachines", label: "viewAssignedMachines" },
      { key: "viewAllFactoryMachines", label: "viewAllFactoryMachines" },
    ],
  },
  {
    title: "wo",
    fields: [
      { key: "startWorkOrder", label: "startWorkOrder" },
      { key: "pauseWorkOrder", label: "pauseWorkOrder" },
      { key: "resumeWorkOrder", label: "resumeWorkOrder" },
      { key: "stopWorkOrder", label: "stopWorkOrder" },
      { key: "resetStart", label: "resetStart" },
    ],
  },
  {
    title: "logging",
    fields: [
      { key: "logScrap", label: "logScrap" },
      { key: "deleteScrap", label: "deleteScrap" },
      { key: "logDowntime", label: "logDowntime" },
      { key: "confirmBatch", label: "confirmBatch" },
      { key: "performInspection", label: "performInspection" },
      { key: "viewHistory", label: "viewHistory" },
    ],
  },
  {
    title: "admin",
    fields: [
      { key: "viewReports", label: "viewReports" },
      { key: "manageUsers", label: "manageUsers" },
      { key: "manageSettings", label: "manageSettings" },
      { key: "manageReasonCodes", label: "manageReasonCodes" },
      { key: "manageFactoryScope", label: "manageFactoryScope" },
    ],
  },
  {
    title: "comm",
    fields: [{ key: "canComment", label: "canComment" }],
  },
];

function RoleIDozvolePage() {
  const { user } = useAuth();
  const callerRole = norm(user?.roleName);
  const isSuper = callerRole === "super admin";
  const isAdmin = callerRole === "admin";

  const listFn = useServerFn(listRolePermissionsFn);
  const updateFn = useServerFn(updateRolePermissionFn);
  const qc = useQueryClient();

  const q = useQuery({ queryKey: ["settings", "rolePermissions"], queryFn: () => listFn(), staleTime: 30_000 });

  const visibleRoles = useMemo<RolePermissionsRow[]>(() => {
    const all = q.data?.roles ?? [];
    if (isSuper) return all;
    if (isAdmin) return all.filter((r) => {
      const n = norm(r.naziv);
      return n !== "admin" && n !== "super admin";
    });
    return [];
  }, [q.data, isSuper, isAdmin]);

  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeId && visibleRoles.length) setActiveId(visibleRoles[0].id);
    if (activeId && !visibleRoles.find((r) => r.id === activeId) && visibleRoles.length) {
      setActiveId(visibleRoles[0].id);
    }
  }, [visibleRoles, activeId]);

  const active = visibleRoles.find((r) => r.id === activeId) || null;

  const mut = useMutation({
    mutationFn: async (vars: { roleId: string; field: PermissionField; value: boolean }) =>
      updateFn({ data: { ...vars, currentUserId: user!.id } }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["settings", "rolePermissions"] });
      const prev = qc.getQueryData<{ roles: RolePermissionsRow[] }>(["settings", "rolePermissions"]);
      if (prev) {
        qc.setQueryData(["settings", "rolePermissions"], {
          roles: prev.roles.map((r) =>
            r.id === vars.roleId ? { ...r, permissions: { ...r.permissions, [vars.field]: vars.value } } : r,
          ),
        });
      }
      return { prev };
    },
    onError: (e: any, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["settings", "rolePermissions"], ctx.prev);
      toast.error(e?.message || "Greška pri izmeni permisije");
    },
    onSuccess: () => toast.success("Permisija ažurirana"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["settings", "rolePermissions"] }),
  });

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/podesavanja" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Nazad
        </Link>
        <h1 className="text-xl font-semibold uppercase tracking-wide">Role i dozvole</h1>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-12 mb-6" />
      ) : (
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1 md:flex-wrap md:justify-center">
          {visibleRoles.map((r) => (
            <button
              key={r.id}
              onClick={() => setActiveId(r.id)}
              className={`px-4 h-9 rounded-full text-sm font-medium border transition-colors shrink-0 ${
                activeId === r.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-foreground border-border hover:bg-muted/40"
              }`}
            >
              {r.naziv}
            </button>
          ))}
          {!visibleRoles.length && (
            <div className="text-sm text-muted-foreground">Nema rola za prikaz.</div>
          )}
        </div>
      )}


      {active && (
        <div className="space-y-4">
          {SECTIONS.map((section) => (
            <div key={section.title} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-border">
                {section.title}
              </div>
              <div className="divide-y divide-border">
                {section.fields.map((f) => (
                  <div key={f.key} className="flex items-center justify-between px-4 py-3">
                    <div className="text-sm">{f.label}</div>
                    <Switch
                      checked={active.permissions[f.key]}
                      disabled={mut.isPending}
                      onCheckedChange={(v) => mut.mutate({ roleId: active.id, field: f.key, value: v })}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
