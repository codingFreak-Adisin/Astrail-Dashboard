create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  plan text default 'free',
  created_at timestamptz default now()
);

create table if not exists public.mcp_servers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  description text,
  source_url text,
  source_type text,
  generated_code text,
  tools_json jsonb default '[]'::jsonb,
  endpoint_map jsonb default '[]'::jsonb,
  diagnostics jsonb default '{}'::jsonb,
  status text default 'pending',
  validation_status text default 'pending',
  generation_status text default 'pending',
  is_public boolean default false,
  hosted_endpoint text,
  call_count int default 0,
  generation_version int default 1,
  protocol_version text default '2024-11-05',
  created_at timestamptz default now()
);

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  key_hash text unique not null,
  key_preview text not null,
  last_used timestamptz,
  created_at timestamptz default now()
);

alter table if exists public.mcp_servers add column if not exists hosted_endpoint text;
alter table if exists public.mcp_servers add column if not exists call_count int default 0;
alter table if exists public.mcp_servers add column if not exists endpoint_map jsonb default '[]'::jsonb;
alter table if exists public.mcp_servers add column if not exists diagnostics jsonb default '{}'::jsonb;
alter table if exists public.mcp_servers add column if not exists status text default 'pending';
alter table if exists public.mcp_servers add column if not exists validation_status text default 'pending';
alter table if exists public.mcp_servers add column if not exists generation_status text default 'pending';
alter table if exists public.mcp_servers add column if not exists generation_version int default 1;
alter table if exists public.mcp_servers add column if not exists protocol_version text default '2024-11-05';
alter table public.mcp_servers alter column tools_json set default '[]'::jsonb;
alter table if exists public.mcp_servers alter column endpoint_map set default '[]'::jsonb;
alter table if exists public.mcp_servers alter column diagnostics set default '{}'::jsonb;
alter table if exists public.mcp_servers alter column status set default 'pending';
alter table if exists public.mcp_servers alter column validation_status set default 'pending';
alter table if exists public.mcp_servers alter column generation_status set default 'pending';
alter table if exists public.mcp_servers alter column protocol_version set default '2024-11-05';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mcp_servers'
      and column_name = 'generation_version'
      and data_type <> 'integer'
  ) then
    alter table public.mcp_servers
      alter column generation_version drop default,
      alter column generation_version type int using (
        case
          when generation_version::text ~ '^[0-9]+$' then generation_version::text::int
          else 1
        end
      ),
      alter column generation_version set default 1;
  end if;
end $$;

