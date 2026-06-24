create table if not exists public.concert_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  keywords text[] not null default '{}',
  excluded_keywords text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.taxi_pots (
  id uuid primary key default gen_random_uuid(),
  seed_key text,
  category_id uuid not null references public.concert_categories(id),
  concert_title text not null,
  origin text not null,
  destination text not null,
  date date not null,
  time time not null,
  open_chat_url text not null,
  created_at timestamptz not null default now()
);

alter table public.concert_categories enable row level security;
alter table public.taxi_pots enable row level security;

alter table public.taxi_pots
  add column if not exists seed_key text;

create unique index if not exists taxi_pots_seed_key_unique
  on public.taxi_pots (seed_key)
  where seed_key is not null;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'concert_categories'
      and policyname = 'Anyone can read concert categories'
  ) then
    create policy "Anyone can read concert categories"
      on public.concert_categories
      for select
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'concert_categories'
      and policyname = 'Anyone can seed concert categories'
  ) then
    create policy "Anyone can seed concert categories"
      on public.concert_categories
      for insert
      with check (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'taxi_pots'
      and policyname = 'Anyone can read taxi pots'
  ) then
    create policy "Anyone can read taxi pots"
      on public.taxi_pots
      for select
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'taxi_pots'
      and policyname = 'Anyone can create taxi pots'
  ) then
    create policy "Anyone can create taxi pots"
      on public.taxi_pots
      for insert
      with check (true);
  end if;
end $$;

insert into public.concert_categories (slug, title, sort_order, keywords, excluded_keywords)
values
  (
    'xdinary-heroes-xcape',
    'Xdinary Heroes 2026 Summer Special <The Xcape>',
    1,
    array['xdinary', 'heroes', 'xcape'],
    array[]::text[]
  ),
  (
    'babymonster-choom',
    '2026-27 BABYMONSTER WORLD TOUR [춤 (CHOOM)] IN SEOUL',
    2,
    array['babymonster', 'choom'],
    array[]::text[]
  ),
  (
    'andteam-blaze',
    '2026 &TEAM CONCERT TOUR ''BLAZE THE WAY'' in INCHEON',
    3,
    array['&team', 'andteam', 'blaze'],
    array[]::text[]
  ),
  (
    'tws-247',
    '2026 TWS TOUR ''24/7:FOR:YOU'' IN SEOUL',
    4,
    array['tws', '24/7:for:you'],
    array[]::text[]
  ),
  (
    'other',
    '기타',
    999,
    array[]::text[],
    array[]::text[]
  )
on conflict (slug) do nothing;

insert into public.taxi_pots (
  seed_key,
  category_id,
  concert_title,
  origin,
  destination,
  date,
  time,
  open_chat_url
)
select
  seed_taxi_pots.seed_key,
  concert_categories.id,
  seed_taxi_pots.concert_title,
  seed_taxi_pots.origin,
  seed_taxi_pots.destination,
  seed_taxi_pots.date::date,
  seed_taxi_pots.time::time,
  seed_taxi_pots.open_chat_url
from (
  values
    (
      'taxi-pot-1',
      'xdinary-heroes-xcape',
      'Xdinary Heroes 2026 Summer Special <The Xcape>',
      '운서역',
      '인스파이어 아레나',
      '2026-06-27',
      '14:00',
      'https://open.kakao.com/'
    ),
    (
      'taxi-pot-2',
      'xdinary-heroes-xcape',
      'Xdinary Heroes 2026 Summer Special <The Xcape>',
      '인천국제공항T1',
      '인스파이어 아레나',
      '2026-06-27',
      '14:30',
      'https://open.kakao.com/'
    ),
    (
      'taxi-pot-3',
      'xdinary-heroes-xcape',
      'Xdinary Heroes 2026 Summer Special <The Xcape>',
      '인스파이어 아레나',
      '서울역',
      '2026-06-27',
      '21:30',
      'https://open.kakao.com/'
    )
) as seed_taxi_pots (
  seed_key,
  category_slug,
  concert_title,
  origin,
  destination,
  date,
  time,
  open_chat_url
)
join public.concert_categories
  on concert_categories.slug = seed_taxi_pots.category_slug
where not exists (
  select 1
  from public.taxi_pots
  where taxi_pots.seed_key = seed_taxi_pots.seed_key
);
