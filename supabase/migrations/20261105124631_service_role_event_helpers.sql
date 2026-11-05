SET check_function_bodies = false;
GRANT ALL ON FUNCTION public.current_actor_id() TO service_role;
GRANT ALL ON FUNCTION public.current_actor_type() TO service_role;
