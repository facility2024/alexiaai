REVOKE ALL ON FUNCTION public.apply_invite_membership(uuid, uuid, public.app_role, jsonb, uuid[], boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_invite_membership(uuid, uuid, public.app_role, jsonb, uuid[], boolean) FROM anon;
REVOKE ALL ON FUNCTION public.apply_invite_membership(uuid, uuid, public.app_role, jsonb, uuid[], boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_invite_membership(uuid, uuid, public.app_role, jsonb, uuid[], boolean) TO service_role;