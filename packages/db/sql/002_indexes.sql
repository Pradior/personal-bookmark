-- 函数索引与向量索引：drizzle-kit 生成不了表达式的 GIN / HNSW，
-- 所以放在迁移之后单独执行（全部 IF NOT EXISTS，可重复跑）。

-- 中文全文（ADR-005）：search_text 存 jieba 预分词结果
CREATE INDEX IF NOT EXISTS item_fts_idx
  ON item USING gin (to_tsvector('simple', search_text));

-- 标题模糊 / 子串兜底
CREATE INDEX IF NOT EXISTS item_title_trgm_idx
  ON item USING gin (title gin_trgm_ops);

-- 正文子串搜索：jieba 预分词只能覆盖抓取类条目（速记的 search_text 是空的），
-- 所以搜索还要靠正文 ILIKE 兜底。1 万条正文上没这个索引会很慢。
CREATE INDEX IF NOT EXISTS item_content_trgm_idx
  ON item USING gin (content_text gin_trgm_ops);

-- 语义检索（ADR-010）：1 万条 HNSW 无需训练
CREATE INDEX IF NOT EXISTS item_embedding_idx
  ON item USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
