CREATE TABLE "voicemail_boxes" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_main" boolean DEFAULT false NOT NULL,
	"greeting_text" text,
	"transcribe" boolean DEFAULT false NOT NULL,
	"max_length_sec" integer DEFAULT 120 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"notify_sms" text[] DEFAULT '{}'::text[] NOT NULL,
	"notify_email" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voicemails" (
	"id" serial PRIMARY KEY NOT NULL,
	"box_id" integer NOT NULL,
	"call_sid" text,
	"from_number" text,
	"recording_sid" text NOT NULL,
	"recording_url" text NOT NULL,
	"duration_sec" integer DEFAULT 0 NOT NULL,
	"transcription" text,
	"transcription_status" text DEFAULT 'pending' NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"heard_at" timestamp with time zone,
	"heard_by" integer,
	"notified_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voicemails_recording_sid_unique" UNIQUE("recording_sid")
);
--> statement-breakpoint
ALTER TABLE "voicemails" ADD CONSTRAINT "voicemails_box_id_voicemail_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."voicemail_boxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voicemails" ADD CONSTRAINT "voicemails_heard_by_admin_users_id_fk" FOREIGN KEY ("heard_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voicemails_box_idx" ON "voicemails" USING btree ("box_id","created_at");