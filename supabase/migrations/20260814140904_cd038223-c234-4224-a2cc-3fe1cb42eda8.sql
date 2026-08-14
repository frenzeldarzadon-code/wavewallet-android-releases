revoke all on public.social_follows, public.social_friendships,
  public.notification_preferences, public.member_notifications from anon;

revoke execute on function
  public.follow_member(uuid, boolean),
  public.send_friend_request(uuid),
  public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid),
  public.my_social_graph(),
  public.universe_relationship(uuid),
  public.universe_profile_posts(text, integer),
  public.my_notifications(integer),
  public.mark_notifications_read(uuid[]),
  public.set_notification_preferences(text[], boolean),
  public.platform_unassigned_users(text),
  public.platform_user_deletion_check(uuid),
  public.superadmin_assign_member_to_shop(uuid, uuid),
  public.superadmin_delete_platform_user(uuid, text),
  public.notify_handle_mentions(uuid, text, text, text, text)
from anon;