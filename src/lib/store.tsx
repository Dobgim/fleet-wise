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
import { useAuth, useUser } from "@clerk/nextjs";
import { createClient } from "./supabase/client";
import { FREE_VEHICLES } from "./plans";
import { buildSeedData } from "./seed";

import type {
  AiBudget,
  PlanId,
  ServiceRecord,
  ServiceType,
  Vehicle,
} from "./types";

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
  remindersEnabled: boolean;
  setRemindersEnabled: (on: boolean) => void;
  vehicles: Vehicle[];
  records: ServiceRecord[];
  plan: PlanId;
  /** Today's AI token budget, from the database. */
  budget: AiBudget;
  canAddVehicle: boolean;
  /** Set when the workspace could not be created or read. */
  orgError: string | null;
  /** Apply the authoritative budget returned by /api/copilot. */
  applyBudget: (b: AiBudget) => void;
  refreshBudget: () => Promise<void>;
  /** Re-read the org (plan, name, reminder flag) and the token budget. */
  refreshOrg: () => Promise<void>;
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

function emptyBudget(limit = 0): AiBudget {
  return {
    limit,
    used: 0,
    remaining: limit,
    requests: 0,
    resets_at: "",
    plan: "free",
    vehicleLimit: FREE_VEHICLES,
    freeVehicles: FREE_VEHICLES,
    seats: null,
    beta: false,
  };
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
  // Identity comes from Clerk. `isLoaded` matters: until it flips, Clerk does
  // not yet know whether anyone is signed in, and acting on that would either
  // create a duplicate org or wrongly clear the screen.
  const { user, isLoaded: userLoaded } = useUser();
  const { getToken, signOut: clerkSignOut } = useAuth();

  // getToken is stable across renders, so the Supabase client is built once.
  // It calls getToken per request and therefore always sends a live token,
  // even though this client outlives many token rotations.
  const supabase = useMemo(() => createClient(() => getToken()), [getToken]);

  const [ready, setReady] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [remindersEnabled, setRemindersState] = useState(true);
  const [plan, setPlanState] = useState<PlanId>("free");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [records, setRecords] = useState<ServiceRecord[]>([]);
  const [budget, setBudget] = useState<AiBudget>(emptyBudget());

  const refreshBudget = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_ai_budget");
    if (error || !data) return;
    setBudget(data as unknown as AiBudget);
  }, [supabase]);

  const applyBudget = useCallback((b: AiBudget) => {
    if (b) setBudget(b);
  }, []);

  /**
   * Re-read the organization. Needed after checkout: Paddle returns the
   * browser here within a second, but the plan is granted asynchronously by
   * the webhook, so the page must look again rather than trust what it
   * loaded with.
   */
  const refreshOrg = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from("organizations")
      .select("plan, name, reminders_enabled")
      .eq("id", orgId)
      .maybeSingle();
    if (data) {
      setPlanState((data.plan as PlanId) ?? "free");
      setOrgName(data.name ?? null);
      setRemindersState(data.reminders_enabled ?? true);
    }
    await refreshBudget();
  }, [supabase, orgId, refreshBudget]);

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
    // Wait for Clerk to report. Treating "not loaded yet" as "signed out"
    // would blank the app on every refresh.
    if (!userLoaded) return;
    if (!user) {
      setOrgId(null);
      setOrgName(null);
      setVehicles([]);
      setRecords([]);
      setPlanState("free");
      setReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: membership, error: memReadErr } = await supabase
        .from("memberships")
        .select("org_id")
        .limit(1)
        .maybeSingle();
      if (memReadErr) {
        console.error("membership read failed", memReadErr);
        if (!cancelled) {
          setOrgError(`Could not load your workspace: ${memReadErr.message}`);
          setReady(true);
        }
        return;
      }

      let org = membership?.org_id as string | undefined;
      if (!org) {
        // First sign-in: create the organization + owner membership.
        const email = user.primaryEmailAddress?.emailAddress;
        const name =
          (user.unsafeMetadata?.company_name as string | undefined)?.trim() ||
          `${email?.split("@")[0] ?? "My"}'s garage`;
        const newOrgId = crypto.randomUUID();
        const { error: orgErr } = await supabase
          .from("organizations")
          .insert({ id: newOrgId, name });
        if (orgErr) {
          console.error("org create failed", orgErr);
          if (!cancelled) {
            setOrgError(`Could not create your workspace: ${orgErr.message}`);
            setReady(true);
          }
          return;
        }
        const { error: memErr } = await supabase
          .from("memberships")
          .insert({ org_id: newOrgId, user_id: user.id, role: "owner" });
        if (memErr) {
          console.error("membership create failed", memErr);
          if (!cancelled) {
            setOrgError(`Could not set up your workspace: ${memErr.message}`);
            setReady(true);
          }
          return;
        }
        org = newOrgId;
      }

      const { data: orgRow } = await supabase
        .from("organizations")
        .select("id, name, plan, reminders_enabled")
        .eq("id", org)
        .maybeSingle();

      if (cancelled) return;
      setOrgId(org);
      setOrgName(orgRow?.name ?? null);
      setPlanState((orgRow?.plan as PlanId) ?? "free");
      setRemindersState(orgRow?.reminders_enabled ?? true);
      await Promise.all([fetchFleet(org), refreshBudget()]);
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, userLoaded, supabase, fetchFleet, refreshBudget]);

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
          if (!error) return;
          // The database enforces the vehicle cap (trigger in 0012), so this
          // fires if the browser's copy of the limit was stale — or if
          // someone tried to bypass the UI entirely.
          fail(
            "Could not save vehicle",
            error.message.includes("vehicle_limit_reached")
              ? "You've used all the vehicles your plan covers. Add one on the Pricing page to make room."
              : error.message,
            orgId
          );
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

  const setRemindersEnabled = useCallback(
    (on: boolean) => {
      if (!orgId) return;
      setRemindersState(on);
      void supabase
        .from("organizations")
        .update({ reminders_enabled: on })
        .eq("id", orgId)
        .then(({ error }) => {
          if (error) {
            setRemindersState(!on);
            alert(`Could not change reminder setting: ${error.message}`);
          }
        });
    },
    [supabase, orgId]
  );

  const signOut = useCallback(async () => {
    await clerkSignOut();
  }, [clerkSignOut]);

  // Postgres decides entitlement (effective_plan + vehicle_limit_for_org):
  // it accounts for the trial, its expiry, and the vehicles actually paid
  // for. A trigger enforces the same number, so this is only about showing
  // the right thing before the user tries.
  const canAddVehicle =
    budget.vehicleLimit === null || vehicles.length < budget.vehicleLimit;

  return (
    <FleetContext.Provider
      value={{
        ready,
        userEmail: user?.primaryEmailAddress?.emailAddress ?? null,
        orgId,
        orgName,
        remindersEnabled,
        setRemindersEnabled,
        vehicles,
        records,
        plan,
        budget,
        canAddVehicle,
        orgError,
        applyBudget,
        refreshBudget,
        refreshOrg,
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
