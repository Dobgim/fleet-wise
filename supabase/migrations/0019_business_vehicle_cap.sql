-- Business becomes 20 vehicles rather than unlimited.
--
-- "Unlimited" on a flat $20 was an open-ended promise: one customer with a
-- 300-vehicle fleet costs real money in AI calls and reminder emails while
-- paying the same as one with six. A stated cap is also easier to sell
-- against Premium, because the two plans can now be compared on one number.
--
-- 20 is deliberate: Premium overtakes the flat price at 6 vehicles
-- (2 free + $20/$5), so Business covers the whole range from there to a
-- fleet size that is plainly a business.

create or replace function public.vehicle_limit_for_org(org uuid)
returns integer
language sql stable security definer
set search_path = public
as $$
  select case public.effective_plan(org)
    when 'business' then 20
    when 'pro' then public.free_vehicles()
                    + greatest(0, coalesce((select seats from organizations where id = org), 0))
    else public.free_vehicles()
  end;
$$;

revoke all on function public.vehicle_limit_for_org(uuid) from public;
grant execute on function public.vehicle_limit_for_org(uuid) to authenticated;

-- Nothing here removes vehicles from anyone already over the cap. The
-- enforcement trigger blocks new inserts, so an existing over-limit fleet
-- keeps working and simply cannot grow — deleting a paying customer's data
-- to satisfy a pricing change would be indefensible.
