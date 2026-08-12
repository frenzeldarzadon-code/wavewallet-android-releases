CREATE OR REPLACE FUNCTION public.set_ecosystem_facebook(
  _ecosystem_id uuid,
  _url text DEFAULT NULL,
  _page_name text DEFAULT NULL
)
RETURNS public.ecosystems
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  _row public.ecosystems;
  _prev public.ecosystems;
  _actor text;
  _clean text;
  _name text;
  _super boolean;
begin
  _super := public.is_super_admin(auth.uid());
  if not (_super or public.is_ecosystem_admin(auth.uid(), _ecosystem_id)) then
    raise exception 'You can only set the Facebook page of your own shop';
  end if;

  select * into _prev from public.ecosystems where id = _ecosystem_id;
  if _prev.id is null then raise exception 'Ecosystem not found'; end if;

  _clean := nullif(trim(coalesce(_url, '')), '');
  _name := nullif(trim(coalesce(_page_name, '')), '');

  if _clean is not null then
    if _clean !~* '^https://(www\.|m\.|web\.)?(facebook\.com|fb\.com|fb\.me|m\.me|messenger\.com)/[^\s]+$' then
      raise exception 'Enter a full Facebook page address starting with https:// (facebook.com, fb.com, fb.me, m.me or messenger.com)';
    end if;
  end if;

  update public.ecosystems
     set facebook_page_url = _clean,
         facebook_page_name = _name
   where id = _ecosystem_id
  returning * into _row;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor, case when _super then 'Super Admin' else 'Admin' end),
          case when _clean is null then 'Cleared ecosystem Facebook page' else 'Updated ecosystem Facebook page' end,
          _row.name,
          jsonb_build_object('url_before', _prev.facebook_page_url,
                             'url_after', _row.facebook_page_url,
                             'page_name_before', _prev.facebook_page_name,
                             'page_name_after', _row.facebook_page_name,
                             'by_super_admin', _super));
  return _row;
end;
$$;

REVOKE ALL ON FUNCTION public.set_ecosystem_facebook(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_ecosystem_facebook(uuid, text, text) TO authenticated;