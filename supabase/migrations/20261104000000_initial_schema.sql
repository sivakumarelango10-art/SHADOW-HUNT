-- Shadow Hunt — initial schema
-- The game server writes with the service-role key (bypasses RLS). Browsers only
-- ever talk to the game server's HTTP API, so client-facing policies are read-only
-- and limited to a player's own rows.

create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Profiles: one per player. `id` is the Supabase auth user id for accounts, or a
-- server-issued UUID for guests (guests are not in auth.users, so no FK).
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key,
  username       citext not null,
  avatar         text   not null default 'moth',
  is_guest       boolean not null default true,
  xp             integer not null default 0 check (xp >= 0),
  level          integer not null default 1 check (level between 1 and 50),
  title          text   not null default 'fresh_meat',
  stats          jsonb  not null default '{}'::jsonb,
  achievements   text[] not null default '{}',
  equipped_skins jsonb  not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9_]{3,16}$')
);
create unique index if not exists profiles_username_key on public.profiles (username);
create index if not exists profiles_level_idx on public.profiles (level desc, xp desc);

-- ---------------------------------------------------------------------------
-- Matches and per-player results (written once by the server at match end).
-- ---------------------------------------------------------------------------
create table if not exists public.matches (
  id                   uuid primary key,
  map_id               text not null check (map_id in ('blackwood', 'asylum')),
  winner               text not null check (winner in ('survivors', 'hunter')),
  duration_seconds     integer not null check (duration_seconds >= 0),
  survivors_total      integer not null,
  survivors_escaped    integer not null,
  generators_completed integer not null,
  results              jsonb not null,
  created_at           timestamptz not null default now()
);
create index if not exists matches_created_idx on public.matches (created_at desc);

create table if not exists public.match_players (
  match_id     uuid not null references public.matches (id) on delete cascade,
  player_id    uuid not null references public.profiles (id) on delete cascade,
  role         text not null check (role in ('survivor', 'hunter')),
  character_id text not null,
  outcome      text not null,
  won          boolean not null,
  xp_gained    integer not null default 0,
  stats        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  primary key (match_id, player_id)
);
create index if not exists match_players_player_idx on public.match_players (player_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Friends (one-directional follow list).
-- ---------------------------------------------------------------------------
create table if not exists public.friendships (
  player_id  uuid not null references public.profiles (id) on delete cascade,
  friend_id  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (player_id, friend_id),
  constraint no_self_friend check (player_id <> friend_id)
);

-- ---------------------------------------------------------------------------
-- Row level security: deny by default; players may read their own data.
-- No insert/update/delete policies exist, so only the service role can write.
-- ---------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.matches       enable row level security;
alter table public.match_players enable row level security;
alter table public.friendships   enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists "read own match rows" on public.match_players;
create policy "read own match rows" on public.match_players
  for select to authenticated using (auth.uid() = player_id);

drop policy if exists "read matches you played" on public.matches;
create policy "read matches you played" on public.matches
  for select to authenticated using (
    exists (select 1 from public.match_players mp where mp.match_id = id and mp.player_id = auth.uid())
  );

drop policy if exists "read own friends" on public.friendships;
create policy "read own friends" on public.friendships
  for select to authenticated using (auth.uid() = player_id);

-- Keep updated_at fresh.
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

revoke all on all tables in schema public from anon;
