import { createFileRoute, useNavigate, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";

export const Route = createFileRoute("/_auth/podesavanja")({
  head: () => ({ meta: [{ title: "Podešavanja — MES Shop Floor" }] }),
  component: PodesavanjaLayout,
});

function PodesavanjaLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && !user.permissions.manageUsers) navigate({ to: "/shop-floor" });
  }, [user, navigate]);

  return <Outlet />;
}
