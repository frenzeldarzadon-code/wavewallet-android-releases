
-- =========================================================================
-- 1. Social graph: follows + friendships
-- =========================================================================
CREATE TABLE public.social_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  followee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
GRANT SELECT, INSERT, DELETE ON public.social_follows TO authenticated;
GRANT ALL ON public.social_follows TO service_role;
ALTER TABLE public.social_follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read follows they are part of"
  ON public.social_follows FOR SELECT TO authenticated
  USING (follower_id = auth.uid() OR followee_id = auth.uid() OR public.is_super_admin(auth.uid()));
CREATE POLICY "Members manage their own follows"
  ON public.social_follows FOR ALL TO authenticated
  USING (follower_id = auth.uid()) WITH CHECK (follower_id = auth.uid());

CREATE TABLE public.social_friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK (requester_id <> addressee_id)
);
CREATE UNIQUE INDEX social_friendship_pair_idx ON public.social_friendships
  (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_friendships TO authenticated;
GRANT ALL ON public.social_friendships TO service_role;
ALTER TABLE public.social_friendships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read their own friendships"
  ON public.social_friendships FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid() OR public.is_super_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
begin NEW.updated_at = now(); return NEW; end $$;

CREATE TRIGGER social_friendships_updated_at
  BEFORE UPDATE ON public.social_friendships
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- =========================================================================
-- 2. Notification preferences + delivery helper
-- =========================================================================
CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  disabled_kinds text[] NOT NULL DEFAULT '{}',
  push_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members manage their own notification preferences"
  ON public.notification_preferences FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE OR REPLACE FUNCTION public.notify_universe(
  _user uuid, _kind text, _title text, _body text, _link text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if _user is null then return; end if;
  if exists (select 1 from public.notification_preferences p
              where p.user_id = _user and _kind = any(p.disabled_kinds)) then
    return;
  end if;
  if exists (select 1 from public.profiles p where p.id = _user and p.deleted_at is not null) then
    return;
  end if;
  insert into public.member_notifications (user_id, ecosystem_id, kind, title, body, link)
  values (_user, null, _kind, _title, _body, _link);
end $$;

CREATE OR REPLACE FUNCTION public.notify_handle_mentions(
  _actor uuid, _body text, _kind text, _title text, _link text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _m text; _uid uuid; _name text;
begin
  select coalesce(full_name, 'A member') into _name from public.profiles where id = _actor;
  for _m in
    select distinct lower(x[1]) from regexp_matches(coalesce(_body,''), '@([A-Za-z0-9_.]{2,30})', 'g') as x
  loop
    select id into _uid from public.profiles
     where deleted_at is null and public.normalize_handle(handle) = public.normalize_handle(_m)
     limit 1;
    if _uid is not null and _uid <> _actor then
      perform public.notify_universe(_uid, _kind, _title, _name || ' mentioned you', _link);
    end if;
  end loop;
end $$;

-- =========================================================================
-- 3. Automatic notifications
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tg_notify_like()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _author uuid; _name text;
begin
  select author_id into _author from public.social_posts where id = NEW.post_id;
  if _author is null or _author = NEW.user_id then return NEW; end if;
  select coalesce(full_name, 'Someone') into _name from public.profiles where id = NEW.user_id;
  perform public.notify_universe(_author, 'social_like', 'New like on your post',
    _name || ' liked your post', '/universe?post=' || NEW.post_id::text);
  return NEW;
end $$;
CREATE TRIGGER social_likes_notify AFTER INSERT ON public.social_likes
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_like();

CREATE OR REPLACE FUNCTION public.tg_notify_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _target uuid; _name text; _link text;
begin
  select coalesce(full_name, 'Someone') into _name from public.profiles where id = NEW.author_id;
  _link := '/universe?post=' || NEW.post_id::text;
  if NEW.parent_id is not null then
    select author_id into _target from public.social_comments where id = NEW.parent_id;
  else
    select author_id into _target from public.social_posts where id = NEW.post_id;
  end if;
  if _target is not null and _target <> NEW.author_id then
    perform public.notify_universe(_target, 'social_reply', 'New reply',
      _name || ' replied to you', _link);
  end if;
  perform public.notify_handle_mentions(NEW.author_id, NEW.body, 'social_mention',
    'You were mentioned', _link);
  return NEW;
end $$;
CREATE TRIGGER social_comments_notify AFTER INSERT ON public.social_comments
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_comment();

CREATE OR REPLACE FUNCTION public.tg_notify_post_mentions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  perform public.notify_handle_mentions(NEW.author_id, NEW.body, 'social_mention',
    'You were mentioned', '/universe?post=' || NEW.id::text);
  return NEW;
end $$;
CREATE TRIGGER social_posts_notify_mentions AFTER INSERT ON public.social_posts
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_post_mentions();

CREATE OR REPLACE FUNCTION public.tg_notify_dm()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _name text;
begin
  if NEW.recipient_id is null or NEW.recipient_id = NEW.sender_id then return NEW; end if;
  select coalesce(full_name, 'Someone') into _name from public.profiles where id = NEW.sender_id;
  perform public.notify_universe(NEW.recipient_id, 'dm_message', 'New private message',
    _name || ' sent you a message', '/universe/messages?thread=' || NEW.thread_id::text);
  return NEW;
end $$;
CREATE TRIGGER dm_messages_notify AFTER INSERT ON public.dm_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_dm();

CREATE OR REPLACE FUNCTION public.tg_notify_social_gift()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if NEW.direction = 'in' and coalesce(NEW.source,'') ilike '%gift%' then
    perform public.notify_universe(NEW.user_id, 'social_gift', 'You received social credits',
      NEW.amount::text || ' paid social credits — ' || coalesce(NEW.reason, 'a gift'), '/universe');
  end if;
  return NEW;
end $$;
CREATE TRIGGER social_credit_ledger_notify AFTER INSERT ON public.social_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_social_gift();

CREATE OR REPLACE FUNCTION public.tg_notify_cashback()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if NEW.direction = 'in'
     and (coalesce(NEW.entry_kind,'') ilike '%cashback%' or coalesce(NEW.reason,'') ilike '%cashback%'
          or coalesce(NEW.entry_kind,'') ilike '%commission%' and coalesce(NEW.reason,'') ilike '%cashback%') then
    perform public.notify_universe(NEW.user_id, 'cashback', 'Cashback earned',
      NEW.amount::text || ' credits — ' || coalesce(NEW.reason, 'cashback'), '/app/history');
  end if;
  return NEW;
end $$;
CREATE TRIGGER credit_ledger_notify_cashback AFTER INSERT ON public.credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_cashback();

-- =========================================================================
-- 4. Social graph RPCs
-- =========================================================================
CREATE OR REPLACE FUNCTION public.follow_member(_user uuid, _follow boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _name text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if _user = auth.uid() then raise exception 'You cannot follow yourself'; end if;
  if not exists (select 1 from public.profiles where id = _user and deleted_at is null) then
    raise exception 'That member no longer exists';
  end if;
  if _follow then
    insert into public.social_follows (follower_id, followee_id)
    values (auth.uid(), _user) on conflict do nothing;
    select coalesce(full_name, 'Someone') into _name from public.profiles where id = auth.uid();
    perform public.notify_universe(_user, 'follow', 'New follower',
      _name || ' started following you', '/universe/u/' ||
      coalesce((select handle from public.profiles where id = auth.uid()), ''));
  else
    delete from public.social_follows where follower_id = auth.uid() and followee_id = _user;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.send_friend_request(_user uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _row public.social_friendships%rowtype; _name text; _id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if _user = auth.uid() then raise exception 'You cannot befriend yourself'; end if;
  if not exists (select 1 from public.profiles where id = _user and deleted_at is null) then
    raise exception 'That member no longer exists';
  end if;
  select * into _row from public.social_friendships
   where least(requester_id, addressee_id) = least(auth.uid(), _user)
     and greatest(requester_id, addressee_id) = greatest(auth.uid(), _user)
   for update;

  if _row.id is not null then
    if _row.status = 'accepted' then raise exception 'You are already friends'; end if;
    if _row.status = 'pending' then
      if _row.requester_id = auth.uid() then raise exception 'A friend request is already pending'; end if;
      -- the other person already asked: accept it instead of creating a duplicate
      update public.social_friendships set status = 'accepted', responded_at = now()
       where id = _row.id;
      return _row.id;
    end if;
    update public.social_friendships
       set status = 'pending', requester_id = auth.uid(), addressee_id = _user, responded_at = null
     where id = _row.id;
    _id := _row.id;
  else
    insert into public.social_friendships (requester_id, addressee_id)
    values (auth.uid(), _user) returning id into _id;
  end if;

  select coalesce(full_name, 'Someone') into _name from public.profiles where id = auth.uid();
  perform public.notify_universe(_user, 'friend_request', 'New friend request',
    _name || ' wants to be friends', '/universe/profile');
  return _id;
end $$;

CREATE OR REPLACE FUNCTION public.respond_friend_request(_id uuid, _accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _row public.social_friendships%rowtype; _name text;
begin
  select * into _row from public.social_friendships where id = _id for update;
  if _row.id is null then raise exception 'Request not found'; end if;
  if _row.addressee_id <> auth.uid() then raise exception 'This request is not yours'; end if;
  if _row.status <> 'pending' then raise exception 'This request was already answered'; end if;

  if _accept then
    update public.social_friendships set status = 'accepted', responded_at = now() where id = _id;
    select coalesce(full_name, 'Someone') into _name from public.profiles where id = auth.uid();
    perform public.notify_universe(_row.requester_id, 'friend_accept', 'Friend request accepted',
      _name || ' accepted your friend request', '/universe/profile');
  else
    delete from public.social_friendships where id = _id;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.remove_friend(_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  delete from public.social_friendships
   where least(requester_id, addressee_id) = least(auth.uid(), _user)
     and greatest(requester_id, addressee_id) = greatest(auth.uid(), _user);
end $$;

CREATE OR REPLACE FUNCTION public.universe_relationship(_user uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select jsonb_build_object(
    'following', exists (select 1 from public.social_follows
                          where follower_id = auth.uid() and followee_id = _user),
    'follows_me', exists (select 1 from public.social_follows
                           where follower_id = _user and followee_id = auth.uid()),
    'follower_count', (select count(*) from public.social_follows where followee_id = _user),
    'friend_status', coalesce((
        select case when f.status = 'accepted' then 'friends'
                    when f.requester_id = auth.uid() then 'requested'
                    else 'incoming' end
          from public.social_friendships f
         where least(f.requester_id, f.addressee_id) = least(auth.uid(), _user)
           and greatest(f.requester_id, f.addressee_id) = greatest(auth.uid(), _user)
        ), 'none'),
    'friend_request_id', (
        select f.id from public.social_friendships f
         where least(f.requester_id, f.addressee_id) = least(auth.uid(), _user)
           and greatest(f.requester_id, f.addressee_id) = greatest(auth.uid(), _user)),
    'friend_count', (select count(*) from public.social_friendships f
                      where f.status = 'accepted'
                        and (f.requester_id = _user or f.addressee_id = _user))
  ) where auth.uid() is not null
$$;

CREATE OR REPLACE FUNCTION public.my_social_graph()
RETURNS TABLE(kind text, relation_id uuid, user_id uuid, full_name text, handle text,
              avatar_path text, status text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select 'friend', f.id,
         case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end,
         p.full_name, p.handle, p.avatar_path,
         case when f.status = 'accepted' then 'friends'
              when f.requester_id = auth.uid() then 'requested' else 'incoming' end,
         f.created_at
    from public.social_friendships f
    join public.profiles p
      on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
   where auth.uid() in (f.requester_id, f.addressee_id) and p.deleted_at is null
  union all
  select 'following', s.id, s.followee_id, p.full_name, p.handle, p.avatar_path, 'following', s.created_at
    from public.social_follows s join public.profiles p on p.id = s.followee_id
   where s.follower_id = auth.uid() and p.deleted_at is null
  union all
  select 'follower', s.id, s.follower_id, p.full_name, p.handle, p.avatar_path, 'follower', s.created_at
    from public.social_follows s join public.profiles p on p.id = s.follower_id
   where s.followee_id = auth.uid() and p.deleted_at is null
$$;

-- =========================================================================
-- 5. Public post history on a Universe profile
-- =========================================================================
CREATE OR REPLACE FUNCTION public.universe_profile_posts(_handle text, _limit integer DEFAULT 30)
RETURNS TABLE(id uuid, body text, image_path text, created_at timestamptz,
              like_count integer, comment_count integer, audience text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select sp.id, sp.body, sp.image_path, sp.created_at,
         sp.like_count, sp.comment_count, sp.audience
    from public.social_posts sp
    join public.profiles p on p.id = sp.author_id
   where auth.uid() is not null
     and p.deleted_at is null
     and public.normalize_handle(p.handle) = public.normalize_handle(_handle)
     and sp.status = 'published'
     and sp.audience = 'general'
   order by sp.created_at desc
   limit least(coalesce(_limit, 30), 100)
$$;

-- =========================================================================
-- 6. Notifications API
-- =========================================================================
CREATE OR REPLACE FUNCTION public.my_notifications(_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, kind text, title text, body text, link text,
              read_at timestamptz, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select n.id, n.kind, n.title, n.body, n.link, n.read_at, n.created_at
    from public.member_notifications n
   where n.user_id = auth.uid()
   order by n.created_at desc
   limit least(coalesce(_limit, 50), 200)
$$;

CREATE OR REPLACE FUNCTION public.mark_notifications_read(_ids uuid[] DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  update public.member_notifications
     set read_at = now()
   where user_id = auth.uid() and read_at is null
     and (_ids is null or id = any(_ids));
$$;

CREATE OR REPLACE FUNCTION public.set_notification_preferences(
  _disabled_kinds text[], _push_enabled boolean
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  insert into public.notification_preferences (user_id, disabled_kinds, push_enabled)
  values (auth.uid(), coalesce(_disabled_kinds, '{}'), coalesce(_push_enabled, false))
  on conflict (user_id) do update
    set disabled_kinds = excluded.disabled_kinds,
        push_enabled = excluded.push_enabled,
        updated_at = now();
$$;

-- =========================================================================
-- 7. Platform owner: Universe users with no shop
-- =========================================================================
CREATE OR REPLACE FUNCTION public.platform_unassigned_users(_search text DEFAULT NULL)
RETURNS TABLE(user_id uuid, full_name text, handle text, email text, phone text,
              avatar_path text, joined_at timestamptz, credit_total numeric,
              points_total integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can list Universe users';
  end if;
  return query
  select p.id, p.full_name, p.handle, p.email, p.phone, p.avatar_path, p.joined_at,
         coalesce((select sum(c.balance) from public.credit_accounts c where c.user_id = p.id), 0),
         coalesce((select sum(pt.balance + pt.held) from public.points_accounts pt where pt.user_id = p.id), 0)::integer
    from public.profiles p
   where p.deleted_at is null
     and not exists (select 1 from public.ecosystem_memberships m
                      where m.user_id = p.id and m.membership_state = 'active')
     and not exists (select 1 from public.user_roles r
                      where r.user_id = p.id and r.role in ('super_admin','admin','reseller','subreseller'))
     and (_search is null or btrim(_search) = '' or
          p.full_name ilike '%' || btrim(_search) || '%' or
          coalesce(p.handle,'') ilike '%' || replace(btrim(_search), '@', '') || '%' or
          coalesce(p.email,'') ilike '%' || btrim(_search) || '%' or
          coalesce(p.phone,'') ilike '%' || btrim(_search) || '%')
   order by p.joined_at desc
   limit 200;
end $$;

CREATE OR REPLACE FUNCTION public.superadmin_assign_member_to_shop(_user uuid, _ecosystem_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _actor text; _shop text; _has_active boolean;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can assign shop memberships';
  end if;
  if not exists (select 1 from public.profiles where id = _user and deleted_at is null) then
    raise exception 'That member no longer exists';
  end if;
  select name into _shop from public.ecosystems where id = _ecosystem_id;
  if _shop is null then raise exception 'Shop not found'; end if;
  if exists (select 1 from public.ecosystem_memberships m
              where m.user_id = _user and m.ecosystem_id = _ecosystem_id
                and m.membership_state = 'active') then
    raise exception 'That member already belongs to %', _shop;
  end if;

  insert into public.ecosystem_memberships (user_id, ecosystem_id, role, status, membership_state)
  values (_user, _ecosystem_id, 'customer', 'active', 'active')
  on conflict (user_id, ecosystem_id) do update
    set membership_state = 'active', role = 'customer', updated_at = now();

  perform public.ensure_membership_wallets(_user, _ecosystem_id);

  select public.active_ecosystem(_user) is not null into _has_active;
  if not _has_active then
    update public.profiles
       set ecosystem_id = _ecosystem_id, active_ecosystem_id = _ecosystem_id, updated_at = now()
     where id = _user;
    insert into public.user_roles (user_id, role, ecosystem_id)
    values (_user, 'customer', _ecosystem_id)
    on conflict (user_id, role) do update set ecosystem_id = excluded.ecosystem_id;
  end if;

  perform public.notify_universe(_user, 'shop_assignment', 'You were added to a shop',
    'The platform owner added you to ' || _shop || ' as a customer', '/app');

  select coalesce(full_name, 'Platform owner') into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), _actor, 'Assigned Universe user to shop', _user::text,
          jsonb_build_object('user_id', _user, 'ecosystem_id', _ecosystem_id, 'role', 'customer'));
end $$;

-- =========================================================================
-- 8. Platform owner: safe deletion of a zero-balance account
-- =========================================================================
CREATE OR REPLACE FUNCTION public.platform_user_deletion_check(_user uuid)
RETURNS TABLE(eligible boolean, credit_total numeric, points_total integer,
              social_purchased integer, blockers text[], reasons text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare _b text[] := '{}'; _r text[] := '{}';
        _credits numeric; _points integer; _social integer;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can review account deletion';
  end if;

  select coalesce(sum(c.balance), 0) into _credits from public.credit_accounts c where c.user_id = _user;
  select coalesce(sum(p.balance + p.held), 0)::integer into _points from public.points_accounts p where p.user_id = _user;
  select coalesce(sum(s.purchased_balance), 0)::integer into _social
    from public.social_credit_accounts s where s.user_id = _user;

  if _credits > 0 then _b := _b || ('Holds ' || _credits::text || ' credits.');
  else _r := _r || 'All shop credit balances are zero.'; end if;
  if _points > 0 then _b := _b || ('Holds ' || _points::text || ' points.');
  else _r := _r || 'No points or held points.'; end if;
  if _social > 0 then _b := _b || ('Holds ' || _social::text || ' purchased social credits.');
  else _r := _r || 'No purchased social credits.'; end if;

  if exists (select 1 from public.cash_in_requests where user_id = _user and status = 'pending')
    then _b := _b || 'A cash-in request is still pending.';
    else _r := _r || 'No pending cash-in.'; end if;
  if exists (select 1 from public.withdrawal_requests where user_id = _user and status in ('pending','approved'))
    then _b := _b || 'A cash-out request is still open.';
    else _r := _r || 'No open cash-out.'; end if;
  if exists (select 1 from public.reward_redemptions where user_id = _user and status = 'pending')
    then _b := _b || 'A reward redemption is still pending.';
    else _r := _r || 'No pending redemptions.'; end if;
  if exists (select 1 from public.retail_orders where user_id = _user and status = 'pending')
    then _b := _b || 'A retail order is still pending.'; end if;
  if exists (select 1 from public.user_roles where user_id = _user
               and role in ('super_admin','admin','reseller','subreseller'))
    then _b := _b || 'This account holds an operator role — restructure it first.';
    else _r := _r || 'No operator role attached.'; end if;
  if _user = auth.uid() then _b := _b || 'You cannot delete your own account.'; end if;

  return query select cardinality(_b) = 0, _credits, _points, _social, _b, _r;
end $$;

CREATE OR REPLACE FUNCTION public.superadmin_delete_platform_user(_user uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _check record; _actor text; _target text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can delete a platform account';
  end if;
  select p.full_name || ' — ' || coalesce(p.email, p.phone, '') into _target
    from public.profiles p where p.id = _user;
  if _target is null then raise exception 'Member not found'; end if;

  select * into _check from public.platform_user_deletion_check(_user);
  if not _check.eligible then
    raise exception 'This account cannot be deleted: %', array_to_string(_check.blockers, ' ');
  end if;

  -- Financial history stays intact; the identity is anonymised and the login is
  -- released so the same email or mobile can register again later.
  update public.profiles
     set full_name = 'Deleted member',
         email = 'deleted+' || _user::text || '@deleted.invalid',
         phone = '',
         handle = null,
         avatar_path = null,
         bio = null,
         status = 'suspended',
         deleted_at = now(),
         deleted_by = auth.uid(),
         deleted_reason = nullif(btrim(coalesce(_reason, '')), '')
   where id = _user;

  delete from public.user_roles where user_id = _user;
  delete from public.social_follows where follower_id = _user or followee_id = _user;
  delete from public.social_friendships where requester_id = _user or addressee_id = _user;
  delete from public.member_notifications where user_id = _user;
  update public.ecosystem_memberships set membership_state = 'removed', updated_at = now()
   where user_id = _user;

  select coalesce(full_name, 'Platform owner') into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (null, auth.uid(), _actor, 'Deleted platform account (anonymised)', _target,
          jsonb_build_object('user_id', _user, 'reason', _reason,
                             'history_preserved', true, 'may_register_again', true));
end $$;
