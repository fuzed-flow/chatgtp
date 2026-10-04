-- Minimal source tables matching the reviewed production column types, without external email/webhook triggers.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
grant usage on schema auth to authenticated,anon,service_role;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('role',true),'none'))$$;
create schema cron;
create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
create table auth.users(id uuid primary key,encrypted_password text,email text);
create table auth.sessions(id uuid primary key,user_id uuid,user_agent text);
create table auth.mfa_factors(id uuid primary key,user_id uuid,status text);
create table public.attachments(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  related_type text,
  related_id uuid,
  file_url text,
  file_name text,
  caption text,
  created_at timestamp with time zone default now()
);
create table public.change_orders(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  project_id uuid,
  client_id uuid,
  title text,
  change_order_number text,
  status text,
  issue_date date,
  notes text,
  client_message text,
  terms text,
  overall_scope text,
  show_overall_scope boolean,
  hero_image_url text,
  end_photos text[],
  documents jsonb,
  subtotal numeric,
  tax numeric,
  total numeric,
  created_at timestamp with time zone default now(),
  client_selected_items_json text,
  margin numeric,
  margin_adjustment_type text,
  automation_stage integer
);
create table public.clients(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  name text,
  first_name text,
  surname text,
  email text,
  phone text,
  site_address text,
  billing_address text,
  notes text,
  type text,
  created_at timestamp with time zone default now(),
  primary_contact_name text,
  tags text[],
  portal_features jsonb
);
create table public.leads(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  contact_name text,
  pipeline_stage text,
  created_at timestamptz default now()
);
create table public.companies(
  id uuid primary key default gen_random_uuid(),
  name text,
  plan_id text,
  subscription_status text,
  stripe_customer_id text,
  created_at timestamp with time zone default now(),
  phone text,
  website text,
  timezone text,
  gst_rate numeric(5,2),
  default_quote_terms text,
  quote_number_prefix text,
  invoice_number_prefix text,
  project_number_prefix text,
  company_logo_url text,
  next_project_number integer,
  next_invoice_number integer,
  next_quote_number integer,
  next_change_order_number integer,
  change_order_prefix text,
  next_po_number integer,
  po_number_prefix text,
  stripe_account_id text,
  notification_emails text[],
  settings jsonb,
  subscription_tier text,
  stripe_charges_enabled boolean,
  qbo_realm_id text,
  qbo_connected boolean,
  logo_url text,
  doc_prefix_quote text,
  doc_prefix_invoice text,
  max_users integer
);
create table public.company_resources(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  project_id uuid,
  name text,
  file_name text,
  file_url text,
  created_at timestamp with time zone default now()
);
create table public.contractor_portal_files(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  project_id uuid,
  file_name text,
  file_url text,
  description text,
  created_at timestamp with time zone default now()
);
create table public.expenses(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  user_id uuid,
  user_email text,
  employee_name text,
  project_id uuid,
  date date,
  category text,
  amount numeric(10,2),
  description text,
  payment_method text,
  receipt_url text,
  status text,
  admin_notes text,
  created_at timestamp with time zone default now(),
  qbo_purchase_id text,
  qbo_sync_status text,
  qbo_sync_error text
);
create table public.inventory(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  name text,
  sku text,
  category text,
  sub_category text,
  tertiary_category text,
  unit text,
  material_cost numeric,
  labor_cost numeric,
  cost numeric,
  price numeric,
  supplier text,
  vendor_url text,
  description text,
  image_url text,
  taxable boolean,
  project_name text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone,
  quantity_on_hand numeric,
  reorder_point numeric,
  location text
);
create table public.inventory_transactions(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  inventory_id uuid,
  employee_name text,
  project_name text,
  quantity_changed numeric,
  transaction_type text,
  notes text,
  created_at timestamp with time zone default now()
);
create table public.invoices(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  client_id uuid,
  quote_id uuid,
  status text,
  total numeric(12,2),
  created_at timestamp with time zone default now(),
  project_id uuid,
  invoice_number text,
  issue_date date,
  due_date date,
  site_address text,
  subtotal numeric(12,2),
  tax numeric(12,2),
  amount_paid numeric(12,2),
  balance_due numeric(12,2),
  deposit_amount numeric(12,2),
  has_payment_schedule boolean,
  notes text,
  billing_address text,
  due_terms text,
  show_notes boolean,
  internal_notes text,
  discount_amount numeric(12,2),
  discount_type text,
  change_order_id uuid,
  last_reminder_sent_at timestamp with time zone,
  automation_stage integer
);
create table public.messages(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  client_id uuid,
  sender_type text,
  sender_name text,
  subject text,
  message_body text,
  is_read boolean default false,
  created_at timestamp with time zone default now()
);
create table public.notes(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  related_type text,
  related_id uuid,
  content text,
  category text,
  author_name text,
  created_at timestamp with time zone default now(),
  is_pinned boolean
);

