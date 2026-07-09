-- ==========================================
-- CONCERT TAXIPOT SIMPLIFIED CLEAN SCHEMA
-- ==========================================

-- 1. CLEAN UP EXISTING SCHEMA TABLES AND VIEWS (CASCADE)
DROP VIEW IF EXISTS "public"."active_taxi_pots" CASCADE;
DROP VIEW IF EXISTS "public"."completed_taxi_pots" CASCADE;
DROP VIEW IF EXISTS "public"."taxi_pot_save_counts" CASCADE;
DROP VIEW IF EXISTS "public"."taxi_pot_stats" CASCADE;
DROP VIEW IF EXISTS "public"."user_usage_history" CASCADE;

DROP TABLE IF EXISTS "public"."alert_subscriptions" CASCADE;
DROP TABLE IF EXISTS "public"."admin_users" CASCADE;
DROP TABLE IF EXISTS "public"."reservations" CASCADE;
DROP TABLE IF EXISTS "public"."saved_taxi_pots" CASCADE;
DROP TABLE IF EXISTS "public"."service_notices" CASCADE;
DROP TABLE IF EXISTS "public"."support_messages" CASCADE;
DROP TABLE IF EXISTS "public"."support_tickets" CASCADE;
DROP TABLE IF EXISTS "public"."taxi_pot_likes" CASCADE;
DROP TABLE IF EXISTS "public"."taxi_pot_reports" CASCADE;
DROP TABLE IF EXISTS "public"."profiles" CASCADE;
DROP TABLE IF EXISTS "public"."open_chat_click_logs" CASCADE;
DROP TABLE IF EXISTS "public"."notifications" CASCADE;
DROP TABLE IF EXISTS "public"."content_pages" CASCADE;

DROP TABLE IF EXISTS "public"."taxi_pot_reservations" CASCADE;
DROP TABLE IF EXISTS "public"."taxi_pot_saves" CASCADE;
DROP TABLE IF EXISTS "public"."taxi_pots" CASCADE;
DROP TABLE IF EXISTS "public"."anonymous_users" CASCADE;
DROP TABLE IF EXISTS "public"."concert_categories" CASCADE;

-- 2. CREATE CORE TABLES

-- A. Concert Categories Table
CREATE TABLE "public"."concert_categories" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    "slug" text NOT NULL UNIQUE,
    "title" text NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "keywords" text[] DEFAULT '{}'::text[] NOT NULL,
    "excluded_keywords" text[] DEFAULT '{}'::text[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "venue_name" text,
    "venue_aliases" text[] DEFAULT '{}'::text[] NOT NULL
);

-- B. Taxi Pots Table
CREATE TABLE "public"."taxi_pots" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    "seed_key" text UNIQUE,
    "category_id" uuid NOT NULL REFERENCES "public"."concert_categories"("id") ON DELETE RESTRICT,
    "concert_title" text NOT NULL,
    "origin" text NOT NULL,
    "destination" text NOT NULL,
    "date" date NOT NULL,
    "time" time without time zone NOT NULL,
    "open_chat_url" text NOT NULL,
    "direction" text DEFAULT 'unknown'::text NOT NULL,
    "max_people" integer DEFAULT 5 NOT NULL,
    "status" text DEFAULT 'open'::text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "min_people" integer,
    "estimated_fare" integer,
    "notes" text,
    CONSTRAINT "taxi_pots_direction_check" CHECK (("direction" = ANY (ARRAY['in'::text, 'out'::text, 'unknown'::text]))),
    CONSTRAINT "taxi_pots_estimated_fare_check" CHECK ((("estimated_fare" IS NULL) OR ("estimated_fare" >= 0))),
    CONSTRAINT "taxi_pots_max_people_check" CHECK (("max_people" > 0)),
    CONSTRAINT "taxi_pots_min_people_check" CHECK ((("min_people" IS NULL) OR ("min_people" > 0))),
    CONSTRAINT "taxi_pots_status_check" CHECK (("status" = ANY (ARRAY['open'::text, 'closed'::text, 'cancelled'::text])))
);

-- C. Anonymous Users Table
CREATE TABLE "public"."anonymous_users" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    "anonymous_key" text NOT NULL UNIQUE,
    "phone" text,
    "display_name" text,
    "refund_account" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- D. Taxi Pot Saves (Likes/Alerts) Table
