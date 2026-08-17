-- Defensive dedupe, then natural key for upserts (fixes the Phase 01 discovery:
-- delete+reinsert cascaded away vocab_cards / SRS progress on re-seed).
delete from vocab_words a
  using vocab_words b
  where a.id > b.id and a.unit_id = b.unit_id and a.word = b.word;

alter table vocab_words
  add constraint vocab_words_unit_word_key unique (unit_id, word);
