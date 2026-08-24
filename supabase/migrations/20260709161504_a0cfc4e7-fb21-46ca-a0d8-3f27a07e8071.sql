
REVOKE ALL ON FUNCTION public.get_master_owner() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_master_owner() TO service_role;
