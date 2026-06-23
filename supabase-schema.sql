create table if not exists public.taxi_pots (
  id text primary key,
  concert_id text not null,
  concert_title text not null,
  origin text not null,
  destination text not null,
  date date not null,
  time time not null,
  open_chat_url text not null,
  created_at timestamptz not null default now()
);

alter table public.taxi_pots enable row level security;

create policy "Anyone can read taxi pots"
  on public.taxi_pots
  for select
  using (true);

create policy "Anyone can create taxi pots"
  on public.taxi_pots
  for insert
  with check (true);
