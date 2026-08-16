CREATE TABLE public.app_release (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  android_enabled boolean NOT NULL DEFAULT false,
  android_download_url text NOT NULL DEFAULT '',
  android_version text NOT NULL DEFAULT '',
  android_release_date date,
  android_size_bytes bigint NOT NULL DEFAULT 0 CHECK (android_size_bytes >= 0),
  android_min_os text NOT NULL DEFAULT 'Android 7.0+',
  android_sha256 text NOT NULL DEFAULT '',
  android_release_notes text NOT NULL DEFAULT '',
  android_download_count bigint NOT NULL DEFAULT 0,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_release TO anon, authenticated;
GRANT ALL ON public.app_release TO service_role;
ALTER TABLE public.app_release ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read the app release row"
  ON public.app_release FOR SELECT TO anon, authenticated USING (true);

CREATE TRIGGER app_release_updated_at
  BEFORE UPDATE ON public.app_release
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.app_release (id) VALUES (1);

CREATE OR REPLACE FUNCTION public.update_app_release(
  _android_enabled boolean,
  _android_download_url text,
  _android_version text,
  _android_release_date date,
  _android_size_bytes bigint,
  _android_min_os text,
  _android_sha256 text,
  _android_release_notes text
) RETURNS public.app_release
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare _row public.app_release; _actor text; _url text; _sha text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can change the app release';
  end if;

  _url := btrim(coalesce(_android_download_url, ''));
  if _url <> '' and _url !~* '^https://' then
    raise exception 'The download link must be a secure https:// URL';
  end if;

  _sha := lower(regexp_replace(coalesce(_android_sha256, ''), '[^0-9a-fA-F]', '', 'g'));
  if _sha <> '' and _sha !~ '^[0-9a-f]{64}$' then
    raise exception 'SHA-256 must be 64 hexadecimal characters';
  end if;

  if coalesce(_android_enabled, false) and _url = '' then
    raise exception 'Add the official APK link before publishing the download';
  end if;

  update public.app_release set
    android_enabled = coalesce(_android_enabled, false),
    android_download_url = _url,
    android_version = btrim(coalesce(_android_version, '')),
    android_release_date = _android_release_date,
    android_size_bytes = greatest(coalesce(_android_size_bytes, 0), 0),
    android_min_os = nullif(btrim(coalesce(_android_min_os, '')), ''),
    android_sha256 = _sha,
    android_release_notes = btrim(coalesce(_android_release_notes, '')),
    updated_by = auth.uid()
  where id = 1
  returning * into _row;

  select coalesce(full_name, 'Platform owner') into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (null, auth.uid(), coalesce(_actor, 'Platform owner'), 'Updated official app release',
          coalesce(nullif(_row.android_version, ''), 'Android app'),
          jsonb_build_object('enabled', _row.android_enabled, 'url', _row.android_download_url,
                             'version', _row.android_version, 'sha256', _row.android_sha256));

  return _row;
end; $$;

CREATE OR REPLACE FUNCTION public.record_app_download()
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare _n bigint;
begin
  update public.app_release
     set android_download_count = android_download_count + 1
   where id = 1 and android_enabled
  returning android_download_count into _n;
  return coalesce(_n, 0);
end; $$;

REVOKE ALL ON FUNCTION public.update_app_release(boolean,text,text,date,bigint,text,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_app_release(boolean,text,text,date,bigint,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_app_download() TO anon, authenticated;