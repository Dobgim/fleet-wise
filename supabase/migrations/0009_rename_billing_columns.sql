-- Billing moved from Stripe to Paddle (Stripe does not register merchants in
-- Cameroon; Paddle does, and as merchant of record it also handles worldwide
-- sales tax). The columns were named after Stripe — rename them so the
-- schema does not lie about which provider is in use.

alter table public.organizations
  rename column stripe_customer_id to billing_customer_id;

alter table public.subscriptions
  rename column stripe_subscription_id to billing_subscription_id;
