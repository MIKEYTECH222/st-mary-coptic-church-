
-- =========================================================
-- شبابنا: الرحلات والخروجات + الأسئلة المقالية ومراجعتها
-- شغّل هذا الملف مرة واحدة من Supabase SQL Editor.
-- =========================================================

-- -------------------------
-- 1) الرحلات والخروجات
-- -------------------------
alter table public.events
  add column if not exists cover_image_url text,
  add column if not exists gallery_urls jsonb not null default '[]'::jsonb,
  add column if not exists payment_url text;

alter table public.events enable row level security;

drop policy if exists "shababna trips read approved" on public.events;
create policy "shababna trips read approved"
on public.events for select to authenticated
using (public.is_approved_member() or public.is_admin());

drop policy if exists "shababna trips staff insert" on public.events;
create policy "shababna trips staff insert"
on public.events for insert to authenticated
with check (
  public.is_admin()
  or (
    public.is_approved_member()
    and public.current_role() = 'servant'
    and group_id is not null
    and exists (
      select 1
      from public.servant_group_assignments s
      where s.servant_id = auth.uid()
        and s.group_id = events.group_id
    )
  )
);

drop policy if exists "shababna trips staff update" on public.events;
create policy "shababna trips staff update"
on public.events for update to authenticated
using (
  public.is_admin()
  or (
    public.is_approved_member()
    and public.current_role() = 'servant'
    and group_id is not null
    and exists (
      select 1
      from public.servant_group_assignments s
      where s.servant_id = auth.uid()
        and s.group_id = events.group_id
    )
  )
)
with check (
  public.is_admin()
  or (
    public.is_approved_member()
    and public.current_role() = 'servant'
    and group_id is not null
    and exists (
      select 1
      from public.servant_group_assignments s
      where s.servant_id = auth.uid()
        and s.group_id = events.group_id
    )
  )
);

-- صور الرحلات: bucket عام للعرض، والرفع/التعديل للخادم أو الأدمن فقط.
insert into storage.buckets (id, name, public)
values ('trip-media', 'trip-media', true)
on conflict (id) do update set public = true;

drop policy if exists "shababna trip media public read" on storage.objects;
create policy "shababna trip media public read"
on storage.objects for select to public
using (bucket_id = 'trip-media');

drop policy if exists "shababna trip media staff upload" on storage.objects;
create policy "shababna trip media staff upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'trip-media'
  and public.is_approved_member()
  and (public.is_admin() or public.current_role() = 'servant')
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "shababna trip media staff update" on storage.objects;
create policy "shababna trip media staff update"
on storage.objects for update to authenticated
using (
  bucket_id = 'trip-media'
  and public.is_approved_member()
  and (public.is_admin() or public.current_role() = 'servant')
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'trip-media'
  and public.is_approved_member()
  and (public.is_admin() or public.current_role() = 'servant')
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "shababna trip media staff delete" on storage.objects;
create policy "shababna trip media staff delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'trip-media'
  and public.is_approved_member()
  and (public.is_admin() or public.current_role() = 'servant')
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- -------------------------
-- 2) تجهيز أسئلة الاختيار والمقالي
-- -------------------------
alter table public.quizzes
  add column if not exists description text,
  add column if not exists group_id uuid,
  add column if not exists points_reward integer not null default 0,
  add column if not exists is_published boolean not null default false;

-- لو قاعدة البيانات القديمة كانت تستخدم published، ننقل قيمته تلقائيًا عند وجوده.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='quizzes' and column_name='published'
  ) then
    execute 'update public.quizzes set is_published = published where published is not null';
  end if;
end $$;

alter table public.quiz_questions
  add column if not exists question_type text not null default 'mcq',
  add column if not exists max_points integer not null default 1;

-- الإجابة النموذجية في جدول منفصل لا يستطيع الطالب قراءته مباشرة.
create table if not exists public.quiz_essay_answer_keys (
  question_id uuid primary key references public.quiz_questions(id) on delete cascade,
  expected_answer text not null
);
alter table public.quiz_essay_answer_keys enable row level security;
revoke all on public.quiz_essay_answer_keys from anon, authenticated;

alter table public.quiz_attempts
  add column if not exists max_score integer not null default 0,
  add column if not exists points_awarded integer not null default 0,
  add column if not exists essay_review_status text not null default 'not_required',
  add column if not exists essay_suggestions jsonb not null default '{}'::jsonb,
  add column if not exists essay_reviewed_by uuid,
  add column if not exists essay_reviewed_at timestamptz;