CREATE TABLE "public"."taxi_pot_saves" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    "anonymous_user_id" uuid REFERENCES "public"."anonymous_users"("id") ON DELETE CASCADE,
    "anonymous_key" text NOT NULL,
    "taxi_pot_id" uuid NOT NULL REFERENCES "public"."taxi_pots"("id") ON DELETE CASCADE,
    "alert_min_people" integer,
    "alert_phone" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    UNIQUE ("anonymous_key", "taxi_pot_id")
);

-- E. Taxi Pot Reservations Table
CREATE TABLE "public"."taxi_pot_reservations" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    "taxi_pot_id" uuid NOT NULL REFERENCES "public"."taxi_pots"("id") ON DELETE CASCADE,
    "anonymous_user_id" uuid REFERENCES "public"."anonymous_users"("id") ON DELETE SET NULL,
    "anonymous_key" text NOT NULL,
    "depositor_name" text NOT NULL,
    "depositor_phone" text NOT NULL,
    "refund_account" text NOT NULL,
    "expected_fare" integer NOT NULL,
    "deposit_amount" integer NOT NULL,
    "expected_refund" integer NOT NULL,
    "status" text DEFAULT 'submitted'::text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "taxi_pot_reservations_status_check" CHECK (("status" = ANY (ARRAY['submitted'::text, 'deposit_confirmed'::text, 'joined_chat'::text, 'cancelled'::text, 'refunded'::text])))
);

-- F. Open Chat Click Logs Table
CREATE TABLE "public"."open_chat_click_logs" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    "event_type" text DEFAULT 'open_chat_click'::text NOT NULL,
    "taxi_pot_id" uuid REFERENCES "public"."taxi_pots"("id") ON DELETE SET NULL,
    "category_id" uuid REFERENCES "public"."concert_categories"("id") ON DELETE SET NULL,
    "open_chat_url" text,
    "concert_title" text,
    "origin" text,
    "destination" text,
    "user_agent" text,
    "referrer" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "open_chat_click_logs_event_type_check" CHECK (("event_type" = ANY (ARRAY['open_chat_click'::text, 'create_taxi_pot_click'::text])))
);

-- 3. CREATE CONVENIENCE VIEWS

-- View to get aggregate like/save counts per taxi pot
CREATE OR REPLACE VIEW "public"."taxi_pot_save_counts" AS
 SELECT "taxi_pot_id",
    ("count"(*))::integer AS "save_count"
   FROM "public"."taxi_pot_saves"
  GROUP BY "taxi_pot_id";

-- 4. ROW LEVEL SECURITY (RLS) POLICIES FOR ANONYMOUS ACCESS

ALTER TABLE "public"."concert_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."taxi_pots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."anonymous_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."taxi_pot_saves" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."taxi_pot_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."open_chat_click_logs" ENABLE ROW LEVEL SECURITY;

-- Categories access
CREATE POLICY "Allow public read" ON "public"."concert_categories" FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON "public"."concert_categories" FOR INSERT WITH CHECK (true);

-- Taxi Pots access
CREATE POLICY "Allow public read" ON "public"."taxi_pots" FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON "public"."taxi_pots" FOR INSERT WITH CHECK (true);

-- Anonymous Users access
CREATE POLICY "Allow public insert" ON "public"."anonymous_users" FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public select" ON "public"."anonymous_users" FOR SELECT USING (true);
CREATE POLICY "Allow public update" ON "public"."anonymous_users" FOR UPDATE USING (true);

-- Saves (Likes) access
CREATE POLICY "Allow public insert" ON "public"."taxi_pot_saves" FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public select" ON "public"."taxi_pot_saves" FOR SELECT USING (true);
CREATE POLICY "Allow public delete" ON "public"."taxi_pot_saves" FOR DELETE USING (true);

-- Reservations access
CREATE POLICY "Allow public insert" ON "public"."taxi_pot_reservations" FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public select" ON "public"."taxi_pot_reservations" FOR SELECT USING (true);

-- Open chat click logs access
CREATE POLICY "Allow public insert" ON "public"."open_chat_click_logs" FOR INSERT WITH CHECK (true);

-- 5. ENABLE REALTIME FOR LIKES SYNC
alter publication supabase_realtime add table taxi_pot_saves;
