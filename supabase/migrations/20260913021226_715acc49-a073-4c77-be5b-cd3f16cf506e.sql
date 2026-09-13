ALTER TABLE public.app_release
  ADD COLUMN IF NOT EXISTS android_version_code integer NOT NULL DEFAULT 0
  CHECK (android_version_code >= 0);

DROP FUNCTION IF EXISTS public.update_app_release(boolean,text,text,date,bigint,text,text,text);

CREATE OR REPLACE FUNCTION public.update_app_release(
  _android_enabled boolean,
  _android_download_url text,
  _android_version text,
  _android_release_date date,
  _android_size_bytes bigint,
  _android_min_os text,
  _android_sha256 text,
  _android_release_notes text,
  _android_version_code integer DEFAULT 0
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
    android_version_code = greatest(coalesce(_android_version_code, 0), 0),
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
                             'version', _row.android_version, 'build', _row.android_version_code,
                             'sha256', _row.android_sha256));

  return _row;
end; $$;

REVOKE ALL ON FUNCTION public.update_app_release(boolean,text,text,date,bigint,text,text,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_app_release(boolean,text,text,date,bigint,text,text,text,integer) TO authenticated, service_role;

UPDATE public.app_release SET
  android_enabled = true,
  android_version = '1.5.1',
  android_version_code = 8,
  android_download_url = 'https://github.com/frenzeldarzadon-code/onewave-android-releases/releases/download/v1.5.1/app-release.apk',
  android_sha256 = '292bbbdd900b2719ad9e0046138b9b87c2d4ec9846ba31c056e0ef648b31cbc7',
  android_release_date = DATE '2026-09-13',
  android_release_notes = 'ONE WAVE 1.5.1: integrated payment listener, in-app update center, improved voucher image saving, coin loan and repayment functionality, and improved update compatibility for existing Android users.'
WHERE id = 1;