-- -------------------------
-- 3) إنشاء امتحان بأسئلته من صفحة الخادم/الأدمن
-- -------------------------
create or replace function public.create_quiz_with_questions(
  p_title text,
  p_description text,
  p_group_id uuid,
  p_points_reward integer,
  p_is_published boolean,
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_role();
  v_quiz_id uuid := gen_random_uuid();
  v_item jsonb;
  v_question_id uuid;
  v_type text;
  v_options jsonb;
  v_correct integer;
  v_position integer := 0;
  v_max_points integer;
  v_question_text text;
  v_expected text;
begin
  if v_uid is null or not public.is_approved_member()
     or not (public.is_admin() or v_role = 'servant') then
    raise exception 'غير مصرح بإنشاء امتحان';
  end if;

  if nullif(trim(coalesce(p_title,'')), '') is null then
    raise exception 'اكتب اسم الامتحان';
  end if;

  if coalesce(jsonb_typeof(p_questions),'') <> 'array'
     or jsonb_array_length(p_questions) = 0 then
    raise exception 'أضف سؤالًا واحدًا على الأقل';
  end if;

  if not public.is_admin() then
    if p_group_id is null or not exists (
      select 1 from public.servant_group_assignments s
      where s.servant_id = v_uid and s.group_id = p_group_id
    ) then
      raise exception 'يمكنك إنشاء امتحان لمجموعة مسندة إليك فقط';
    end if;
  end if;

  insert into public.quizzes
    (id, title, description, group_id, points_reward, is_published, created_at)
  values
    (v_quiz_id, trim(p_title), coalesce(p_description,''), p_group_id,
     greatest(coalesce(p_points_reward,0),0), coalesce(p_is_published,false), now());

  for v_item in select value from jsonb_array_elements(p_questions)
  loop
    v_position := v_position + 1;
    v_type := coalesce(v_item->>'type','mcq');
    v_question_text := nullif(trim(coalesce(v_item->>'question_text','')), '');
    v_max_points := greatest(1, least(coalesce((v_item->>'max_points')::integer,1),100));
    v_options := coalesce(v_item->'options','[]'::jsonb);
    v_expected := nullif(trim(coalesce(v_item->>'expected_answer','')), '');

    if v_question_text is null then
      raise exception 'نص السؤال رقم % فارغ', v_position;
    end if;

    if v_type not in ('mcq','essay') then
      raise exception 'نوع سؤال غير صحيح';
    end if;

    if v_type = 'mcq' then
      if jsonb_typeof(v_options) <> 'array' or jsonb_array_length(v_options) < 2 then
        raise exception 'سؤال الاختيار من متعدد رقم % يحتاج اختيارين على الأقل', v_position;
      end if;
      if coalesce(v_item->>'correct_option','') !~ '^[0-9]+$' then
        raise exception 'حدد الإجابة الصحيحة للسؤال رقم %', v_position;
      end if;
      v_correct := (v_item->>'correct_option')::integer;
      if v_correct < 0 or v_correct >= jsonb_array_length(v_options) then
        raise exception 'الإجابة الصحيحة غير صالحة للسؤال رقم %', v_position;
      end if;
    else
      if v_expected is null then
        raise exception 'اكتب الإجابة النموذجية للسؤال المقالي رقم %', v_position;
      end if;
      v_options := '[]'::jsonb;
    end if;

    v_question_id := gen_random_uuid();

    insert into public.quiz_questions
      (id, quiz_id, question_text, options, position, question_type, max_points)
    values
      (v_question_id, v_quiz_id, v_question_text, v_options, v_position,
       v_type, v_max_points);

    if v_type = 'essay' then
      insert into public.quiz_essay_answer_keys (question_id, expected_answer)
      values (v_question_id, v_expected);
    end if;

    if v_type = 'mcq' then
      insert into public.quiz_answer_keys (question_id, correct_option)
      values (v_question_id, v_correct);
    end if;
  end loop;

  return v_quiz_id;
end;
$$;

-- -------------------------
-- 4) الامتحانات المنشورة التي تخص المخدوم
-- -------------------------
create or replace function public.get_member_quizzes()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group uuid;
begin
  if v_uid is null or not public.is_approved_member() then
    raise exception 'يجب تسجيل الدخول بحساب معتمد';
  end if;

  select group_id into v_group from public.profiles where id = v_uid;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', q.id,
      'title', q.title,
      'description', q.description,
      'group_id', q.group_id,
      'points_reward', q.points_reward,
      'created_at', q.created_at
    ) order by q.created_at desc)
    from public.quizzes q
    where q.is_published = true
      and (q.group_id is null or q.group_id = v_group)
      and not exists (
        select 1 from public.quiz_attempts a
        where a.quiz_id=q.id and a.member_id=v_uid
      )
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_member_quiz(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group uuid;
  v_quiz public.quizzes%rowtype;
begin
  if v_uid is null or not public.is_approved_member() then
    raise exception 'يجب تسجيل الدخول بحساب معتمد';
  end if;

  select group_id into v_group from public.profiles where id=v_uid;
  select * into v_quiz from public.quizzes
  where id=p_quiz_id and is_published=true
    and (group_id is null or group_id=v_group);

  if not found then raise exception 'الامتحان غير متاح لحسابك'; end if;

  if exists (
    select 1 from public.quiz_attempts a
    where a.quiz_id=p_quiz_id and a.member_id=v_uid
  ) then
    raise exception 'سبق لك تسليم هذا الامتحان';
  end if;

  return jsonb_build_object(
    'id',v_quiz.id,
    'title',v_quiz.title,
    'description',v_quiz.description,
    'questions',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',q.id,
        'question_text',q.question_text,
        'options',case when q.question_type='mcq' then q.options else '[]'::jsonb end,
        'question_type',q.question_type,
        'max_points',q.max_points,
        'position',q.position
      ) order by q.position)
      from public.quiz_questions q where q.quiz_id=v_quiz.id
    ),'[]'::jsonb)
  );