create table public.notifications(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  type text,
  status text default 'unread',
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  user_id uuid,
  action_url text,
  title text,
  body text,
  is_read boolean default false,
  related_type text,
  related_id uuid,
  severity text,
  category text
);
create table public.payments(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  invoice_id uuid,
  schedule_item_id uuid,
  amount numeric(12,2),
  payment_method text,
  notes text,
  created_at timestamp with time zone default now(),
  payment_date date
);
create table public.profiles(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  full_name text,
  role text,
  created_at timestamp with time zone default now(),
  permissions jsonb default '[]'::jsonb,
  hourly_rate numeric,
  qbo_employee_id text,
  qbo_vendor_id text,
  dashboard_layout jsonb,
  onboarding_completed boolean,
  is_active boolean default true,
  phone text,
  email text,
  notify_action_required_only boolean
);
create table public.project_daily_logs(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  project_id uuid,
  user_id uuid,
  date date,
  weather text,
  crew_on_site text,
  summary text,
  blockers text,
  safety_concerns text,
  materials_used text,
  next_steps text,
  photos jsonb,
  created_at timestamp with time zone default now(),
  lead_id uuid,
  category text,
  client_id uuid
);
create table public.project_documents(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  project_id uuid,
  file_name text,
  file_url text,
  doc_type text,
  vendor_name text,
  amount numeric,
  notes text,
  created_at timestamp with time zone default now()
);
create table public.project_issues(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  project_id uuid,
  title text,
  description text,
  severity text,
  status text,
  created_at timestamp with time zone default now(),
  client_visible boolean,
  phase_id uuid,
  owner_name text
);
create table public.project_materials(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  project_id uuid,
  phase_id uuid,
  custom_material_name text,
  quantity numeric,
  unit text,
  cost_estimated numeric,
  cost_actual numeric,
  status text,
  needed_by_date date,
  created_at timestamp with time zone default now(),
  order_by_date date,
  supplier text,
  notes text
);
create table public.project_milestones(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  project_id uuid,
  title text,
  description text,
  due_date_target date,
  status text,
  created_at timestamp with time zone default now(),
  client_visible boolean
);
create table public.project_permits(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  project_id uuid,
  permit_type text,
  permit_number text,
  issued_by text,
  issue_date date,
  expiry_date date,
  status text,
  description text,
  notes text,
  file_url text,
  file_name text,
  created_at timestamp with time zone default now()
);
create table public.project_staff(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  project_id uuid,
  user_id uuid,
  role text,
  start_date date,
  end_date date,
  allocation_percent integer,
  notes text,
  is_active boolean default true,
  created_at timestamp with time zone default now()
);
create table public.project_subcontractors(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  project_id uuid,
  phase_id uuid,
  subcontractor_id uuid,
  status text,
  scheduled_start date,
  scheduled_end date,
  created_at timestamp with time zone default now(),
  agreed_amount numeric,
  role_notes text
);
create table public.project_tasks(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  project_id uuid,
  phase_id uuid,
  title text,
  description text,
  status text,
  due_date_target date,
  assigned_to uuid[],
  created_at timestamp with time zone default now(),
  priority text,
  client_id uuid,
  estimated_hours numeric
);
create table public.project_timeline_events(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  project_id uuid,
  title text,
  details text,
  category text,
  event_date date,
  client_visible boolean,
  created_at timestamp with time zone default now()
);
create table public.projects(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  client_id uuid,
  name text,
  status text,
  created_at timestamp with time zone default now(),
  quote_id uuid,
  project_number text,
  budget_revenue numeric,
  budget_cost numeric,
  target_end_date date,
  site_address text,
  start_date date,
  budget numeric,
  notes text,
  description text,
  invoice_id uuid
);
create table public.purchase_orders(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  vendor_id uuid,
  project_id uuid,
  po_number text,
  status text,
  order_date date,
  expected_delivery_date date,
  actual_delivery_date date,
  shipping_address text,
  notes text,
  terms text,
  subtotal numeric,
  tax numeric,
  total numeric,
  vendor_quote_attachment text,
  created_at timestamp with time zone default now()
);
create table public.quotes(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  client_id uuid,
  quote_number text,
  title text,
  status text,
  total numeric(12,2),
  margin numeric(12,2),
  overall_scope text,
  pdf_customization_settings jsonb,
  client_selected_items jsonb,
  is_template boolean,
  created_at timestamp with time zone default now(),
  client_message text,
  notes text,
  terms text,
  deposit_amount numeric,
  discount_amount numeric,
  discount_type text,
  discount_percentage numeric,
  show_discount_amount boolean,
  has_payment_schedule boolean,
  hero_image_url text,
  end_photos text[],
  documents jsonb,
  margin_adjustment_type text,
  subtotal numeric,
  tax numeric,
  site_address text,
  pdf_customization_settings_json text,
  show_overall_scope boolean,
  issue_date date,
  expiry_date date,
  client_selected_items_json text,
  lead_id uuid,
  automation_stage integer,
  client_goals_notes text,
  client_signature text,
  cover_page_subtitle text,
  cover_page_title text,
  sent_at date,
  signed_at text,
  signed_by text,
  viewed_at date,
  is_archived boolean,
  updated_at timestamp with time zone,
  user_id uuid
);
create table public.resource_allocations(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  project_id uuid,
  task_id uuid,
  user_id uuid,
  allocation_percentage numeric,
  start_date date,
  end_date date,
  created_at timestamp with time zone default now()
);
create table public.schedule_jobs(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  project_id uuid,
  title text,
  start_date_time timestamp with time zone,
  end_date_time timestamp with time zone,
  address text,
  status text,
  created_at timestamp with time zone default now()
);
create table public.subcontractors(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  company_name text,
  trade text,
  contact_name text,
  phone text,
  email text,
  created_at timestamp with time zone default now(),
  wcb_policy text,
  insurance_expiry date,
  notes text,
  is_active boolean default true
);
create table public.tasks(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  title text,
  status text,
  due_date timestamp with time zone,
  created_at timestamp with time zone default now(),
  client_id uuid,
  project_id uuid,
  lead_id uuid,
  vendor_id uuid,
  assigned_to text,
  task_type text,
  priority text,
  description text,
  estimated_hours numeric(5,2)
);
create table public.team_invites(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  email text,
  role text,
  created_at timestamp with time zone default now(),
  full_name text,
  hourly_rate numeric,
  is_pending boolean
);
create table public.time_entries(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  project_id uuid,
  employee_name text,
  date date,
  total_hours numeric(5,2),
  clock_in timestamp with time zone,
  clock_out timestamp with time zone,
  entry_type text,
  status text,
  approved_by text,
  notes text,
  created_at timestamp with time zone default now(),
  qbo_time_activity_id text,
  qbo_sync_status text,
  qbo_sync_error text
);
create table public.vendor_requests(
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  vendor_id uuid,
  project_id uuid,
  lead_id uuid,
  client_id uuid,
  created_by uuid,
  title text,
  scope_of_work text,
  priority text,
  due_date date,
  status text,
  attachments jsonb,
  created_at timestamp with time zone default now()
);



create function public.get_auth_company_id() returns uuid language sql stable security definer as $$select company_id from public.profiles where id=auth.uid()$$;
grant select on all tables in schema public to authenticated;
alter table public.project_staff enable row level security;
create policy legacy_staff_access on public.project_staff for all to public using(true) with check(true);
