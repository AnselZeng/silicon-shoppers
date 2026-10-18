-- Snowflake objects for the live store. `python -m server setup` runs this for you (as your own user).
-- Names can be changed with SNOWFLAKE_DATABASE / SNOWFLAKE_SCHEMA / SNOWFLAKE_WAREHOUSE in .env.

-- XSMALL = 1 credit per hour while running; it suspends itself after 60 s without queries.
CREATE WAREHOUSE IF NOT EXISTS {warehouse} WAREHOUSE_SIZE = XSMALL AUTO_SUSPEND = 60 AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE;
CREATE DATABASE IF NOT EXISTS {database};
CREATE SCHEMA IF NOT EXISTS {database}.{schema};
USE SCHEMA {database}.{schema};

-- Written by the store (app/api/events): one row per store event, as emitted by lib/sim/tracker.ts.
CREATE TABLE IF NOT EXISTS EVENTS (
  EVENT_ID STRING,               -- client-generated, for de-duplication
  USER_ID STRING NOT NULL,       -- anonymous shopper id (localStorage) or profile id
  SESSION_ID STRING,             -- one browser tab / visit
  TYPE STRING NOT NULL,          -- product_viewed, quickview_opened, add_to_bag, sort_changed, filter_applied, ...
  TS TIMESTAMP_NTZ NOT NULL,     -- event time (UTC)
  ROUTE STRING,
  PRODUCT_ID STRING,             -- properties.productId, copied out for joins
  COLOR STRING,                  -- properties.color (add to bag on the product page)
  PROPERTIES VARIANT,            -- everything else the event carried
  INSERTED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- The demo catalog (python -m server catalog).
CREATE TABLE IF NOT EXISTS CATALOG (
  PRODUCT_ID STRING PRIMARY KEY, NAME STRING, DEPARTMENT STRING, CATEGORY STRING, COLLECTION STRING,
  PRICE FLOAT, SALE_PRICE FLOAT, COLORS VARIANT, IS_NEW BOOLEAN, POPULARITY FLOAT
);

-- Read by the store: one homepage document per shopper, rewritten by every refresh that saw new events.
CREATE TABLE IF NOT EXISTS USER_LAYOUTS (
  USER_ID STRING PRIMARY KEY,
  UPDATED_AT TIMESTAMP_NTZ,
  RUN_ID STRING,                 -- MODEL_RUNS row that produced it
  N_EVENTS INTEGER,              -- events seen so far
  N_CARTS INTEGER,               -- add-to-bag events (the purchase model's input)
  HOMEPAGE VARIANT               -- HomepageDoc (lib/model/homepage.ts), incl. session, preferences, store_products
);

-- Every version of every shopper's layout, to show how it adapted.
CREATE TABLE IF NOT EXISTS USER_LAYOUTS_HISTORY (
  USER_ID STRING, UPDATED_AT TIMESTAMP_NTZ, RUN_ID STRING, N_EVENTS INTEGER, N_CARTS INTEGER, HOMEPAGE VARIANT
);

-- Store-wide trending products over the last TRENDING_MINUTES (default 60).
CREATE TABLE IF NOT EXISTS TRENDING (
  PRODUCT_ID STRING, VIEWS INTEGER, CARTS INTEGER, SCORE FLOAT, RANK INTEGER, WINDOW_MINUTES INTEGER,
  UPDATED_AT TIMESTAMP_NTZ
);

-- One row per retrain and per refresh: what ran, when, on which models, and the numbers.
CREATE TABLE IF NOT EXISTS MODEL_RUNS (
  RUN_ID STRING PRIMARY KEY, KIND STRING, STARTED_AT TIMESTAMP_NTZ, FINISHED_AT TIMESTAMP_NTZ,
  STATUS STRING, MODEL_VERSION STRING, DETAILS VARIANT
);

-- H&M model outputs for the 100k cohort shoppers (python -m server publish-hm). Private: H&M data rules.
CREATE TABLE IF NOT EXISTS HM_HOMEPAGES (CUSTOMER_KEY INTEGER PRIMARY KEY, STRATUM STRING, HOMEPAGE VARIANT);
CREATE TABLE IF NOT EXISTS HM_ARTICLES (
  ARTICLE_ID STRING PRIMARY KEY, NAME STRING, CATEGORY STRING, DEPARTMENT STRING, COLOR STRING, PRICE_SCALED FLOAT
);

-- Refresh bookkeeping (last processed INSERTED_AT).
CREATE TABLE IF NOT EXISTS JOB_STATE (NAME STRING PRIMARY KEY, VALUE STRING, UPDATED_AT TIMESTAMP_NTZ);
