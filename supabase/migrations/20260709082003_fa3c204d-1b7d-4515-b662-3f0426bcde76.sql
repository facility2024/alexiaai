REVOKE EXECUTE ON FUNCTION public.seed_legal_area_templates(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_legal_area_templates(uuid) TO service_role;