-- =====================================================================
-- WL PEDIDOS - TORNAR VOCE O ADMINISTRADOR GERAL (WL Sistemas)
--
-- 1. Antes, crie seu usuario em: Supabase > Authentication > Users > Add user
--    (marque "Auto Confirm User").
-- 2. Troque o e-mail abaixo pelo seu e execute.
-- =====================================================================

insert into public.super_admins (user_id)
select id from auth.users where lower(email) = lower('SEU-EMAIL@AQUI.com')
on conflict (user_id) do nothing;

-- Deve aparecer 1 linha com o seu e-mail:
select u.email from public.super_admins s join auth.users u on u.id = s.user_id;
