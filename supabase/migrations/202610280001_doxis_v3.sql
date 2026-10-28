-- Additive migration. Legacy profiles/documents/RPCs are intentionally untouched.
begin;

create schema if not exists doxis_private;
revoke all on schema doxis_private from public;
grant usage on schema doxis_private to authenticated;

create table public.doxis_profiles (
  id uuid primary key references auth.users(id),
  cpf text not null unique check (cpf ~ '^[0-9]{11}$'),
  name text not null check (char_length(trim(name)) between 1 and 120),
  role text not null default 'employee' check (role in ('admin','employee')),
  active boolean not null default true,
  must_change_password boolean not null default true,
  session_not_before bigint not null default 0,
  created_at timestamptz not null default now()
);

create table public.doxis_documents (
  id uuid primary key default gen_random_uuid(),
  user_cpf text not null references public.doxis_profiles(cpf),
  name text not null check (char_length(trim(name)) between 1 and 200),
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'),
  size bigint not null check (size between 5 and 52428800),
  uploaded_by uuid not null references public.doxis_profiles(id),
  status text not null default 'ready' check (status in ('ready','deleting')),
  uploaded_at timestamptz not null default now()
);
create index doxis_documents_owner_date on public.doxis_documents(user_cpf,uploaded_at desc,id);

create table public.doxis_access_logs (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.doxis_profiles(id),
  actor_cpf text not null,
  action text not null check (action in ('session-start','session-end','view-link','download-link','upload','delete','create-employee','edit-employee','set-active','reset-password','change-password')),
  document_id uuid, -- Retain history after the document is deleted.
  target_cpf text,
  created_at timestamptz not null default now()
);
create index doxis_logs_date on public.doxis_access_logs(created_at desc);

create function doxis_private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.doxis_profiles p
    where p.id=auth.uid() and coalesce((auth.jwt()->>'iat')::bigint,0)>=p.session_not_before and p.active and not p.must_change_password and p.role='admin');
$$;
create function doxis_private.owns_cpf(target text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.doxis_profiles p
    where p.id=auth.uid() and coalesce((auth.jwt()->>'iat')::bigint,0)>=p.session_not_before and p.cpf=target and p.active and not p.must_change_password);
$$;
revoke all on function doxis_private.is_admin() from public;
revoke all on function doxis_private.owns_cpf(text) from public;
grant execute on function doxis_private.is_admin() to authenticated;
grant execute on function doxis_private.owns_cpf(text) to authenticated;

alter table public.doxis_profiles enable row level security;
alter table public.doxis_documents enable row level security;
alter table public.doxis_access_logs enable row level security;
revoke all on public.doxis_profiles,public.doxis_documents,public.doxis_access_logs from public,anon,authenticated;
grant select on public.doxis_profiles,public.doxis_documents,public.doxis_access_logs to authenticated;
grant all on public.doxis_profiles,public.doxis_documents,public.doxis_access_logs to service_role;
grant usage,select on sequence public.doxis_access_logs_id_seq to service_role;

create policy doxis_profiles_read on public.doxis_profiles for select to authenticated
using (id=auth.uid() or doxis_private.is_admin());
create policy doxis_documents_read on public.doxis_documents for select to authenticated
using (doxis_private.is_admin() or (status='ready' and doxis_private.owns_cpf(user_cpf)));
create policy doxis_logs_read on public.doxis_access_logs for select to authenticated
using (doxis_private.is_admin());
-- No client write policies: all mutations go through the authenticated Edge Function.

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('doxis-v3-documentos','doxis-v3-documentos',false,52428800,array['application/pdf']);
-- Restrictive guard also blocks legacy permissive policies from exposing v3 objects.
-- Only service-role operations in the Edge Function can sign/read/write these objects.
create policy doxis_v3_storage_guard on storage.objects as restrictive for all to public
using (bucket_id <> 'doxis-v3-documentos')
with check (bucket_id <> 'doxis-v3-documentos');

-- Record metadata + audit atomically. Caller identity is supplied only by the server.
create function public.doxis_register_document(p_actor uuid,p_cpf text,p_name text,p_path text,p_size bigint,p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor public.doxis_profiles;
begin
  select * into actor from public.doxis_profiles where id=p_actor and active and role='admin' and not must_change_password;
  if not found then raise exception 'Forbidden'; end if;
  perform 1 from public.doxis_profiles where cpf=p_cpf and role='employee' and active;
  if not found then raise exception 'Invalid recipient'; end if;
  insert into public.doxis_documents(id,user_cpf,name,storage_path,size,uploaded_by)
    values(p_id,p_cpf,p_name,p_path,p_size,p_actor);
  insert into public.doxis_access_logs(actor_id,actor_cpf,action,document_id,target_cpf)
    values(p_actor,actor.cpf,'upload',p_id,p_cpf);
end;
$$;
create function public.doxis_finalize_delete(p_actor uuid,p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor public.doxis_profiles; doc public.doxis_documents;
begin
  select * into actor from public.doxis_profiles where id=p_actor and active and role='admin' and not must_change_password;
  if not found then raise exception 'Forbidden'; end if;
  select * into doc from public.doxis_documents where id=p_id and status='deleting' for update;
  if not found then raise exception 'Document unavailable'; end if;
  insert into public.doxis_access_logs(actor_id,actor_cpf,action,document_id,target_cpf)
    values(p_actor,actor.cpf,'delete',p_id,doc.user_cpf);
  delete from public.doxis_documents where id=p_id;
end;
$$;
revoke all on function public.doxis_register_document(uuid,text,text,text,bigint,uuid) from public,anon,authenticated;
revoke all on function public.doxis_finalize_delete(uuid,uuid) from public,anon,authenticated;
grant execute on function public.doxis_register_document(uuid,text,text,text,bigint,uuid) to service_role;
grant execute on function public.doxis_finalize_delete(uuid,uuid) to service_role;
commit;
