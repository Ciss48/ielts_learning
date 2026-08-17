create table tests (
  id uuid primary key default gen_random_uuid(),
  skill text not null check (skill in ('reading','listening','writing')),
  title text not null,
  source text,
  audio_url text,
  duration_minutes int not null,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references tests(id) on delete cascade,
  qnum int not null,
  qtype text not null check (qtype in
    ('mcq','tfng','ynng','matching','gap_fill','short_answer','essay')),
  prompt text not null,
  options jsonb,
  answer_key jsonb,
  explanation_md text,
  unique (test_id, qnum)
);

create table units (
  id uuid primary key default gen_random_uuid(),
  seq int not null unique,
  block text not null check (block in
    ('diagnostic','foundation','skill_cycle','mock','taper')),
  skill text not null check (skill in
    ('reading','listening','writing','speaking','vocab','mixed')),
  title text not null,
  strategy_md text not null default '',
  test_id uuid references tests(id),
  est_minutes int not null default 60,
  elsa_task text,
  created_at timestamptz not null default now()
);

create table unit_completions (
  unit_id uuid primary key references units(id) on delete cascade,
  completed_at timestamptz not null default now()
);

create table attempts (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references units(id),
  test_id uuid not null references tests(id),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  answers jsonb not null default '{}'::jsonb,
  score_raw int,
  score_total int,
  band_estimate numeric(2,1),
  ai_feedback_md text
);

create table vocab_words (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references units(id) on delete set null,
  word text not null,
  ipa text,
  meaning_en text,
  meaning_vi text,
  example text
);

create table vocab_cards (
  id uuid primary key default gen_random_uuid(),
  word_id uuid not null unique references vocab_words(id) on delete cascade,
  added_at timestamptz not null default now(),
  ease numeric not null default 2.5,
  interval_days int not null default 0,
  due_date date not null default current_date,
  reps int not null default 0,
  lapses int not null default 0
);

create table vocab_reviews (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references vocab_cards(id) on delete cascade,
  reviewed_at timestamptz not null default now(),
  grade int not null check (grade between 0 and 3)
);

create table study_log (
  day date primary key,
  minutes int not null default 0,
  units_completed int not null default 0
);

-- RLS: single-user app — authenticated role gets full access, anon gets nothing.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "authenticated_all" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
