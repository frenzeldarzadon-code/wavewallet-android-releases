create or replace function public.send_friend_request(_user uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    _name || ' wants to be friends', '/universe/friends?tab=requests');
  return _id;
end $function$;