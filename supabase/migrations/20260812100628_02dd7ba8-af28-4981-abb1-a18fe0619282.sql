alter table public.credit_lots add column if not exists seq bigserial;
create index if not exists credit_lots_fifo_seq_idx on public.credit_lots (user_id, seq) where remaining > 0;

create or replace function public.track_credit_lots()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _kind text; _src uuid; _left numeric(14,2); _take numeric(14,2); _lot record;
begin
  if new.direction = 'credit' then
    _src := new.actor_id;
    if new.entry_kind = 'sale_commission' or _src is null then
      _kind := 'system'; _src := null;
    elsif _src = new.user_id then
      _kind := 'self';
    elsif public.is_super_admin(_src) or public.is_ecosystem_admin(_src, new.ecosystem_id) then
      _kind := 'admin';
    elsif exists (select 1 from public.user_roles ur
                   where ur.user_id = _src and ur.role = 'reseller' and ur.ecosystem_id = new.ecosystem_id) then
      _kind := 'reseller';
    elsif exists (select 1 from public.user_roles ur
                   where ur.user_id = _src and ur.role = 'subreseller' and ur.ecosystem_id = new.ecosystem_id) then
      _kind := 'subreseller';
    else
      _kind := 'system'; _src := null;
    end if;

    insert into public.credit_lots (ecosystem_id, user_id, ledger_id, source_user_id, source_kind, amount, remaining)
    values (new.ecosystem_id, new.user_id, new.id, _src, _kind, new.amount, new.amount)
    on conflict (ledger_id) do nothing;
    return null;
  end if;

  _left := new.amount;
  for _lot in
    select id, remaining from public.credit_lots
     where user_id = new.user_id and remaining > 0
     order by seq
     for update
  loop
    exit when _left <= 0;
    _take := least(_left, _lot.remaining);
    update public.credit_lots set remaining = remaining - _take where id = _lot.id;
    insert into public.credit_lot_consumptions (ecosystem_id, ledger_id, lot_id, user_id, amount)
    values (new.ecosystem_id, new.id, _lot.id, new.user_id, _take)
    on conflict (ledger_id, lot_id) do nothing;
    _left := _left - _take;
  end loop;
  return null;
end;
$$;