end;
$$;

-- -------------------------
-- 5) تسليم الامتحان وحساب اقتراح للمقالي
-- -------------------------
create or replace function public.submit_quiz_with_essays(
  p_quiz_id uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group uuid;
  v_quiz public.quizzes%rowtype;
  v_q record;
  v_answer text;
  v_expected text;
  v_expected_words text[];
  v_answer_words text[];
  v_expected_count integer;
  v_match_count integer;
  v_percent integer;
  v_suggested integer;
  v_suggestions jsonb := '{}'::jsonb;
  v_mcq_score integer := 0;
  v_max_score integer := 0;
  v_essay_count integer := 0;
  v_points integer := 0;
  v_attempt_id uuid := gen_random_uuid();
begin
  if v_uid is null or not public.is_approved_member() then
    raise exception 'يجب تسجيل الدخول بحساب معتمد';
  end if;
  if jsonb_typeof(p_answers) <> 'object' then
    raise exception 'الإجابات غير صالحة';
  end if;

  select group_id into v_group from public.profiles where id=v_uid;
  select * into v_quiz from public.quizzes
  where id=p_quiz_id and is_published=true
    and (group_id is null or group_id=v_group);
  if not found then raise exception 'الامتحان غير متاح'; end if;

  if exists (select 1 from public.quiz_attempts a where a.quiz_id=p_quiz_id and a.member_id=v_uid) then
    raise exception 'تم تسليم هذا الامتحان بالفعل';
  end if;

  for v_q in
    select q.id,q.question_type,q.max_points,k.correct_option,ek.expected_answer
    from public.quiz_questions q
    left join public.quiz_answer_keys k on k.question_id=q.id
    left join public.quiz_essay_answer_keys ek on ek.question_id=q.id
    where q.quiz_id=p_quiz_id
    order by q.position
  loop
    v_max_score := v_max_score + greatest(v_q.max_points,1);
    v_answer := coalesce(p_answers->>v_q.id::text,'');

    if v_q.question_type='essay' then
      v_essay_count := v_essay_count + 1;
      v_expected := lower(regexp_replace(coalesce(v_q.expected_answer,''),'[[:punct:][:space:]]+',' ','g'));
      v_answer := lower(regexp_replace(coalesce(v_answer,''),'[[:punct:][:space:]]+',' ','g'));
      v_expected_words := regexp_split_to_array(trim(v_expected),'\s+');
      v_answer_words := regexp_split_to_array(trim(v_answer),'\s+');

      select count(distinct a.word) into v_match_count
      from unnest(v_answer_words) as a(word)
      where length(a.word)>1 and a.word = any(v_expected_words);

      select count(distinct e.word) into v_expected_count
      from unnest(v_expected_words) as e(word)
      where length(e.word)>1;

      v_percent := case when coalesce(v_expected_count,0)=0 then 0
        else least(100,round(100.0*coalesce(v_match_count,0)/v_expected_count)::integer) end;
      v_suggested := floor(greatest(v_q.max_points,1)*v_percent/100.0)::integer;

      v_suggestions := v_suggestions || jsonb_build_object(
        v_q.id::text,
        jsonb_build_object(
          'match_percent',v_percent,
          'suggested_score',v_suggested,
          'max_points',greatest(v_q.max_points,1)
        )
      );
    else
      if coalesce(p_answers->>v_q.id::text,'') ~ '^[0-9]+$'
         and (p_answers->>v_q.id::text)::integer = v_q.correct_option then
        v_mcq_score := v_mcq_score + greatest(v_q.max_points,1);
      end if;
    end if;
  end loop;

  if v_max_score=0 then raise exception 'الامتحان لا يحتوي على أسئلة'; end if;

  if v_essay_count=0 then
    v_points := floor(greatest(coalesce(v_quiz.points_reward,0),0)*v_mcq_score::numeric/v_max_score)::integer;
  end if;

  insert into public.quiz_attempts
    (id,quiz_id,member_id,answers,score,max_score,submitted_at,points_awarded,
     essay_review_status,essay_suggestions)
  values
    (v_attempt_id,p_quiz_id,v_uid,p_answers,
     case when v_essay_count>0 then 0 else v_mcq_score end,
     v_max_score,now(),v_points,
     case when v_essay_count>0 then 'pending' else 'not_required' end,
     v_suggestions);

  if v_essay_count=0 and v_points>0 then
    update public.profiles set points=coalesce(points,0)+v_points where id=v_uid;
    insert into public.point_transactions(member_id,amount,reason,awarded_by)
    values(v_uid,v_points,'مكافأة امتحان: '||coalesce(v_quiz.title,'امتحان'),v_uid);
  end if;

  return jsonb_build_object(
    'attempt_id',v_attempt_id,
    'pending_review',v_essay_count>0,
    'score',case when v_essay_count>0 then null else v_mcq_score end,
    'max_score',v_max_score,
    'points_awarded',v_points
  );
end;
$$;

-- -------------------------
-- 6) تحميل إجابات المقالي للخادم/الأدمن
-- -------------------------
create or replace function public.get_essay_review_data(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_role();
  v_quiz public.quizzes%rowtype;
begin
  if v_uid is null or not public.is_approved_member()
     or not (public.is_admin() or v_role='servant') then
    raise exception 'غير مصرح لك';
  end if;

  select * into v_quiz from public.quizzes where id=p_quiz_id;
  if not found then raise exception 'الامتحان غير موجود'; end if;

  if not public.is_admin() and (
    v_quiz.group_id is null or not exists (
      select 1 from public.servant_group_assignments s
      where s.servant_id=v_uid and s.group_id=v_quiz.group_id
    )
  ) then
    raise exception 'هذا الامتحان ليس ضمن مجموعاتك';
  end if;

  return jsonb_build_object(
    'quiz',jsonb_build_object(
      'id',v_quiz.id,'title',v_quiz.title,
      'points_reward',coalesce(v_quiz.points_reward,0)
    ),
    'questions',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',q.id,'question_text',q.question_text,
        'expected_answer',ek.expected_answer,
        'max_points',q.max_points,'position',q.position
      ) order by q.position)
      from public.quiz_questions q
      join public.quiz_essay_answer_keys ek on ek.question_id=q.id
      where q.quiz_id=p_quiz_id and q.question_type='essay'
    ),'[]'::jsonb),
    'attempts',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'member_id',a.member_id,
        'member_name',coalesce(p.full_name,'عضو بدون اسم'),
        'answers',a.answers,
        'essay_suggestions',a.essay_suggestions,
        'submitted_at',a.submitted_at,
        'essay_review_status',a.essay_review_status
      ) order by a.submitted_at)
      from public.quiz_attempts a
      left join public.profiles p on p.id=a.member_id
      where a.quiz_id=p_quiz_id and a.essay_review_status='pending'
    ),'[]'::jsonb)
  );
