-- Stop users from granting themselves a paid plan.
--
-- RLS lets an owner UPDATE their organization row, which included the `plan`
-- column — so anyone could PATCH /rest/v1/organizations {"plan":"business"}
-- and get unlimited AI questions billed to the operator. Column-level
-- privileges close that: members may rename their garage, but only the
-- functions below (and the service role) may touch `plan`.

revoke update on public.organizations from authenticated;
grant update (name) on public.organizations to authenticated;

-- ---------------------------------------------------------------------------
-- SIMULATED CHECKOUT — REMOVE WHEN REAL BILLING LANDS.
--
-- Until a payment provider is wired up, the pricing page needs some way to
-- switch plans so the limits can be exercised end to end. This function is
-- that switch, and it is deliberately the ONLY user-reachable path to the
-- plan column: when Stripe/Paddle goes live, drop this function and let the
-- webhook (service role) write the plan instead. Dropping it re-closes the
-- hole in one statement:
--     drop function public.set_plan_simulated(text);
-- ---------------------------------------------------------------------------
create or replace function public.set_plan_simulated(p_plan text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_org uuid := current_org();
begin
  if v_org is null then
    raise exception 'No organization for this user';
  end if;
  if not is_org_owner(v_org) then
    raise exception 'Only the garage owner can change the plan';
  end if;
  if p_plan not in ('free', 'pro', 'business') then
    raise exception 'Unknown plan: %', p_plan;
  end if;

  update organizations set plan = p_plan where id = v_org;
  return p_plan;
end;
$$;

revoke all on function public.set_plan_simulated(text) from public;
grant execute on function public.set_plan_simulated(text) to authenticated;