create table if not exists public.tool_call_logs (
  id uuid primary key default gen_random_uuid(),
  server_id uuid references public.mcp_servers(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  tool_name text,
  status text,
  method text,
  path text,
  execution_mode text,
  upstream_status int,
  trace_id text,
  attempt_count int,
  error_code text,
  error text,
  latency_ms int,
  created_at timestamptz default now()
);

alter table if exists public.tool_call_logs add column if not exists method text;
alter table if exists public.tool_call_logs add column if not exists path text;
alter table if exists public.tool_call_logs add column if not exists execution_mode text;
alter table if exists public.tool_call_logs add column if not exists upstream_status int;
alter table if exists public.tool_call_logs add column if not exists trace_id text;
alter table if exists public.tool_call_logs add column if not exists attempt_count int;
alter table if exists public.tool_call_logs add column if not exists error_code text;
alter table if exists public.tool_call_logs add column if not exists error text;

create table if not exists public.api_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  server_id uuid references public.mcp_servers(id) on delete cascade,
  name text not null,
  provider text,
  auth_scheme text not null,
  client_id text,
  client_secret_ciphertext text,
  injection_name text,
  scopes jsonb default '[]'::jsonb,
  secret_ciphertext text not null,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_url text,
  expires_at timestamptz,
  key_preview text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table if exists public.api_credentials add column if not exists server_id uuid references public.mcp_servers(id) on delete cascade;
alter table if exists public.api_credentials add column if not exists provider text;
alter table if exists public.api_credentials add column if not exists client_id text;
alter table if exists public.api_credentials add column if not exists client_secret_ciphertext text;
alter table if exists public.api_credentials add column if not exists injection_name text;
alter table if exists public.api_credentials add column if not exists scopes jsonb default '[]'::jsonb;
alter table if exists public.api_credentials add column if not exists access_token_ciphertext text;
alter table if exists public.api_credentials add column if not exists refresh_token_ciphertext text;
alter table if exists public.api_credentials add column if not exists token_url text;
alter table if exists public.api_credentials add column if not exists expires_at timestamptz;

create table if not exists public.mcp_bundles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  hosted_endpoint text,
  is_public boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.mcp_bundle_servers (
  bundle_id uuid references public.mcp_bundles(id) on delete cascade,
  server_id uuid references public.mcp_servers(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (bundle_id, server_id)
);

create index if not exists idx_tool_call_logs_server_created_at
  on public.tool_call_logs (server_id, created_at desc);
create index if not exists idx_tool_call_logs_user_created_at
  on public.tool_call_logs (user_id, created_at desc);
create index if not exists idx_tool_call_logs_trace_id
  on public.tool_call_logs (trace_id);
create index if not exists idx_api_credentials_user_server
  on public.api_credentials (user_id, server_id);
create index if not exists idx_mcp_bundles_user_created_at
  on public.mcp_bundles (user_id, created_at desc);
create index if not exists idx_mcp_bundle_servers_server
  on public.mcp_bundle_servers (server_id);

alter table public.profiles enable row level security;
alter table public.mcp_servers enable row level security;
alter table public.api_keys enable row level security;
alter table public.tool_call_logs enable row level security;
alter table public.mcp_bundles enable row level security;
alter table public.mcp_bundle_servers enable row level security;
alter table public.api_credentials enable row level security;

drop policy if exists "profiles are owned by users" on public.profiles;
drop policy if exists "servers are owned by users" on public.mcp_servers;
drop policy if exists "public servers are readable" on public.mcp_servers;
drop policy if exists "api keys are owned by users" on public.api_keys;
drop policy if exists "tool call logs are owned by users" on public.tool_call_logs;
drop policy if exists "bundles are owned by users" on public.mcp_bundles;
drop policy if exists "bundle servers follow bundle ownership" on public.mcp_bundle_servers;
drop policy if exists "credentials are owned by users" on public.api_credentials;

create policy "profiles are owned by users"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "servers are owned by users"
  on public.mcp_servers for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "public servers are readable"
  on public.mcp_servers for select
  using (is_public = true or auth.uid() = user_id);

create policy "api keys are owned by users"
  on public.api_keys for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "tool call logs are owned by users"
  on public.tool_call_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "bundles are owned by users"
  on public.mcp_bundles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "bundle servers follow bundle ownership"
  on public.mcp_bundle_servers for all
  using (
    exists (
      select 1 from public.mcp_bundles
      where public.mcp_bundles.id = public.mcp_bundle_servers.bundle_id
      and public.mcp_bundles.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.mcp_bundles
      where public.mcp_bundles.id = public.mcp_bundle_servers.bundle_id
      and public.mcp_bundles.user_id = auth.uid()
    )
  );

create policy "credentials are owned by users"
  on public.api_credentials for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  dodo_event_id text unique not null,
  event_type text not null default 'unknown',
  user_id uuid references public.profiles(id) on delete set null,
  event_created_at timestamptz,
  processing_result text not null default 'received',
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  dodo_customer_id text,
  dodo_subscription_id text,
  dodo_payment_id text,
  plan text not null,
  status text not null default 'unknown',
  entitlement_status text not null default 'inactive',
  paid_confirmed_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  last_payment_status text,
  last_payment_at timestamptz,
  dodo_last_event_id text,
  dodo_last_event_type text,
  dodo_last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.billing_payment_events (
  id uuid primary key default gen_random_uuid(),
  dodo_event_id text unique not null,
  dodo_payment_id text,
  user_id uuid references public.profiles(id) on delete set null,
  dodo_customer_id text,
  dodo_subscription_id text,
  plan text,
  status text not null default 'unknown',
  amount numeric,
  currency text,
  event_created_at timestamptz,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

create table if not exists public.billing_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  server_id uuid references public.mcp_servers(id) on delete set null,
  tool_name text,
  usage_type text not null default 'tool_call',
  quantity integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists billing_webhook_events_event_type_idx
  on public.billing_webhook_events (event_type);
create index if not exists billing_subscriptions_user_id_idx
  on public.billing_subscriptions (user_id);
create index if not exists billing_subscriptions_entitlement_idx
  on public.billing_subscriptions (user_id, entitlement_status, paid_confirmed_at);
create index if not exists billing_payment_events_user_created_at_idx
  on public.billing_payment_events (user_id, event_created_at desc);
create index if not exists billing_payment_events_payment_id_idx
  on public.billing_payment_events (dodo_payment_id);
create index if not exists billing_usage_user_id_created_at_idx
  on public.billing_usage (user_id, created_at desc);
create index if not exists tool_call_logs_user_id_created_at_idx
  on public.tool_call_logs (user_id, created_at desc);

alter table if exists public.billing_webhook_events enable row level security;
alter table if exists public.billing_subscriptions enable row level security;
alter table if exists public.billing_payment_events enable row level security;
alter table if exists public.billing_usage enable row level security;

alter table if exists public.billing_webhook_events add column if not exists user_id uuid references public.profiles(id) on delete set null;
alter table if exists public.billing_webhook_events add column if not exists event_created_at timestamptz;
alter table if exists public.billing_webhook_events add column if not exists processing_result text not null default 'received';

alter table if exists public.billing_subscriptions add column if not exists entitlement_status text not null default 'inactive';
alter table if exists public.billing_subscriptions add column if not exists paid_confirmed_at timestamptz;
alter table if exists public.billing_subscriptions add column if not exists last_payment_status text;
alter table if exists public.billing_subscriptions add column if not exists last_payment_at timestamptz;
alter table if exists public.billing_subscriptions add column if not exists dodo_last_event_id text;
alter table if exists public.billing_subscriptions add column if not exists dodo_last_event_type text;
alter table if exists public.billing_subscriptions add column if not exists dodo_last_event_at timestamptz;

drop policy if exists "Users can read own subscriptions" on public.billing_subscriptions;
create policy "Users can read own subscriptions"
  on public.billing_subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists "Users can read own billing payment events" on public.billing_payment_events;
create policy "Users can read own billing payment events"
  on public.billing_payment_events for select
  using (auth.uid() = user_id);

drop policy if exists "Users can read own billing usage" on public.billing_usage;
create policy "Users can read own billing usage"
  on public.billing_usage for select
  using (auth.uid() = user_id);

create table if not exists public.design_partner_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  company text not null,
  role text,
  persona text default 'developer' check (persona in ('buyer', 'developer', 'workflow_owner')),
  agent_kind text not null,
  workflow_goal text,
  needed_api text not null,
  systems_involved text,
  has_api_docs text not null check (has_api_docs in ('yes', 'no')),
  api_docs_url_or_notes text,
  approval_steps text,
  auth_constraints text,
  runtime_preference text not null check (runtime_preference in ('hosted', 'exported_code', 'self_hosted')),
  urgency text not null check (urgency in ('today', 'this_week', 'exploring')),
  status text not null default 'new' check (status in ('new', 'contacted', 'mapped', 'generated', 'tested', 'onboarded', 'success')),
  created_at timestamptz default now()
);

alter table if exists public.design_partner_requests add column if not exists role text;
alter table if exists public.design_partner_requests add column if not exists persona text default 'developer';
alter table if exists public.design_partner_requests add column if not exists workflow_goal text;
alter table if exists public.design_partner_requests add column if not exists systems_involved text;
alter table if exists public.design_partner_requests add column if not exists api_docs_url_or_notes text;
alter table if exists public.design_partner_requests add column if not exists approval_steps text;
alter table if exists public.design_partner_requests add column if not exists auth_constraints text;
alter table if exists public.design_partner_requests add column if not exists status text not null default 'new';

create index if not exists idx_design_partner_requests_created_at
  on public.design_partner_requests (created_at desc);
create index if not exists idx_design_partner_requests_urgency
  on public.design_partner_requests (urgency, created_at desc);
create index if not exists idx_design_partner_requests_preference
  on public.design_partner_requests (runtime_preference, created_at desc);
create index if not exists idx_design_partner_requests_persona
  on public.design_partner_requests (persona, created_at desc);

alter table if exists public.design_partner_requests enable row level security;

drop policy if exists "public can create design partner requests" on public.design_partner_requests;
drop policy if exists "authenticated users can read design partner requests" on public.design_partner_requests;

create policy "public can create design partner requests"
  on public.design_partner_requests for insert
  with check (true);

create policy "authenticated users can read design partner requests"
  on public.design_partner_requests for select
  using (auth.role() = 'authenticated');
