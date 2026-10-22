-- =====================================================================
-- WL PEDIDOS - 07: STATUS DE PAGAMENTO DO PEDIDO (Pago / A receber)
-- Rode uma vez no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- =====================================================================
alter table public.pedidos add column if not exists pago boolean not null default false;

-- A loja pode marcar o pedido como pago (alem de mudar status e motivo)
grant update (status, motivo_cancelamento, pago) on public.pedidos to authenticated;

-- Avisa a API para enxergar a coluna nova na hora
notify pgrst, 'reload schema';
