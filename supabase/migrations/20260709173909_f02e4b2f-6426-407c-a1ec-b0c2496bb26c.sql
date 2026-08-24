REVOKE ALL ON FUNCTION public.approve_invite_access_request(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.approve_invite_access_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_invite_access_request(uuid, text) TO authenticated, service_role;