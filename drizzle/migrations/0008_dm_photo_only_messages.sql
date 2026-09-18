-- A message may carry a photo with no caption; text-only messages keep the
-- same 1..2000 character rule.
alter table public.dm_messages drop constraint if exists dm_body;
alter table public.dm_messages add constraint dm_body
  check (length(btrim(body)) <= 2000
         and (length(btrim(body)) >= 1 or image_path is not null));