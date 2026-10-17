-- Schema for the fused dataset on Supabase. Paste into the dashboard's SQL Editor and run once.
-- Generated from the Parquet files; regenerate it if their columns change.
-- Row Level Security is on and only signed-in users may read; nobody but the service role can write.

create table if not exists public.fused_dev (
  customer_key integer not null primary key,
  stratum text,
  inclusion_weight double precision,
  cat_garment_upper_body double precision,
  cat_garment_lower_body double precision,
  cat_garment_full_body double precision,
  cat_swimwear double precision,
  cat_underwear double precision,
  cat_accessories double precision,
  cat_shoes double precision,
  cat_other double precision,
  dept_ladieswear double precision,
  dept_menswear double precision,
  dept_divided double precision,
  dept_sport double precision,
  dept_baby_children double precision,
  color_neutral double precision,
  color_warm double precision,
  color_cool double precision,
  color_concentration double precision,
  solid_share double precision,
  price_level double precision,
  markdown_affinity double precision,
  novelty_affinity double precision,
  rebuy_share double precision,
  channel_2_share double precision,
  purchase_frequency double precision,
  mainstream_score double precision,
  basket_size double precision,
  activity_spread double precision,
  click_to_cart double precision,
  cart_to_order double precision,
  comparison double precision,
  exploration double precision,
  decision_speed double precision,
  browsing_pace double precision,
  multi_visit_research double precision,
  evening_share double precision,
  weekend_share double precision,
  match_confidence double precision,
  match_distance double precision
);
alter table public.fused_dev enable row level security;
drop policy if exists "team read" on public.fused_dev;
create policy "team read" on public.fused_dev for select to authenticated using (true);

create table if not exists public.fused_final (
  customer_key integer not null primary key,
  stratum text,
  inclusion_weight double precision,
  cat_garment_upper_body double precision,
  cat_garment_lower_body double precision,
  cat_garment_full_body double precision,
  cat_swimwear double precision,
  cat_underwear double precision,
  cat_accessories double precision,
  cat_shoes double precision,
  cat_other double precision,
  dept_ladieswear double precision,
  dept_menswear double precision,
  dept_divided double precision,
  dept_sport double precision,
  dept_baby_children double precision,
  color_neutral double precision,
  color_warm double precision,
  color_cool double precision,
  color_concentration double precision,
  solid_share double precision,
  price_level double precision,
  markdown_affinity double precision,
  novelty_affinity double precision,
  rebuy_share double precision,
  channel_2_share double precision,
  purchase_frequency double precision,
  mainstream_score double precision,
  basket_size double precision,
  activity_spread double precision,
  click_to_cart double precision,
  cart_to_order double precision,
  comparison double precision,
  exploration double precision,
  decision_speed double precision,
  browsing_pace double precision,
  multi_visit_research double precision,
  evening_share double precision,
  weekend_share double precision,
  match_confidence double precision,
  match_distance double precision
);
alter table public.fused_final enable row level security;
drop policy if exists "team read" on public.fused_final;
create policy "team read" on public.fused_final for select to authenticated using (true);

create table if not exists public.targets_dev (
  id bigint generated always as identity primary key,
  customer_key integer,
  t_dat date,
  channel integer,
  article_key integer,
  q integer,
  price_mean double precision
);
alter table public.targets_dev enable row level security;
drop policy if exists "team read" on public.targets_dev;
create policy "team read" on public.targets_dev for select to authenticated using (true);
create index if not exists targets_dev_customer on public.targets_dev (customer_key);

create table if not exists public.targets_final (
  id bigint generated always as identity primary key,
  customer_key integer,
  t_dat date,
  channel integer,
  article_key integer,
  q integer,
  price_mean double precision
);
alter table public.targets_final enable row level security;
drop policy if exists "team read" on public.targets_final;
create policy "team read" on public.targets_final for select to authenticated using (true);
create index if not exists targets_final_customer on public.targets_final (customer_key);

-- Private bucket for the Parquet files.
insert into storage.buckets (id, name, public) values ('atelier', 'atelier', false) on conflict (id) do nothing;
drop policy if exists "team read atelier" on storage.objects;
create policy "team read atelier" on storage.objects for select to authenticated using (bucket_id = 'atelier');
