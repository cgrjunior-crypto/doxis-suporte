-- LOCAL/DISPOSABLE SUPABASE ONLY. Requires the v3 migration. All fixtures roll back.
begin;
insert into auth.users(id,email) values
('11111111-1111-4111-8111-111111111111','52998224725@cpf.doxis.invalid'),
('22222222-2222-4222-8222-222222222222','11144477735@cpf.doxis.invalid'),
('33333333-3333-4333-8333-333333333333','12345678909@cpf.doxis.invalid');
insert into public.doxis_profiles(id,cpf,name,role,must_change_password) values
('11111111-1111-4111-8111-111111111111','52998224725','Admin','admin',false),
('22222222-2222-4222-8222-222222222222','11144477735','A','employee',false),
('33333333-3333-4333-8333-333333333333','12345678909','B','employee',false);
insert into public.doxis_documents(id,user_cpf,name,storage_path,size,uploaded_by) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11144477735','PDF A','22222222-2222-4222-8222-222222222222/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',20,'11111111-1111-4111-8111-111111111111'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','12345678909','PDF B','33333333-3333-4333-8333-333333333333/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf',20,'11111111-1111-4111-8111-111111111111');

-- Simulate a legacy wide-open policy and prove the restrictive guard still wins.
create policy doxis_test_legacy_open on storage.objects for select to authenticated using(true);
insert into storage.objects(bucket_id,name) values('doxis-v3-documentos','test-policy-guard.pdf');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","iat":2000000000}',true);
do $$begin
  if (select count(*) from public.doxis_documents)<>1 then raise exception 'Employee must see only one document'; end if;
  if exists(select 1 from public.doxis_documents where user_cpf='12345678909') then raise exception 'Cross-owner disclosure'; end if;
  if (select count(*) from public.doxis_profiles)<>1 then raise exception 'Cross-profile disclosure'; end if;
  if exists(select 1 from storage.objects where bucket_id='doxis-v3-documentos') then raise exception 'Legacy policy bypasses guard'; end if;
  if has_table_privilege('authenticated','public.doxis_profiles','UPDATE') then raise exception 'Client profile writes allowed'; end if;
  if has_function_privilege('authenticated','public.doxis_finalize_delete(uuid,uuid)','EXECUTE') then raise exception 'Client can finalize deletion'; end if;
end$$;
reset role;
update public.doxis_profiles set active=false where cpf='11144477735';
set local role authenticated;
do $$begin
  if exists(select 1 from public.doxis_documents) then raise exception 'Inactive employee sees documents'; end if;
end$$;
reset role;
update public.doxis_profiles set active=true,must_change_password=true where cpf='11144477735';
set local role authenticated;
do $$begin
  if exists(select 1 from public.doxis_documents) then raise exception 'First access sees documents'; end if;
end$$;
reset role;
update public.doxis_profiles set must_change_password=false,session_not_before=2000000001 where cpf='11144477735';
set local role authenticated;
do $$begin
  if exists(select 1 from public.doxis_documents) then raise exception 'Old JWT sees documents after reset'; end if;
end$$;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","iat":2000000000}',true);
do $$begin
  if (select count(*) from public.doxis_documents)<>2 then raise exception 'Admin cannot see all documents'; end if;
end$$;
reset role;
do $$begin
  if has_table_privilege('anon','public.doxis_documents','SELECT') then raise exception 'Anonymous document access allowed'; end if;
end$$;
rollback;
