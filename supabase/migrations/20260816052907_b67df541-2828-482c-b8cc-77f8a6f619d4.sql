ALTER TABLE public.ecosystems ADD COLUMN IF NOT EXISTS contact_name text;

DROP FUNCTION IF EXISTS public.update_ecosystem(uuid, text, text, text, text, boolean);

CREATE OR REPLACE FUNCTION public.update_ecosystem(
  _ecosystem_id uuid,
  _name text,
  _description text DEFAULT NULL::text,
  _contact_email text DEFAULT NULL::text,
  _contact_phone text DEFAULT NULL::text,
  _signup_enabled boolean DEFAULT NULL::boolean,
  _contact_name text DEFAULT NULL::text
)
 RETURNS ecosystems
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _row public.ecosystems; _actor text; _prev public.ecosystems;
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if coalesce(trim(_name),'') = '' then raise exception 'An ecosystem needs a name'; end if;

  select * into _prev from public.ecosystems where id = _ecosystem_id;
  if _prev.id is null then raise exception 'Ecosystem not found'; end if;

  update public.ecosystems
     set name = trim(_name),
         description = nullif(trim(_description),''),
         contact_email = nullif(lower(trim(_contact_email)),''),
         contact_phone = nullif(trim(_contact_phone),''),
         contact_name = case when _contact_name is null then contact_name
                             else nullif(trim(_contact_name),'') end,
         signup_enabled = coalesce(_signup_enabled, signup_enabled)
   where id = _ecosystem_id
  returning * into _row;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor,'Admin'), 'Updated ecosystem settings', _row.name,
          jsonb_build_object('signup_enabled_before', _prev.signup_enabled,
                             'signup_enabled_after', _row.signup_enabled));
  return _row;
end;
$function$;

REVOKE ALL ON FUNCTION public.update_ecosystem(uuid, text, text, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_ecosystem(uuid, text, text, text, text, boolean, text) TO authenticated;
