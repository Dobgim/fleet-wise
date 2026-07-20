"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";
import { buildSeedData } from "./seed";
import { PLANS } from "./plans";
import type { AiUsage, PlanId, ServiceRecord, ServiceType, Vehicle } from "./types";

/**
 * Cloud data layer: vehicles, service records, the org's plan and the monthly
 * AI-question counter all live in Supabase (scoped by RLS). Nothing about the
 * fleet is stored in the browser, so data survives cleared storage, private
 * mode and device switches — and quota cannot be edited client-side.
 */

interface FleetContextValue {
  ready: boolean;
  userEmail: string | null;
  orgId: string | null;
  orgName: string | null;
  vehicles: Vehicle[];
  records: ServiceRecord[];
  plan: PlanId;
  aiUsage: AiUsage;
  aiRemaining: number | null;
  canAddVehicle: boolean;
  setPlan: (plan: PlanId) => void;
  /** Apply the authoritative remaining count returned by /api/copilot. */
  applyAiQuota: (remaining: number | null) => void;
  refreshAiUsage: () => Promise<void>;
  addVehicle: (v: Omit<Vehicle, "id" | "createdAt">) => void;
  updateVehicle: (id: string, patch: Partial<Omit<Vehicle, "id">>) => void;
  deleteVehicle: (id: string) => void;
  addRecord: (r: Omit<ServiceRecord, "id" | "createdAt">) => void;
  updateRecord: (id: string, patch: Partial<Omit<ServiceRecord, "id">>) => void;
  deleteRecord: (id: string) => void;
  resetDemoData: () => void;
  clearAllData: () => void;
  signOut: () => Promise<void>;
}

const FleetContext = createContext<FleetContextValue | null>(null);

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