end;
$$;

-- -------------------------
-- 7) اعتماد الدرجة بعد مراجعة الخادم/الأدمن فقط
-- -------------------------
create or replace function public.finalize_essay_review(
  p_attempt_id uuid,
  p_scores jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_role();
  v_attempt public.quiz_attempts%rowtype;
  v_quiz public.quizzes%rowtype;
  v_q record;
  v_score_text text;
  v_essay_score integer;
  v_mcq_score integer := 0;
  v_final_score integer := 0;
  v_max_score integer := 0;
  v_points integer := 0;
begin
  if v_uid is null or not public.is_approved_member()
     or not (public.is_admin() or v_role='servant') then
    raise exception 'غير مصرح لك';
  end if;

  select * into v_attempt from public.quiz_attempts
  where id=p_attempt_id for update;
  if not found then raise exception 'محاولة الامتحان غير موجودة'; end if;
  if v_attempt.essay_review_status='reviewed' then
    raise exception 'تمت مراجعة هذا الامتحان بالفعل';
  end if;

  select * into v_quiz from public.quizzes where id=v_attempt.quiz_id;
  if not found then raise exception 'الامتحان غير موجود'; end if;

  if not public.is_admin() and (
    v_quiz.group_id is null or not exists (
      select 1 from public.servant_group_assignments s
      where s.servant_id=v_uid and s.group_id=v_quiz.group_id
    )
  ) then
    raise exception 'هذا الامتحان ليس ضمن مجموعاتك';
  end if;

  if jsonb_typeof(p_scores)<>'object' then
    raise exception 'درجات الأسئلة غير صالحة';
  end if;

  for v_q in
    select q.id,q.question_type,q.max_points,k.correct_option
    from public.quiz_questions q
    left join public.quiz_answer_keys k on k.question_id=q.id
    where q.quiz_id=v_attempt.quiz_id
    order by q.position
  loop
    v_max_score := v_max_score + greatest(v_q.max_points,1);
    if v_q.question_type='essay' then
      v_score_text := p_scores->>v_q.id::text;
      if coalesce(v_score_text,'') !~ '^[0-9]+$' then
        raise exception 'راجع كل الأسئلة المقالية قبل اعتماد الدرجة';
      end if;
      v_essay_score := v_score_text::integer;
      if v_essay_score<0 or v_essay_score>greatest(v_q.max_points,1) then
        raise exception 'درجة السؤال المقالى خارج النطاق';
      end if;
      v_final_score := v_final_score + v_essay_score;
    else
      if coalesce(v_attempt.answers->>v_q.id::text,'') ~ '^[0-9]+$'
         and (v_attempt.answers->>v_q.id::text)::integer = v_q.correct_option then
        v_mcq_score := v_mcq_score + greatest(v_q.max_points,1);
      end if;
    end if;
  end loop;

  v_final_score := v_final_score + v_mcq_score;
  v_points := case when v_max_score>0
    then floor(greatest(coalesce(v_quiz.points_reward,0),0)*v_final_score::numeric/v_max_score)::integer
    else 0 end;

  update public.quiz_attempts
  set score=v_final_score,
      max_score=v_max_score,
      points_awarded=v_points,
      essay_review_status='reviewed',
      essay_reviewed_by=v_uid,
      essay_reviewed_at=now()
  where id=p_attempt_id;

  if v_points>0 then
    update public.profiles
    set points=coalesce(points,0)+v_points
    where id=v_attempt.member_id;

    insert into public.point_transactions(member_id,amount,reason,awarded_by)
    values(v_attempt.member_id,v_points,'مكافأة امتحان بعد مراجعة المقالي: '||coalesce(v_quiz.title,'امتحان'),v_uid);
  end if;

  return jsonb_build_object(
    'score',v_final_score,
    'max_score',v_max_score,
    'points_awarded',v_points,
    'status','reviewed'
  );
end;
$$;

-- -------------------------
-- 8) صلاحيات RPC
-- -------------------------
revoke all on function public.create_quiz_with_questions(text,text,uuid,integer,boolean,jsonb) from public, anon;
revoke all on function public.get_member_quizzes() from public, anon;
revoke all on function public.get_member_quiz(uuid) from public, anon;
revoke all on function public.submit_quiz_with_essays(uuid,jsonb) from public, anon;
revoke all on function public.get_essay_review_data(uuid) from public, anon;
revoke all on function public.finalize_essay_review(uuid,jsonb) from public, anon;

grant execute on function public.create_quiz_with_questions(text,text,uuid,integer,boolean,jsonb) to authenticated;
grant execute on function public.get_member_quizzes() to authenticated;
grant execute on function public.get_member_quiz(uuid) to authenticated;
grant execute on function public.submit_quiz_with_essays(uuid,jsonb) to authenticated;
grant execute on function public.get_essay_review_data(uuid) to authenticated;
grant execute on function public.finalize_essay_review(uuid,jsonb) to authenticated;
