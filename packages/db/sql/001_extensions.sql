-- 幂等：扩展必须先于表迁移（embedding 列类型是 vector）
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
