-- Shopper-model outputs: one homepage document per cohort shopper (final cutoff) and the articles its tiles reference.
-- Paste into the SQL Editor and run once, then: python -m model publish
-- Same access rule as the dataset tables: signed-in users read, only the service role writes.

create table if not exists public.homepages_final (
  customer_key integer not null primary key,
  stratum text,
  homepage jsonb not null
);
alter table public.homepages_final enable row level security;
drop policy if exists "team read" on public.homepages_final;
create policy "team read" on public.homepages_final for select to authenticated using (true);

create table if not exists public.homepage_articles (
  article_id text not null primary key,
  name text,
  category text,
  department text,
  color text,
  price_scaled double precision
);
alter table public.homepage_articles enable row level security;
drop policy if exists "team read" on public.homepage_articles;
create policy "team read" on public.homepage_articles for select to authenticated using (true);
