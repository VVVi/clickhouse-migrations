-- create table sessions

CREATE TABLE IF NOT EXISTS `sessions` (
  `session_id` UInt64
)
ENGINE=MergeTree()
ORDER BY (`session_id`);