interface QuotaRow {
  count: number;
  limit: number | null;
  remaining: number | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toVehicle(row: any): Vehicle {
  return {
    id: row.id,
    registration: row.registration,
    vin: row.vin ?? "",
    make: row.make,
    model: row.model,
    mileage: Number(row.mileage),
    createdAt: row.created_at,
  };
}

function toRecord(row: any): ServiceRecord {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    type: row.type as ServiceType,
    cost: Number(row.cost),
    serviceDate: row.service_date,
    notes: row.notes ?? "",
    createdAt: row.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function FleetProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [plan, setPlanState] = useState<PlanId>("free");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [records, setRecords] = useState<ServiceRecord[]>([]);
  const [aiUsage, setAiUsage] = useState<AiUsage>({
    month: currentMonth(),
    count: 0,
  });
  const [aiRemainingState, setAiRemainingState] = useState<number | null>(null);

  // Track the auth session
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      if (!data.user) setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const refreshAiUsage = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_ai_usage");
    if (error || !data) return;
    const q = data as unknown as QuotaRow;
    setAiUsage({ month: currentMonth(), count: q.count ?? 0 });
    setAiRemainingState(q.remaining ?? null);
  }, [supabase]);

  const applyAiQuota = useCallback((remaining: number | null) => {
    setAiRemainingState(remaining);
    setAiUsage((u) => ({ month: currentMonth(), count: u.count + 1 }));
  }, []);

  const fetchFleet = useCallback(
    async (org: string) => {
      const [veh, recs] = await Promise.all([
        supabase
          .from("vehicles")
          .select("*")
          .eq("org_id", org)
          .order("created_at"),
        supabase
          .from("service_records")
          .select("*")
          .eq("org_id", org)
          .order("service_date"),
      ]);
      setVehicles((veh.data ?? []).map(toVehicle));
      setRecords((recs.data ?? []).map(toRecord));
    },
    [supabase]
  );

  // Bootstrap: find (or create) the user's organization, then load its data
  useEffect(() => {
    if (!user) {
      setOrgId(null);
      setOrgName(null);
      setVehicles([]);
      setRecords([]);
      setPlanState("free");
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: membership } = await supabase
        .from("memberships")
        .select("org_id")
        .limit(1)
        .maybeSingle();

      let org = membership?.org_id as string | undefined;
      if (!org) {
        // First login: create the organization + owner membership
        const name =
          (user.user_metadata?.company_name as string | undefined)?.trim() ||
          `${user.email?.split("@")[0] ?? "My"}'s garage`;
        const newOrgId = crypto.randomUUID();
        const { error: orgErr } = await supabase
          .from("organizations")
          .insert({ id: newOrgId, name });
        if (orgErr) {
          console.error("org create failed", orgErr);
          if (!cancelled) setReady(true);
          return;
        }
        const { error: memErr } = await supabase
          .from("memberships")
          .insert({ org_id: newOrgId, user_id: user.id, role: "owner" });
        if (memErr) {
          console.error("membership create failed", memErr);
          if (!cancelled) setReady(true);
          return;
        }
        org = newOrgId;
      }

      const { data: orgRow } = await supabase
        .from("organizations")
        .select("id, name, plan")
        .eq("id", org)
        .maybeSingle();

      if (cancelled) return;
      setOrgId(org);
      setOrgName(orgRow?.name ?? null);
      setPlanState((orgRow?.plan as PlanId) ?? "free");
      await Promise.all([fetchFleet(org), refreshAiUsage()]);
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, supabase, fetchFleet, refreshAiUsage]);

  const fail = useCallback(
    (context: string, message: string, org: string | null) => {
      alert(`${context}: ${message}`);
      if (org) void fetchFleet(org); // resync after a failed optimistic update
    },
    [fetchFleet]
  );

  const addVehicle = useCallback(
    (v: Omit<Vehicle, "id" | "createdAt">) => {
      if (!orgId) return;
      const vehicle: Vehicle = {
        ...v,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      setVehicles((list) => [...list, vehicle]);
      void supabase
        .from("vehicles")
        .insert({
          id: vehicle.id,
          org_id: orgId,
          registration: vehicle.registration,
          vin: vehicle.vin,
          make: vehicle.make,
          model: vehicle.model,
          mileage: vehicle.mileage,
        })
        .then(({ error }) => {
          if (error) fail("Could not save vehicle", error.message, orgId);
        });
    },
    [supabase, orgId, fail]
  );

  const updateVehicle = useCallback(
    (id: string, patch: Partial<Omit<Vehicle, "id">>) => {
      setVehicles((list) =>
        list.map((v) => (v.id === id ? { ...v, ...patch } : v))
      );
      void supabase
        .from("vehicles")
        .update({
          ...(patch.registration !== undefined && {
            registration: patch.registration,
          }),
          ...(patch.vin !== undefined && { vin: patch.vin }),
          ...(patch.make !== undefined && { make: patch.make }),
          ...(patch.model !== undefined && { model: patch.model }),
          ...(patch.mileage !== undefined && { mileage: patch.mileage }),
        })
        .eq("id", id)
        .then(({ error }) => {
          if (error) fail("Could not update vehicle", error.message, orgId);
        });
    },
    [supabase, orgId, fail]
  );

  const deleteVehicle = useCallback(
    (id: string) => {
      setVehicles((list) => list.filter((v) => v.id !== id));
      setRecords((list) => list.filter((r) => r.vehicleId !== id));
      void supabase
        .from("vehicles")
        .delete()
        .eq("id", id)
        .then(({ error }) => {
          if (error) fail("Could not delete vehicle", error.message, orgId);
        });
    },
    [supabase, orgId, fail]
  );

  const addRecord = useCallback(
    (r: Omit<ServiceRecord, "id" | "createdAt">) => {
      if (!orgId) return;
      const record: ServiceRecord = {
        ...r,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      setRecords((list) => [...list, record]);
      void supabase
        .from("service_records")
        .insert({
          id: record.id,
          org_id: orgId,
          vehicle_id: record.vehicleId,
          type: record.type,
          cost: record.cost,
          service_date: record.serviceDate,
          notes: record.notes,
        })
        .then(({ error }) => {
          if (error) fail("Could not save record", error.message, orgId);
        });
    },
    [supabase, orgId, fail]
  );

  const updateRecord = useCallback(
    (id: string, patch: Partial<Omit<ServiceRecord, "id">>) => {
      setRecords((list) =>
        list.map((r) => (r.id === id ? { ...r, ...patch } : r))
      );
      void supabase
        .from("service_records")
        .update({
          ...(patch.type !== undefined && { type: patch.type }),
          ...(patch.cost !== undefined && { cost: patch.cost }),
          ...(patch.serviceDate !== undefined && {
            service_date: patch.serviceDate,
          }),
          ...(patch.notes !== undefined && { notes: patch.notes }),
        })
        .eq("id", id)
        .then(({ error }) => {
          if (error) fail("Could not update record", error.message, orgId);
        });
    },
    [supabase, orgId, fail]
  );

  const deleteRecord = useCallback(
    (id: string) => {
      setRecords((list) => list.filter((r) => r.id !== id));
      void supabase
        .from("service_records")
        .delete()
        .eq("id", id)
        .then(({ error }) => {
          if (error) fail("Could not delete record", error.message, orgId);
        });
    },
    [supabase, orgId, fail]
  );

  const setPlan = useCallback(
    (next: PlanId) => {
      if (!orgId) return;
      setPlanState(next);
      // Simulated checkout: the plan column is not writable by users, so this
      // goes through a database function. Replaced by the payment provider's
      // webhook when real billing lands.
      void supabase
        .rpc("set_plan_simulated", { p_plan: next })
        .then(({ error }) => {
          if (error) alert(`Could not change plan: ${error.message}`);
          else void refreshAiUsage(); // new plan, new allowance
        });
    },
    [supabase, orgId, refreshAiUsage]
  );


  const clearAllData = useCallback(() => {
    if (!orgId) return;
    setVehicles([]);
    setRecords([]);
    void (async () => {
      const { error: recErr } = await supabase
        .from("service_records")
        .delete()
        .eq("org_id", orgId);
      const { error: vehErr } = await supabase
        .from("vehicles")
        .delete()
        .eq("org_id", orgId);
      const error = recErr ?? vehErr;
      if (error) fail("Could not clear data", error.message, orgId);
    })();
  }, [supabase, orgId, fail]);

  const resetDemoData = useCallback(() => {
    if (!orgId) return;
    void (async () => {
      await supabase.from("service_records").delete().eq("org_id", orgId);
      await supabase.from("vehicles").delete().eq("org_id", orgId);

      // Seed ids are local placeholders — remap to real uuids for Postgres
      const seed = buildSeedData();
      const idMap = new Map(seed.vehicles.map((v) => [v.id, crypto.randomUUID()]));
      const vehicleRows = seed.vehicles.map((v) => ({
        id: idMap.get(v.id)!,
        org_id: orgId,
        registration: v.registration,
        vin: v.vin,
        make: v.make,
        model: v.model,
        mileage: v.mileage,
      }));
      const recordRows = seed.records.map((r) => ({
        id: crypto.randomUUID(),
        org_id: orgId,
        vehicle_id: idMap.get(r.vehicleId)!,
        type: r.type,
        cost: r.cost,
        service_date: r.serviceDate,
        notes: r.notes,
      }));
      const { error: vErr } = await supabase.from("vehicles").insert(vehicleRows);
      const { error: rErr } = vErr
        ? { error: vErr }
        : await supabase.from("service_records").insert(recordRows);
      if (rErr) {
        fail("Could not load demo data", rErr.message, orgId);
        return;
      }
      await fetchFleet(orgId);
    })();
  }, [supabase, orgId, fetchFleet, fail]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, [supabase]);

  const planCfg = PLANS[plan];
  // Server value wins; fall back to a local estimate until it arrives.
  const aiRemaining =
    planCfg.aiQuestionsPerMonth === null
      ? null
      : (aiRemainingState ??
        Math.max(0, planCfg.aiQuestionsPerMonth - aiUsage.count));
  const canAddVehicle =
    planCfg.maxVehicles === null || vehicles.length < planCfg.maxVehicles;

  return (
    <FleetContext.Provider
      value={{
        ready,
        userEmail: user?.email ?? null,
        orgId,
        orgName,
        vehicles,
        records,
        plan,
        aiUsage,
        aiRemaining,
        canAddVehicle,
        setPlan,
        applyAiQuota,
        refreshAiUsage,
        addVehicle,
        updateVehicle,
        deleteVehicle,
        addRecord,
        updateRecord,
        deleteRecord,
        resetDemoData,
        clearAllData,
        signOut,
      }}
    >
      {children}
    </FleetContext.Provider>
  );
}

export function useFleet(): FleetContextValue {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error("useFleet must be used inside <FleetProvider>");
  return ctx;
}
