-- Tighten platform_settings reads: only the platform owner reads the full row.
-- Signed-in members get the checkout-safe subset through a guarded function.

drop policy if exists "Signed-in operators read platform settings" on public.platform_settings;

create policy "Platform owner reads platform settings"
on public.platform_settings
for select
to authenticated
using (public.is_super_admin(auth.uid()));

-- Checkout-safe settings any signed-in member may read (payment instructions,
-- support contact, plan pricing and the member-facing fee/valuation rates).
create or replace function public.get_public_platform_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(s) from (
    select
      currency,
      gcash_number,
      gcash_account_name,
      payment_instructions,
      support_page_name,
      support_page_url,
      support_message,
      credit_gcash_number,
      credit_gcash_account_name,
      credit_payment_instructions,
      credit_release_mode,
      plan_name,
      plan_price,
      billing_period,
      grace_period_days,
      cash_out_credits_per_unit,
      cash_out_php_per_unit,
      withdrawal_fee_percent,
      cash_in_fee_percent,
      shop_transfer_fee_credits,
      loans_enabled,
      universe_loan_enabled,
      universe_loan_interest_percent
    from public.platform_settings
    where id = 1
  ) s
$$;

revoke all on function public.get_public_platform_settings() from public;
grant execute on function public.get_public_platform_settings() to authenticated;

-- Commercial terms for the credit purchase page: shop admins and the platform
-- owner only, never ordinary members.
create or replace function public.get_credit_purchase_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.is_super_admin(auth.uid())
    or exists (
      select 1
      from public.ecosystem_memberships m
      where m.user_id = auth.uid()
        and m.role = 'admin'
        and m.status = 'active'
    )
  ) then
    raise exception 'Only shop admins can read credit purchase settings';
  end if;

  return (
    select to_jsonb(s) from (
      select
        currency,
        support_page_name,
        support_page_url,
        support_message,
        gcash_number,
        gcash_account_name,
        payment_instructions,
        credit_gcash_number,
        credit_gcash_account_name,
        credit_payment_instructions,
        credit_release_mode,
        admin_credit_discount_percent,
        admin_voucher_discount_percent,
        default_admin_sale_commission_percent
      from public.platform_settings
      where id = 1
    ) s
  );
end
$$;

revoke all on function public.get_credit_purchase_settings() from public;
grant execute on function public.get_credit_purchase_settings() to authenticated;