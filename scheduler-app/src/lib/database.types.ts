export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_calls: {
        Row: {
          agent_name: string
          cost_cents: number | null
          ended_at: string | null
          error_message: string | null
          id: string
          input: Json | null
          latency_ms: number | null
          model: string
          output: Json | null
          run_id: string
          started_at: string
          step_number: number | null
          tokens_in: number | null
          tokens_out: number | null
        }
        Insert: {
          agent_name: string
          cost_cents?: number | null
          ended_at?: string | null
          error_message?: string | null
          id?: string
          input?: Json | null
          latency_ms?: number | null
          model: string
          output?: Json | null
          run_id: string
          started_at?: string
          step_number?: number | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Update: {
          agent_name?: string
          cost_cents?: number | null
          ended_at?: string | null
          error_message?: string | null
          id?: string
          input?: Json | null
          latency_ms?: number | null
          model?: string
          output?: Json | null
          run_id?: string
          started_at?: string
          step_number?: number | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_calls_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "orchestrator_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_blocks: {
        Row: {
          blocked_date: string
          blocked_time: string | null
          blocked_type: string | null
          created_at: string
          created_by_name: string
          created_by_oauth_client_id: string
          id: string
          reason: string | null
          shop_id: number
        }
        Insert: {
          blocked_date: string
          blocked_time?: string | null
          blocked_type?: string | null
          created_at?: string
          created_by_name: string
          created_by_oauth_client_id: string
          id?: string
          reason?: string | null
          shop_id: number
        }
        Update: {
          blocked_date?: string
          blocked_time?: string | null
          blocked_type?: string | null
          created_at?: string
          created_by_name?: string
          created_by_oauth_client_id?: string
          id?: string
          reason?: string | null
          shop_id?: number
        }
        Relationships: []
      }
      appointment_concerns: {
        Row: {
          appointment_id: number | null
          category: string
          classified_at: string
          id: string
          prose_summary: string
          raw_text: string
          session_id: string
        }
        Insert: {
          appointment_id?: number | null
          category: string
          classified_at?: string
          id?: string
          prose_summary: string
          raw_text: string
          session_id: string
        }
        Update: {
          appointment_id?: number | null
          category?: string
          classified_at?: string
          id?: string
          prose_summary?: string
          raw_text?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_concerns_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "customer_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_default_limits: {
        Row: {
          day_of_week: number
          dropoff_total: number
          is_closed: boolean
          notes: string | null
          shop_id: number
          updated_at: string
          updated_by_name: string | null
          updated_by_oauth_client_id: string | null
          waiter_8am_slots: number
          waiter_9am_slots: number
        }
        Insert: {
          day_of_week: number
          dropoff_total?: number
          is_closed?: boolean
          notes?: string | null
          shop_id: number
          updated_at?: string
          updated_by_name?: string | null
          updated_by_oauth_client_id?: string | null
          waiter_8am_slots?: number
          waiter_9am_slots?: number
        }
        Update: {
          day_of_week?: number
          dropoff_total?: number
          is_closed?: boolean
          notes?: string | null
          shop_id?: number
          updated_at?: string
          updated_by_name?: string | null
          updated_by_oauth_client_id?: string | null
          waiter_8am_slots?: number
          waiter_9am_slots?: number
        }
        Relationships: []
      }
      appointment_holds: {
        Row: {
          appointment_type: string
          claimed_by_session_id: string | null
          created_at: string
          customer_id: number | null
          expires_at: string
          id: string
          released_at: string | null
          scheduled_date: string
          scheduled_time: string
          service_summary: string | null
          session_id: string
          shop_id: number
          vehicle_id: number | null
        }
        Insert: {
          appointment_type: string
          claimed_by_session_id?: string | null
          created_at?: string
          customer_id?: number | null
          expires_at: string
          id?: string
          released_at?: string | null
          scheduled_date: string
          scheduled_time: string
          service_summary?: string | null
          session_id: string
          shop_id: number
          vehicle_id?: number | null
        }
        Update: {
          appointment_type?: string
          claimed_by_session_id?: string | null
          created_at?: string
          customer_id?: number | null
          expires_at?: string
          id?: string
          released_at?: string | null
          scheduled_date?: string
          scheduled_time?: string
          service_summary?: string | null
          session_id?: string
          shop_id?: number
          vehicle_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "appointment_holds_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "customer_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_sync_state: {
        Row: {
          last_delta_sync_at: string
          last_delta_sync_count: number
          last_full_sync_at: string
          notes: string | null
          shop_id: number
          updated_at: string
        }
        Insert: {
          last_delta_sync_at?: string
          last_delta_sync_count?: number
          last_full_sync_at?: string
          notes?: string | null
          shop_id: number
          updated_at?: string
        }
        Update: {
          last_delta_sync_at?: string
          last_delta_sync_count?: number
          last_full_sync_at?: string
          notes?: string | null
          shop_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      appointments: {
        Row: {
          appointment_option: string | null
          appointment_status: string
          appointment_type: string
          arrived: boolean | null
          color: string | null
          confirmation_status: string | null
          created_at: string
          created_date: string | null
          customer_id: number | null
          deleted_at: string | null
          description: string | null
          dropoff_time: string | null
          end_time: string
          id: string
          lead_source: string | null
          parse_version: number
          pickup_time: string | null
          raw_payload: Json | null
          ride_option: string | null
          shop_id: number
          source: string
          start_time: string
          tekmetric_appointment_id: number
          tekmetric_synced_at: string
          title: string | null
          updated_at: string
          updated_date: string | null
          vehicle_id: number | null
        }
        Insert: {
          appointment_option?: string | null
          appointment_status: string
          appointment_type: string
          arrived?: boolean | null
          color?: string | null
          confirmation_status?: string | null
          created_at?: string
          created_date?: string | null
          customer_id?: number | null
          deleted_at?: string | null
          description?: string | null
          dropoff_time?: string | null
          end_time: string
          id?: string
          lead_source?: string | null
          parse_version?: number
          pickup_time?: string | null
          raw_payload?: Json | null
          ride_option?: string | null
          shop_id: number
          source?: string
          start_time: string
          tekmetric_appointment_id: number
          tekmetric_synced_at?: string
          title?: string | null
          updated_at?: string
          updated_date?: string | null
          vehicle_id?: number | null
        }
        Update: {
          appointment_option?: string | null
          appointment_status?: string
          appointment_type?: string
          arrived?: boolean | null
          color?: string | null
          confirmation_status?: string | null
          created_at?: string
          created_date?: string | null
          customer_id?: number | null
          deleted_at?: string | null
          description?: string | null
          dropoff_time?: string | null
          end_time?: string
          id?: string
          lead_source?: string | null
          parse_version?: number
          pickup_time?: string | null
          raw_payload?: Json | null
          ride_option?: string | null
          shop_id?: number
          source?: string
          start_time?: string
          tekmetric_appointment_id?: number
          tekmetric_synced_at?: string
          title?: string | null
          updated_at?: string
          updated_date?: string | null
          vehicle_id?: number | null
        }
        Relationships: []
      }
      chat_sessions: {
        Row: {
          id: string
          last_active_at: string
          metadata: Json
          started_at: string
          user_label: string
        }
        Insert: {
          id?: string
          last_active_at?: string
          metadata?: Json
          started_at?: string
          user_label: string
        }
        Update: {
          id?: string
          last_active_at?: string
          metadata?: Json
          started_at?: string
          user_label?: string
        }
        Relationships: []
      }
      closed_dates: {
        Row: {
          closed_date: string
          created_at: string
          id: string
          reason: string
          shop_id: number
          source: string
        }
        Insert: {
          closed_date: string
          created_at?: string
          id?: string
          reason: string
          shop_id: number
          source?: string
        }
        Update: {
          closed_date?: string
          created_at?: string
          id?: string
          reason?: string
          shop_id?: number
          source?: string
        }
        Relationships: []
      }
      concern_category_guidelines: {
        Row: {
          category: string
          display_label: string
          guideline_prose: string
          shop_id: number
          updated_at: string
          updated_by_name: string | null
          updated_by_oauth_client_id: string | null
        }
        Insert: {
          category: string
          display_label: string
          guideline_prose: string
          shop_id: number
          updated_at?: string
          updated_by_name?: string | null
          updated_by_oauth_client_id?: string | null
        }
        Update: {
          category?: string
          display_label?: string
          guideline_prose?: string
          shop_id?: number
          updated_at?: string
          updated_by_name?: string | null
          updated_by_oauth_client_id?: string | null
        }
        Relationships: []
      }
      concern_questions: {
        Row: {
          active: boolean
          category: string
          created_at: string
          display_order: number
          id: number
          multi_select: boolean
          options: Json
          question_text: string
          required_facts: string[]
          shop_id: number
          subcategory_id: number
          updated_at: string
          updated_by_name: string | null
          updated_by_oauth_client_id: string | null
        }
        Insert: {
          active?: boolean
          category: string
          created_at?: string
          display_order?: number
          id?: number
          multi_select?: boolean
          options: Json
          question_text: string
          required_facts?: string[]
          shop_id: number
          subcategory_id: number
          updated_at?: string
          updated_by_name?: string | null
          updated_by_oauth_client_id?: string | null
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          display_order?: number
          id?: number
          multi_select?: boolean
          options?: Json
          question_text?: string
          required_facts?: string[]
          shop_id?: number
          subcategory_id?: number
          updated_at?: string
          updated_by_name?: string | null
          updated_by_oauth_client_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "concern_questions_subcategory_id_fkey"
            columns: ["subcategory_id"]
            isOneToOne: false
            referencedRelation: "concern_subcategories"
            referencedColumns: ["id"]
          },
        ]
      }
      concern_subcategories: {
        Row: {
          active: boolean
          category: string
          created_at: string
          description: string
          display_label: string
          display_order: number
          eligible_testing_service_keys: string[]
          id: number
          negative_examples: string[]
          positive_examples: string[]
          shop_id: number
          slug: string
          synonyms: string[]
          updated_at: string
          updated_by_name: string | null
          updated_by_oauth_client_id: string | null
        }
        Insert: {
          active?: boolean
          category: string
          created_at?: string
          description?: string
          display_label: string
          display_order?: number
          eligible_testing_service_keys?: string[]
          id?: number
          negative_examples?: string[]
          positive_examples?: string[]
          shop_id: number
          slug: string
          synonyms?: string[]
          updated_at?: string
          updated_by_name?: string | null
          updated_by_oauth_client_id?: string | null
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          description?: string
          display_label?: string
          display_order?: number
          eligible_testing_service_keys?: string[]
          id?: number
          negative_examples?: string[]
          positive_examples?: string[]
          shop_id?: number
          slug?: string
          synonyms?: string[]
          updated_at?: string
          updated_by_name?: string | null
          updated_by_oauth_client_id?: string | null
        }
        Relationships: []
      }
      customer_chat_messages: {
        Row: {
          created_at: string
          id: string
          parts: Json
          role: string
          session_id: string
          shop_id: number
        }
        Insert: {
          created_at?: string
          id: string
          parts: Json
          role: string
          session_id: string
          shop_id: number
        }
        Update: {
          created_at?: string
          id?: string
          parts?: Json
          role?: string
          session_id?: string
          shop_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "customer_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_chat_sessions: {
        Row: {
          abandoned_at: string | null
          additional_routine_services_round2: string[] | null
          appointment_confirmed_at: string | null
          appointment_date: string | null
          appointment_id: number | null
          appointment_time: string | null
          appointment_type: string | null
          appointment_verification_diff: Json | null
          appointment_verification_status: string | null
          approved_testing_services: string[] | null
          channel: string
          clarification_questions_answered: Json | null
          clarification_questions_pending: Json | null
          completed_at: string | null
          cookie_session: string | null
          current_step: string | null
          customer_id: number | null
          customer_notes_approved: boolean | null
          customer_notes_edit_attempts: number
          customer_notes_text: string | null
          customer_question: string | null
          customer_question_forwarded: boolean
          customer_self_identified: string | null
          declined_testing_services: string[] | null
          diagnostic_processing_complete: boolean
          edited_address: Json | null
          edited_emails: Json | null
          edited_phones: Json | null
          ended_at: string | null
          entered_first_name: string | null
          entered_last_name: string | null
          escalated_at: string | null
          escalation_reason: string | null
          explanation_required_items: Json | null
          greeting_answered_at: string | null
          hold_token: string | null
          id: string
          identity_verification_level: string | null
          is_returning_customer: boolean | null
          last_active_at: string
          new_vehicle_info: Json | null
          opted_out_at: string | null
          otp_attempts: number
          otp_sent_at: string | null
          otp_verified_at: string | null
          outcome: string | null
          pending_candidates: Json | null
          phone_e164: string | null
          primary_email_for_description: string | null
          recommended_testing_services: Json | null
          selected_simple_services: string[] | null
          sentiment: string | null
          shop_id: number
          started_at: string
          status: string
          summary_edit_attempts: number
          vehicle_id: number | null
          verified_first_name: string | null
          verified_last_name: string | null
        }
        Insert: {
          abandoned_at?: string | null
          additional_routine_services_round2?: string[] | null
          appointment_confirmed_at?: string | null
          appointment_date?: string | null
          appointment_id?: number | null
          appointment_time?: string | null
          appointment_type?: string | null
          appointment_verification_diff?: Json | null
          appointment_verification_status?: string | null
          approved_testing_services?: string[] | null
          channel: string
          clarification_questions_answered?: Json | null
          clarification_questions_pending?: Json | null
          completed_at?: string | null
          cookie_session?: string | null
          current_step?: string | null
          customer_id?: number | null
          customer_notes_approved?: boolean | null
          customer_notes_edit_attempts?: number
          customer_notes_text?: string | null
          customer_question?: string | null
          customer_question_forwarded?: boolean
          customer_self_identified?: string | null
          declined_testing_services?: string[] | null
          diagnostic_processing_complete?: boolean
          edited_address?: Json | null
          edited_emails?: Json | null
          edited_phones?: Json | null
          ended_at?: string | null
          entered_first_name?: string | null
          entered_last_name?: string | null
          escalated_at?: string | null
          escalation_reason?: string | null
          explanation_required_items?: Json | null
          greeting_answered_at?: string | null
          hold_token?: string | null
          id?: string
          identity_verification_level?: string | null
          is_returning_customer?: boolean | null
          last_active_at?: string
          new_vehicle_info?: Json | null
          opted_out_at?: string | null
          otp_attempts?: number
          otp_sent_at?: string | null
          otp_verified_at?: string | null
          outcome?: string | null
          pending_candidates?: Json | null
          phone_e164?: string | null
          primary_email_for_description?: string | null
          recommended_testing_services?: Json | null
          selected_simple_services?: string[] | null
          sentiment?: string | null
          shop_id: number
          started_at?: string
          status?: string
          summary_edit_attempts?: number
          vehicle_id?: number | null
          verified_first_name?: string | null
          verified_last_name?: string | null
        }
        Update: {
          abandoned_at?: string | null
          additional_routine_services_round2?: string[] | null
          appointment_confirmed_at?: string | null
          appointment_date?: string | null
          appointment_id?: number | null
          appointment_time?: string | null
          appointment_type?: string | null
          appointment_verification_diff?: Json | null
          appointment_verification_status?: string | null
          approved_testing_services?: string[] | null
          channel?: string
          clarification_questions_answered?: Json | null
          clarification_questions_pending?: Json | null
          completed_at?: string | null
          cookie_session?: string | null
          current_step?: string | null
          customer_id?: number | null
          customer_notes_approved?: boolean | null
          customer_notes_edit_attempts?: number
          customer_notes_text?: string | null
          customer_question?: string | null
          customer_question_forwarded?: boolean
          customer_self_identified?: string | null
          declined_testing_services?: string[] | null
          diagnostic_processing_complete?: boolean
          edited_address?: Json | null
          edited_emails?: Json | null
          edited_phones?: Json | null
          ended_at?: string | null
          entered_first_name?: string | null
          entered_last_name?: string | null
          escalated_at?: string | null
          escalation_reason?: string | null
          explanation_required_items?: Json | null
          greeting_answered_at?: string | null
          hold_token?: string | null
          id?: string
          identity_verification_level?: string | null
          is_returning_customer?: boolean | null
          last_active_at?: string
          new_vehicle_info?: Json | null
          opted_out_at?: string | null
          otp_attempts?: number
          otp_sent_at?: string | null
          otp_verified_at?: string | null
          outcome?: string | null
          pending_candidates?: Json | null
          phone_e164?: string | null
          primary_email_for_description?: string | null
          recommended_testing_services?: Json | null
          selected_simple_services?: string[] | null
          sentiment?: string | null
          shop_id?: number
          started_at?: string
          status?: string
          summary_edit_attempts?: number
          vehicle_id?: number | null
          verified_first_name?: string | null
          verified_last_name?: string | null
        }
        Relationships: []
      }
      keytag_audit_log: {
        Row: {
          action: string
          id: number
          manual_review_code: string | null
          new_status: string | null
          occurred_at: string
          prior_status: string | null
          reason: string | null
          ro_id: number | null
          ro_number: number | null
          source: string
          tag_color: string | null
          tag_number: number | null
          tekmetric_patch_error: string | null
          tekmetric_patch_ok: boolean | null
          user_label: string | null
        }
        Insert: {
          action: string
          id?: number
          manual_review_code?: string | null
          new_status?: string | null
          occurred_at?: string
          prior_status?: string | null
          reason?: string | null
          ro_id?: number | null
          ro_number?: number | null
          source: string
          tag_color?: string | null
          tag_number?: number | null
          tekmetric_patch_error?: string | null
          tekmetric_patch_ok?: boolean | null
          user_label?: string | null
        }
        Update: {
          action?: string
          id?: number
          manual_review_code?: string | null
          new_status?: string | null
          occurred_at?: string
          prior_status?: string | null
          reason?: string | null
          ro_id?: number | null
          ro_number?: number | null
          source?: string
          tag_color?: string | null
          tag_number?: number | null
          tekmetric_patch_error?: string | null
          tekmetric_patch_ok?: boolean | null
          user_label?: string | null
        }
        Relationships: []
      }
      keytag_confirmation_tokens: {
        Row: {
          action_kind: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          scope_hash: string
          scope_summary: string
          user_label: string
        }
        Insert: {
          action_kind: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          scope_hash: string
          scope_summary: string
          user_label: string
        }
        Update: {
          action_kind?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          scope_hash?: string
          scope_summary?: string
          user_label?: string
        }
        Relationships: []
      }
      keytag_cursor: {
        Row: {
          id: number
          last_color: string
          last_number: number
          updated_at: string
        }
        Insert: {
          id?: number
          last_color?: string
          last_number?: number
          updated_at?: string
        }
        Update: {
          id?: number
          last_color?: string
          last_number?: number
          updated_at?: string
        }
        Relationships: []
      }
      keytag_manual_review_attempts: {
        Row: {
          attempted_at: string
          attempted_code: string
          failure_reason: string | null
          id: number
          success: boolean
          user_label: string
        }
        Insert: {
          attempted_at?: string
          attempted_code: string
          failure_reason?: string | null
          id?: number
          success: boolean
          user_label: string
        }
        Update: {
          attempted_at?: string
          attempted_code?: string
          failure_reason?: string | null
          id?: number
          success?: boolean
          user_label?: string
        }
        Relationships: []
      }
      keytag_manual_reviews: {
        Row: {
          category: string
          code: string
          context: Json
          email_error: string | null
          email_sent_at: string | null
          id: number
          issue_summary: string
          issued_at: string
          options: Json
          resolution_audit_log_id: number | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by_user_label: string | null
          resolved_choice: string | null
          resolved_color: string | null
          resolved_tag_number: number | null
        }
        Insert: {
          category: string
          code: string
          context: Json
          email_error?: string | null
          email_sent_at?: string | null
          id?: number
          issue_summary: string
          issued_at?: string
          options: Json
          resolution_audit_log_id?: number | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by_user_label?: string | null
          resolved_choice?: string | null
          resolved_color?: string | null
          resolved_tag_number?: number | null
        }
        Update: {
          category?: string
          code?: string
          context?: Json
          email_error?: string | null
          email_sent_at?: string | null
          id?: number
          issue_summary?: string
          issued_at?: string
          options?: Json
          resolution_audit_log_id?: number | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by_user_label?: string | null
          resolved_choice?: string | null
          resolved_color?: string | null
          resolved_tag_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "keytag_manual_reviews_resolution_audit_log_id_fkey"
            columns: ["resolution_audit_log_id"]
            isOneToOne: false
            referencedRelation: "keytag_audit_log"
            referencedColumns: ["id"]
          },
        ]
      }
      keytag_webhook_events: {
        Row: {
          error_message: string | null
          event_hash: string | null
          event_kind: string
          event_text: string | null
          id: string
          idempotency_active: boolean
          payment_id: number | null
          processed_at: string | null
          processing_detail: Json | null
          processing_result: string | null
          raw_body: Json | null
          raw_headers: Json | null
          received_at: string
          status_id: number | null
          tekmetric_ro_id: number | null
        }
        Insert: {
          error_message?: string | null
          event_hash?: string | null
          event_kind: string
          event_text?: string | null
          id?: string
          idempotency_active?: boolean
          payment_id?: number | null
          processed_at?: string | null
          processing_detail?: Json | null
          processing_result?: string | null
          raw_body?: Json | null
          raw_headers?: Json | null
          received_at?: string
          status_id?: number | null
          tekmetric_ro_id?: number | null
        }
        Update: {
          error_message?: string | null
          event_hash?: string | null
          event_kind?: string
          event_text?: string | null
          id?: string
          idempotency_active?: boolean
          payment_id?: number | null
          processed_at?: string | null
          processing_detail?: Json | null
          processing_result?: string | null
          raw_body?: Json | null
          raw_headers?: Json | null
          received_at?: string
          status_id?: number | null
          tekmetric_ro_id?: number | null
        }
        Relationships: []
      }
      keytags: {
        Row: {
          advisor_id: number | null
          assigned_at: string | null
          changed_by_user_label: string | null
          customer_id: number | null
          last_activity_at: string | null
          last_patch_at: string | null
          last_patch_error: string | null
          last_patch_success: boolean | null
          posted_at: string | null
          released_at: string | null
          ro_id: number | null
          ro_number: number | null
          status: string
          tag_color: string
          tag_number: number
          technician_id: number | null
          updated_at: string
          vehicle_id: number | null
        }
        Insert: {
          advisor_id?: number | null
          assigned_at?: string | null
          changed_by_user_label?: string | null
          customer_id?: number | null
          last_activity_at?: string | null
          last_patch_at?: string | null
          last_patch_error?: string | null
          last_patch_success?: boolean | null
          posted_at?: string | null
          released_at?: string | null
          ro_id?: number | null
          ro_number?: number | null
          status?: string
          tag_color: string
          tag_number: number
          technician_id?: number | null
          updated_at?: string
          vehicle_id?: number | null
        }
        Update: {
          advisor_id?: number | null
          assigned_at?: string | null
          changed_by_user_label?: string | null
          customer_id?: number | null
          last_activity_at?: string | null
          last_patch_at?: string | null
          last_patch_error?: string | null
          last_patch_success?: boolean | null
          posted_at?: string | null
          released_at?: string | null
          ro_id?: number | null
          ro_number?: number | null
          status?: string
          tag_color?: string
          tag_number?: number
          technician_id?: number | null
          updated_at?: string
          vehicle_id?: number | null
        }
        Relationships: []
      }
      oauth_access_tokens: {
        Row: {
          client_id: string
          expires_at: string
          issued_at: string
          last_used_at: string | null
          resource: string | null
          revoked_at: string | null
          scope: string
          token_hash: string
          user_label: string
        }
        Insert: {
          client_id: string
          expires_at: string
          issued_at?: string
          last_used_at?: string | null
          resource?: string | null
          revoked_at?: string | null
          scope: string
          token_hash: string
          user_label: string
        }
        Update: {
          client_id?: string
          expires_at?: string
          issued_at?: string
          last_used_at?: string | null
          resource?: string | null
          revoked_at?: string | null
          scope?: string
          token_hash?: string
          user_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_access_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_authorization_codes: {
        Row: {
          client_id: string
          code_challenge: string
          code_challenge_method: string
          code_hash: string
          created_at: string
          expires_at: string
          redirect_uri: string
          resource: string | null
          scope: string
          used_at: string | null
          user_label: string
        }
        Insert: {
          client_id: string
          code_challenge: string
          code_challenge_method: string
          code_hash: string
          created_at?: string
          expires_at: string
          redirect_uri: string
          resource?: string | null
          scope: string
          used_at?: string | null
          user_label: string
        }
        Update: {
          client_id?: string
          code_challenge?: string
          code_challenge_method?: string
          code_hash?: string
          created_at?: string
          expires_at?: string
          redirect_uri?: string
          resource?: string | null
          scope?: string
          used_at?: string | null
          user_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_authorization_codes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_clients: {
        Row: {
          active: boolean
          client_name: string
          client_secret_hash: string | null
          created_at: string
          dynamically_registered: boolean
          grant_types: string[]
          id: string
          redirect_uris: string[]
          registration_access_token_hash: string | null
          response_types: string[]
          scope: string
          token_endpoint_auth_method: string
        }
        Insert: {
          active?: boolean
          client_name?: string
          client_secret_hash?: string | null
          created_at?: string
          dynamically_registered?: boolean
          grant_types?: string[]
          id: string
          redirect_uris: string[]
          registration_access_token_hash?: string | null
          response_types?: string[]
          scope?: string
          token_endpoint_auth_method?: string
        }
        Update: {
          active?: boolean
          client_name?: string
          client_secret_hash?: string | null
          created_at?: string
          dynamically_registered?: boolean
          grant_types?: string[]
          id?: string
          redirect_uris?: string[]
          registration_access_token_hash?: string | null
          response_types?: string[]
          scope?: string
          token_endpoint_auth_method?: string
        }
        Relationships: []
      }
      oauth_refresh_tokens: {
        Row: {
          client_id: string
          expires_at: string
          issued_at: string
          last_used_at: string | null
          parent_token_hash: string | null
          resource: string | null
          revoked_at: string | null
          scope: string
          token_hash: string
          user_label: string
        }
        Insert: {
          client_id: string
          expires_at: string
          issued_at?: string
          last_used_at?: string | null
          parent_token_hash?: string | null
          resource?: string | null
          revoked_at?: string | null
          scope: string
          token_hash: string
          user_label: string
        }
        Update: {
          client_id?: string
          expires_at?: string
          issued_at?: string
          last_used_at?: string | null
          parent_token_hash?: string | null
          resource?: string | null
          revoked_at?: string | null
          scope?: string
          token_hash?: string
          user_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_refresh_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_refresh_tokens_parent_token_hash_fkey"
            columns: ["parent_token_hash"]
            isOneToOne: false
            referencedRelation: "oauth_refresh_tokens"
            referencedColumns: ["token_hash"]
          },
        ]
      }
      orchestrator_runs: {
        Row: {
          ended_at: string | null
          error_message: string | null
          final_response: Json | null
          id: string
          latency_ms: number | null
          model: string | null
          session_id: string | null
          started_at: string
          status: string
          total_cost_cents: number | null
          total_tokens_in: number | null
          total_tokens_out: number | null
          user_intent: string
          user_params: Json | null
        }
        Insert: {
          ended_at?: string | null
          error_message?: string | null
          final_response?: Json | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          session_id?: string | null
          started_at?: string
          status?: string
          total_cost_cents?: number | null
          total_tokens_in?: number | null
          total_tokens_out?: number | null
          user_intent: string
          user_params?: Json | null
        }
        Update: {
          ended_at?: string | null
          error_message?: string | null
          final_response?: Json | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          session_id?: string | null
          started_at?: string
          status?: string
          total_cost_cents?: number | null
          total_tokens_in?: number | null
          total_tokens_out?: number | null
          user_intent?: string
          user_params?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "orchestrator_runs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      otp_codes: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          ip_addr: unknown
          phone_e164: string
          salt: string
          shop_id: number
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          ip_addr?: unknown
          phone_e164: string
          salt: string
          shop_id: number
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          ip_addr?: unknown
          phone_e164?: string
          salt?: string
          shop_id?: number
        }
        Relationships: []
      }
      routine_services: {
        Row: {
          abbreviation: string
          active: boolean
          concern_categories: string[] | null
          created_at: string
          description: string | null
          display_name: string
          display_order: number
          id: string
          price_waived_note: string | null
          requires_explanation: boolean
          service_key: string
          shop_id: number
          starting_price_cents: number | null
          updated_at: string
          updated_by_name: string | null
          updated_by_oauth_client_id: string | null
          wait_eligible: boolean
        }
        Insert: {
          abbreviation: string
          active?: boolean
          concern_categories?: string[] | null
          created_at?: string
          description?: string | null
          display_name: string
          display_order: number
          id?: string
          price_waived_note?: string | null
          requires_explanation?: boolean
          service_key: string
          shop_id: number
          starting_price_cents?: number | null
          updated_at?: string
          updated_by_name?: string | null
          updated_by_oauth_client_id?: string | null
          wait_eligible?: boolean
        }
        Update: {
          abbreviation?: string
          active?: boolean
          concern_categories?: string[] | null
          created_at?: string
          description?: string | null
          display_name?: string
          display_order?: number
          id?: string
          price_waived_note?: string | null
          requires_explanation?: boolean
          service_key?: string
          shop_id?: number
          starting_price_cents?: number | null
          updated_at?: string
          updated_by_name?: string | null
          updated_by_oauth_client_id?: string | null
          wait_eligible?: boolean
        }
        Relationships: []
      }
      scheduler_admin_audit_log: {
        Row: {
          diff_summary: Json | null
          error_message: string | null
          id: number
          md_content_hash: string | null
          oauth_client_id: string | null
          occurred_at: string
          operation: string
          pre_state_snapshot: Json | null
          rows_added: number
          rows_deactivated: number
          rows_modified: number
          snapshot_pruned_at: string | null
          table_name: string
          user_label: string | null
        }
        Insert: {
          diff_summary?: Json | null
          error_message?: string | null
          id?: number
          md_content_hash?: string | null
          oauth_client_id?: string | null
          occurred_at?: string
          operation: string
          pre_state_snapshot?: Json | null
          rows_added?: number
          rows_deactivated?: number
          rows_modified?: number
          snapshot_pruned_at?: string | null
          table_name: string
          user_label?: string | null
        }
        Update: {
          diff_summary?: Json | null
          error_message?: string | null
          id?: number
          md_content_hash?: string | null
          oauth_client_id?: string | null
          occurred_at?: string
          operation?: string
          pre_state_snapshot?: Json | null
          rows_added?: number
          rows_deactivated?: number
          rows_modified?: number
          snapshot_pruned_at?: string | null
          table_name?: string
          user_label?: string | null
        }
        Relationships: []
      }
      scheduler_audit_log: {
        Row: {
          error_message: string | null
          event_detail: Json | null
          event_type: string
          id: number
          input_tokens: number | null
          latency_ms: number | null
          model_used: string | null
          occurred_at: string
          output_tokens: number | null
          router_decision: string | null
          session_id: string
          step: string
        }
        Insert: {
          error_message?: string | null
          event_detail?: Json | null
          event_type: string
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model_used?: string | null
          occurred_at?: string
          output_tokens?: number | null
          router_decision?: string | null
          session_id: string
          step: string
        }
        Update: {
          error_message?: string | null
          event_detail?: Json | null
          event_type?: string
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model_used?: string | null
          occurred_at?: string
          output_tokens?: number | null
          router_decision?: string | null
          session_id?: string
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduler_audit_log_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "customer_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduler_error_log: {
        Row: {
          context: Json | null
          error_code: string | null
          id: number
          level: string
          message: string | null
          occurred_at: string
          origin: string
          origin_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          session_id: string | null
          stack: string | null
          step_at_error: string | null
          surface: string
        }
        Insert: {
          context?: Json | null
          error_code?: string | null
          id?: number
          level?: string
          message?: string | null
          occurred_at?: string
          origin: string
          origin_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          session_id?: string | null
          stack?: string | null
          step_at_error?: string | null
          surface: string
        }
        Update: {
          context?: Json | null
          error_code?: string | null
          id?: number
          level?: string
          message?: string | null
          occurred_at?: string
          origin?: string
          origin_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          session_id?: string | null
          stack?: string | null
          step_at_error?: string | null
          surface?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduler_error_log_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "customer_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sentry_webhook_events: {
        Row: {
          action: string | null
          actor_id: string | null
          actor_name: string | null
          actor_type: string | null
          hook_timestamp: string | null
          id: number
          ingest_error: string | null
          installation_uuid: string | null
          payload: Json
          processed_at: string | null
          raw_headers: Json | null
          received_at: string
          request_id: string | null
          resource: string
          signature_header: string | null
          signature_verified: boolean
        }
        Insert: {
          action?: string | null
          actor_id?: string | null
          actor_name?: string | null
          actor_type?: string | null
          hook_timestamp?: string | null
          id?: number
          ingest_error?: string | null
          installation_uuid?: string | null
          payload: Json
          processed_at?: string | null
          raw_headers?: Json | null
          received_at?: string
          request_id?: string | null
          resource: string
          signature_header?: string | null
          signature_verified: boolean
        }
        Update: {
          action?: string | null
          actor_id?: string | null
          actor_name?: string | null
          actor_type?: string | null
          hook_timestamp?: string | null
          id?: number
          ingest_error?: string | null
          installation_uuid?: string | null
          payload?: Json
          processed_at?: string | null
          raw_headers?: Json | null
          received_at?: string
          request_id?: string | null
          resource?: string
          signature_header?: string | null
          signature_verified?: boolean
        }
        Relationships: []
      }
      service_dept_users: {
        Row: {
          active: boolean
          created_at: string
          display_name: string
          email: string | null
          id: string
          oauth_client_id: string
          role: string
          shop_id: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name: string
          email?: string | null
          id?: string
          oauth_client_id: string
          role?: string
          shop_id: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          oauth_client_id?: string
          role?: string
          shop_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      tekmetric_webhook_events: {
        Row: {
          error_message: string | null
          event_hash: string | null
          event_kind_inferred: string | null
          event_text: string | null
          event_type: string | null
          id: string
          idempotency_active: boolean
          processed_at: string | null
          processing_results: Json | null
          raw_body: Json | null
          raw_headers: Json | null
          raw_query_string: string | null
          received_at: string
          status_id: number | null
          tekmetric_appointment_id: number | null
          tekmetric_customer_id: number | null
          tekmetric_payment_id: number | null
          tekmetric_ro_id: number | null
          tekmetric_shop_id: number | null
          tekmetric_vehicle_id: number | null
        }
        Insert: {
          error_message?: string | null
          event_hash?: string | null
          event_kind_inferred?: string | null
          event_text?: string | null
          event_type?: string | null
          id?: string
          idempotency_active?: boolean
          processed_at?: string | null
          processing_results?: Json | null
          raw_body?: Json | null
          raw_headers?: Json | null
          raw_query_string?: string | null
          received_at?: string
          status_id?: number | null
          tekmetric_appointment_id?: number | null
          tekmetric_customer_id?: number | null
          tekmetric_payment_id?: number | null
          tekmetric_ro_id?: number | null
          tekmetric_shop_id?: number | null
          tekmetric_vehicle_id?: number | null
        }
        Update: {
          error_message?: string | null
          event_hash?: string | null
          event_kind_inferred?: string | null
          event_text?: string | null
          event_type?: string | null
          id?: string
          idempotency_active?: boolean
          processed_at?: string | null
          processing_results?: Json | null
          raw_body?: Json | null
          raw_headers?: Json | null
          raw_query_string?: string | null
          received_at?: string
          status_id?: number | null
          tekmetric_appointment_id?: number | null
          tekmetric_customer_id?: number | null
          tekmetric_payment_id?: number | null
          tekmetric_ro_id?: number | null
          tekmetric_shop_id?: number | null
          tekmetric_vehicle_id?: number | null
        }
        Relationships: []
      }
      testing_services: {
        Row: {
          abbreviation: string
          active: boolean
          concern_categories: string[] | null
          created_at: string
          description: string | null
          display_name: string
          example_keywords: string[] | null
          id: string
          notes: string | null
          service_key: string
          shop_id: number
          starting_price_cents: number
          updated_at: string
          updated_by_name: string | null
          updated_by_oauth_client_id: string | null
        }
        Insert: {
          abbreviation: string
          active?: boolean
          concern_categories?: string[] | null
          created_at?: string
          description?: string | null
          display_name: string
          example_keywords?: string[] | null
          id?: string
          notes?: string | null
          service_key: string
          shop_id: number
          starting_price_cents: number
          updated_at?: string
          updated_by_name?: string | null
          updated_by_oauth_client_id?: string | null
        }
        Update: {
          abbreviation?: string
          active?: boolean
          concern_categories?: string[] | null
          created_at?: string
          description?: string | null
          display_name?: string
          example_keywords?: string[] | null
          id?: string
          notes?: string | null
          service_key?: string
          shop_id?: number
          starting_price_cents?: number
          updated_at?: string
          updated_by_name?: string | null
          updated_by_oauth_client_id?: string | null
        }
        Relationships: []
      }
      tool_calls: {
        Row: {
          ended_at: string | null
          error_message: string | null
          id: string
          input: Json | null
          latency_ms: number | null
          output: Json | null
          output_truncated: boolean
          run_id: string
          started_at: string
          step_number: number | null
          tool_name: string
        }
        Insert: {
          ended_at?: string | null
          error_message?: string | null
          id?: string
          input?: Json | null
          latency_ms?: number | null
          output?: Json | null
          output_truncated?: boolean
          run_id: string
          started_at?: string
          step_number?: number | null
          tool_name: string
        }
        Update: {
          ended_at?: string | null
          error_message?: string | null
          id?: string
          input?: Json | null
          latency_ms?: number | null
          output?: Json | null
          output_truncated?: boolean
          run_id?: string
          started_at?: string
          step_number?: number | null
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_calls_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "orchestrator_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      transcript_emails: {
        Row: {
          attempts: number
          created_at: string
          id: string
          last_error: string | null
          resend_id: string | null
          sent_at: string | null
          session_id: string
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          resend_id?: string | null
          sent_at?: string | null
          session_id: string
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          resend_id?: string | null
          sent_at?: string | null
          session_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcript_emails_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "customer_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_wizard_transition: {
        Args: {
          p_assistant_bubble_text?: string
          p_chat_id: string
          p_payload: Json
          p_user_bubble_text?: string
        }
        Returns: Json
      }
      assign_next_keytag: {
        Args: {
          p_advisor_id?: number
          p_customer_id?: number
          p_last_activity_at?: string
          p_ro_id: number
          p_ro_number: number
          p_technician_id?: number
          p_vehicle_id?: number
        }
        Returns: {
          tag_color: string
          tag_number: number
        }[]
      }
      attach_resolution_audit_log: {
        Args: { p_audit_log_id: number; p_review_id: number }
        Returns: undefined
      }
      check_manual_review_lockout: {
        Args: { p_user_label: string }
        Returns: boolean
      }
      consume_keytag_confirmation_token: {
        Args: {
          p_action_kind: string
          p_scope_hash: string
          p_token_id: string
          p_user_label: string
        }
        Returns: {
          failure_reason: string
          ok: boolean
          scope_summary: string
        }[]
      }
      create_keytag_confirmation_token: {
        Args: {
          p_action_kind: string
          p_scope_hash: string
          p_scope_summary: string
          p_user_label: string
        }
        Returns: {
          expires_at: string
          token_id: string
        }[]
      }
      create_manual_review: {
        Args: {
          p_audit_source?: string
          p_category: string
          p_context: Json
          p_issue_summary: string
          p_options: Json
          p_prefix: string
          p_ro_id?: number
          p_ro_number?: number
          p_tag_color?: string
          p_tag_number?: number
        }
        Returns: {
          audit_log_id: number
          code: string
          review_id: number
        }[]
      }
      cron_unschedule_if_exists: {
        Args: { p_jobname: string }
        Returns: undefined
      }
      force_assign_keytag: {
        Args: {
          p_advisor_id?: number
          p_customer_id?: number
          p_ro_id: number
          p_ro_number: number
          p_tag_color: string
          p_tag_number: number
          p_technician_id?: number
          p_vehicle_id?: number
        }
        Returns: {
          error_code: string
          tag_color: string
          tag_number: number
        }[]
      }
      generate_manual_review_code: {
        Args: { p_prefix: string }
        Returns: string
      }
      hold_waiter_slot: {
        Args: {
          p_appointment_type: string
          p_customer_id: number
          p_scheduled_date: string
          p_scheduled_time: string
          p_service_summary: string
          p_session_id: string
          p_shop_id: number
          p_vehicle_id: number
        }
        Returns: {
          expires_at: string
          hold_id: string
          ok: boolean
          reason: string
        }[]
      }
      hydrate_session_reset: { Args: { p_chat_id: string }; Returns: Json }
      log_keytag_audit: {
        Args: {
          p_action: string
          p_new_status?: string
          p_prior_status?: string
          p_reason?: string
          p_ro_id?: number
          p_ro_number?: number
          p_source: string
          p_tag_color: string
          p_tag_number: number
          p_tekmetric_patch_error?: string
          p_tekmetric_patch_ok?: boolean
          p_user_label?: string
        }
        Returns: number
      }
      lookup_manual_review: {
        Args: { p_code: string; p_user_label: string }
        Returns: {
          category: string
          context: Json
          failure_reason: string
          issue_summary: string
          issued_at: string
          ok: boolean
          options: Json
          resolved_at: string
          resolved_choice: string
        }[]
      }
      mark_keytag_posted: {
        Args: {
          p_last_activity_at?: string
          p_posted_at?: string
          p_ro_id: number
        }
        Returns: {
          tag_color: string
          tag_number: number
        }[]
      }
      mark_manual_review_email_sent: {
        Args: { p_error?: string; p_review_id: number }
        Returns: undefined
      }
      oauth_consume_refresh_token: {
        Args: { p_token_hash: string }
        Returns: {
          client_id: string
          resource: string
          scope: string
          user_label: string
        }[]
      }
      oauth_validate_access_token: {
        Args: { p_token_hash: string }
        Returns: {
          client_id: string
          resource: string
          scope: string
          user_label: string
        }[]
      }
      record_keytag_patched: {
        Args: { p_error?: string; p_ro_id: number; p_success: boolean }
        Returns: undefined
      }
      release_keytag_as_orphan: {
        Args: { p_reason: string; p_ro_id: number }
        Returns: {
          prior_customer_id: number
          prior_ro_number: number
          prior_status: string
          prior_vehicle_id: number
          tag_color: string
          tag_number: number
        }[]
      }
      release_keytag_for_ro: {
        Args: { p_reason?: string; p_ro_id: number }
        Returns: {
          tag_color: string
          tag_number: number
        }[]
      }
      resolve_manual_review: {
        Args: {
          p_choice: string
          p_code: string
          p_color?: string
          p_notes?: string
          p_tag_number?: number
          p_user_label: string
        }
        Returns: {
          category: string
          chosen_option: Json
          context: Json
          failure_reason: string
          ok: boolean
          review_id: number
        }[]
      }
      revert_keytag_to_assigned: {
        Args: { p_last_activity_at?: string; p_ro_id: number }
        Returns: {
          prior_status: string
          tag_color: string
          tag_number: number
        }[]
      }
      run_admin_snapshot_prune: { Args: never; Returns: undefined }
      run_keytag_bulk_reconcile_with_checkin: {
        Args: never
        Returns: undefined
      }
      run_keytag_daily_report_with_checkin: { Args: never; Returns: undefined }
      run_scheduler_appointments_sync_with_checkin: {
        Args: never
        Returns: undefined
      }
      run_scheduler_transcript_dispatcher_with_checkin: {
        Args: never
        Returns: undefined
      }
      scheduler_get_service_role_key: { Args: never; Returns: string }
      scheduler_invoke_edge_function: {
        Args: { p_body?: Json; p_function_name: string }
        Returns: number
      }
      scheduler_shop_now: { Args: never; Returns: Json }
      sentry_cron_checkin: {
        Args: {
          p_check_in_id?: string
          p_monitor_config?: Json
          p_monitor_slug: string
          p_status: string
        }
        Returns: string
      }
      tekmetric_get_secret: { Args: { p_name: string }; Returns: string }
      tekmetric_set_secret: {
        Args: { p_description?: string; p_name: string; p_value: string }
        Returns: undefined
      }
      touch_keytag_activity: {
        Args: { p_last_activity_at: string; p_ro_id: number }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
