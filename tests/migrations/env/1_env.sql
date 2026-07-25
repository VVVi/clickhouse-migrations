-- create a dictionary sourced from a per-environment Postgres

CREATE OR REPLACE DICTIONARY dict_offers
(
  `id` UUID,
  `name` String DEFAULT ''
)
PRIMARY KEY id
SOURCE(POSTGRESQL(HOST '${PG_HOST}' PORT ${PG_PORT} DB '${PG_DB}' TABLE 'offers'))
LIFETIME(MIN 0 MAX 300)
LAYOUT(COMPLEX_KEY_HASHED());
