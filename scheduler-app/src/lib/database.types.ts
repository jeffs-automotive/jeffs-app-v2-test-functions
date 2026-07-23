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
          contact_source: string | null
          contact_synced_at: string | null
          created_at: string
          created_date: string | null
          customer_email: string | null
          customer_first_name: string | null
          customer_id: number | null
          customer_phone_e164: string | null
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
          contact_source?: string | null
          contact_synced_at?: string | null
          created_at?: string
          created_date?: string | null
          customer_email?: string | null
          customer_first_name?: string | null
          customer_id?: number | null
          customer_phone_e164?: string | null
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
          contact_source?: string | null
          contact_synced_at?: string | null
          created_at?: string
          created_date?: string | null
          customer_email?: string | null
          customer_first_name?: string | null
          customer_id?: number | null
          customer_phone_e164?: string | null
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
      back_office_issue_events: {
        Row: {
          action: string
          actor: string | null
          actor_app: string | null
          email_error: string | null
          email_sent_at: string | null
          id: number
          issue_id: string
          new_status: string | null
          note: string | null
          occurred_at: string
          prior_status: string | null
        }
        Insert: {
          action: string
          actor?: string | null
          actor_app?: string | null
          email_error?: string | null
          email_sent_at?: string | null
          id?: number
          issue_id: string
          new_status?: string | null
          note?: string | null
          occurred_at?: string
          prior_status?: string | null
        }
        Update: {
          action?: string
          actor?: string | null
          actor_app?: string | null
          email_error?: string | null
          email_sent_at?: string | null
          id?: number
          issue_id?: string
          new_status?: string | null
          note?: string | null
          occurred_at?: string
          prior_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "back_office_issue_events_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "back_office_issues"
            referencedColumns: ["id"]
          },
        ]
      }
      back_office_issues: {
        Row: {
          bill_date: string | null
          bill_no: string | null
          bo_notes: string | null
          context: Json
          created_at: string
          created_by: string | null
          id: string
          kind: string
          last_activity_at: string
          qbo_txn_id: string | null
          qbo_txn_type: string | null
          realm_id: string | null
          ro_number: string | null
          sa_notes: string | null
          sa_submitted_at: string | null
          sent_to_sa_at: string | null
          shop_id: number
          source: string
          status: string
          tekmetric_ro_id: number | null
          title: string | null
          total_cents: number | null
          updated_at: string
          vendor_name: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          bill_date?: string | null
          bill_no?: string | null
          bo_notes?: string | null
          context?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          last_activity_at?: string
          qbo_txn_id?: string | null
          qbo_txn_type?: string | null
          realm_id?: string | null
          ro_number?: string | null
          sa_notes?: string | null
          sa_submitted_at?: string | null
          sent_to_sa_at?: string | null
          shop_id: number
          source: string
          status?: string
          tekmetric_ro_id?: number | null
          title?: string | null
          total_cents?: number | null
          updated_at?: string
          vendor_name?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          bill_date?: string | null
          bill_no?: string | null
          bo_notes?: string | null
          context?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          last_activity_at?: string
          qbo_txn_id?: string | null
          qbo_txn_type?: string | null
          realm_id?: string | null
          ro_number?: string | null
          sa_notes?: string | null
          sa_submitted_at?: string | null
          sent_to_sa_at?: string | null
          shop_id?: number
          source?: string
          status?: string
          tekmetric_ro_id?: number | null
          title?: string | null
          total_cents?: number | null
          updated_at?: string
          vendor_name?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "back_office_issues_conn_fk"
            columns: ["shop_id", "realm_id"]
            isOneToOne: false
            referencedRelation: "qbo_connections"
            referencedColumns: ["shop_id", "realm_id"]
          },
        ]
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
      concern_triage_chips: {
        Row: {
          active: boolean
          allowed_service_keys: string[]
          chip_key: string
          created_at: string
          display_label: string
          id: string
          maps_to_categories: string[]
          shop_id: number
          sort: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          allowed_service_keys?: string[]
          chip_key: string
          created_at?: string
          display_label: string
          id?: string
          maps_to_categories?: string[]
          shop_id: number
          sort?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          allowed_service_keys?: string[]
          chip_key?: string
          created_at?: string
          display_label?: string
          id?: string
          maps_to_categories?: string[]
          shop_id?: number
          sort?: number
          updated_at?: string
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
          appointment_sms_disclosure_version: string | null
          appointment_time: string | null
          appointment_type: string | null
          appointment_verification_diff: Json | null
          appointment_verification_status: string | null
          approved_testing_services: string[] | null
          channel: string
          clarification_questions_answered: Json | null
          clarification_questions_pending: Json | null
          completed_at: string | null
          concern_clarify_candidates: Json | null
          concern_triage_state: Json | null
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
          edit_return_step: string | null
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
          appointment_sms_disclosure_version?: string | null
          appointment_time?: string | null
          appointment_type?: string | null
          appointment_verification_diff?: Json | null
          appointment_verification_status?: string | null
          approved_testing_services?: string[] | null
          channel: string
          clarification_questions_answered?: Json | null
          clarification_questions_pending?: Json | null
          completed_at?: string | null
          concern_clarify_candidates?: Json | null
          concern_triage_state?: Json | null
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
          edit_return_step?: string | null
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
          appointment_sms_disclosure_version?: string | null
          appointment_time?: string | null
          appointment_type?: string | null
          appointment_verification_diff?: Json | null
          appointment_verification_status?: string | null
          approved_testing_services?: string[] | null
          channel?: string
          clarification_questions_answered?: Json | null
          clarification_questions_pending?: Json | null
          completed_at?: string | null
          concern_clarify_candidates?: Json | null
          concern_triage_state?: Json | null
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
          edit_return_step?: string | null
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
      document_intake_agent_state: {
        Row: {
          agent_version: string | null
          details: Json
          hostname: string
          last_config_fetch_at: string | null
          last_heartbeat_at: string | null
          last_upload_at: string | null
          shop_id: number | null
          updated_at: string
        }
        Insert: {
          agent_version?: string | null
          details?: Json
          hostname: string
          last_config_fetch_at?: string | null
          last_heartbeat_at?: string | null
          last_upload_at?: string | null
          shop_id?: number | null
          updated_at?: string
        }
        Update: {
          agent_version?: string | null
          details?: Json
          hostname?: string
          last_config_fetch_at?: string | null
          last_heartbeat_at?: string | null
          last_upload_at?: string | null
          shop_id?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      document_intake_cron_lease: {
        Row: {
          id: boolean
          locked_by: string | null
          locked_until: string
          updated_at: string
        }
        Insert: {
          id?: boolean
          locked_by?: string | null
          locked_until?: string
          updated_at?: string
        }
        Update: {
          id?: boolean
          locked_by?: string | null
          locked_until?: string
          updated_at?: string
        }
        Relationships: []
      }
      document_intake_error_log: {
        Row: {
          detail: Json | null
          error_code: string | null
          id: number
          level: string
          message: string | null
          occurred_at: string
          origin: string
          origin_id: string | null
        }
        Insert: {
          detail?: Json | null
          error_code?: string | null
          id?: number
          level?: string
          message?: string | null
          occurred_at?: string
          origin: string
          origin_id?: string | null
        }
        Update: {
          detail?: Json | null
          error_code?: string | null
          id?: number
          level?: string
          message?: string | null
          occurred_at?: string
          origin?: string
          origin_id?: string | null
        }
        Relationships: []
      }
      document_intake_files: {
        Row: {
          bucket: string
          created_at: string
          email_from: string | null
          email_subject: string | null
          error: string | null
          graph_attachment_id: string | null
          graph_message_id: string | null
          id: string
          linked_at: string | null
          linked_ref: Json | null
          mime_type: string | null
          object_path: string
          original_filename: string | null
          profile_key: string | null
          received_at: string
          sha256: string | null
          shop_id: number
          size_bytes: number | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          bucket: string
          created_at?: string
          email_from?: string | null
          email_subject?: string | null
          error?: string | null
          graph_attachment_id?: string | null
          graph_message_id?: string | null
          id?: string
          linked_at?: string | null
          linked_ref?: Json | null
          mime_type?: string | null
          object_path: string
          original_filename?: string | null
          profile_key?: string | null
          received_at?: string
          sha256?: string | null
          shop_id: number
          size_bytes?: number | null
          source: string
          status?: string
          updated_at?: string
        }
        Update: {
          bucket?: string
          created_at?: string
          email_from?: string | null
          email_subject?: string | null
          error?: string | null
          graph_attachment_id?: string | null
          graph_message_id?: string | null
          id?: string
          linked_at?: string | null
          linked_ref?: Json | null
          mime_type?: string | null
          object_path?: string
          original_filename?: string | null
          profile_key?: string | null
          received_at?: string
          sha256?: string | null
          shop_id?: number
          size_bytes?: number | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_intake_files_profile_key_fkey"
            columns: ["profile_key"]
            isOneToOne: false
            referencedRelation: "document_intake_profiles"
            referencedColumns: ["key"]
          },
        ]
      }
      document_intake_mailboxes: {
        Row: {
          address: string
          created_at: string
          id: string
          profile_key: string
        }
        Insert: {
          address: string
          created_at?: string
          id?: string
          profile_key: string
        }
        Update: {
          address?: string
          created_at?: string
          id?: string
          profile_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_intake_mailboxes_profile_key_fkey"
            columns: ["profile_key"]
            isOneToOne: false
            referencedRelation: "document_intake_profiles"
            referencedColumns: ["key"]
          },
        ]
      }
      document_intake_profiles: {
        Row: {
          active: boolean
          bucket: string
          created_at: string
          key: string
          label: string
          notes: string | null
          shop_id: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          bucket: string
          created_at?: string
          key: string
          label: string
          notes?: string | null
          shop_id: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          bucket?: string
          created_at?: string
          key?: string
          label?: string
          notes?: string | null
          shop_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      graph_mail_attachments: {
        Row: {
          attempts: number
          created_at: string
          event_id: string
          filename: string | null
          graph_attachment_id: string
          id: string
          is_inline: boolean
          last_error: string | null
          mime_type: string | null
          object_path: string | null
          size_bytes: number | null
          skip_reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          event_id: string
          filename?: string | null
          graph_attachment_id: string
          id?: string
          is_inline?: boolean
          last_error?: string | null
          mime_type?: string | null
          object_path?: string | null
          size_bytes?: number | null
          skip_reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          event_id?: string
          filename?: string | null
          graph_attachment_id?: string
          id?: string
          is_inline?: boolean
          last_error?: string | null
          mime_type?: string | null
          object_path?: string | null
          size_bytes?: number | null
          skip_reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "graph_mail_attachments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "graph_mail_events"
            referencedColumns: ["id"]
          },
        ]
      }
      graph_mail_events: {
        Row: {
          attempts: number
          created_at: string
          from_address: string | null
          graph_message_id: string
          id: string
          internet_message_id: string | null
          last_error: string | null
          mailbox: string
          next_retry_at: string | null
          raw_notification: Json | null
          received_datetime: string | null
          status: string
          subject: string | null
          subscription_id: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          from_address?: string | null
          graph_message_id: string
          id?: string
          internet_message_id?: string | null
          last_error?: string | null
          mailbox: string
          next_retry_at?: string | null
          raw_notification?: Json | null
          received_datetime?: string | null
          status?: string
          subject?: string | null
          subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          from_address?: string | null
          graph_message_id?: string
          id?: string
          internet_message_id?: string | null
          last_error?: string | null
          mailbox?: string
          next_retry_at?: string | null
          raw_notification?: Json | null
          received_datetime?: string | null
          status?: string
          subject?: string | null
          subscription_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      graph_mail_subscriptions: {
        Row: {
          client_state_hash: string | null
          created_at: string
          expires_at: string | null
          id: string
          last_renewed_at: string | null
          last_sweep_at: string | null
          lifecycle_state: string | null
          mailbox: string
          shop_id: number | null
          subscription_id: string | null
          updated_at: string
        }
        Insert: {
          client_state_hash?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          last_renewed_at?: string | null
          last_sweep_at?: string | null
          lifecycle_state?: string | null
          mailbox: string
          shop_id?: number | null
          subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          client_state_hash?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          last_renewed_at?: string | null
          last_sweep_at?: string | null
          lifecycle_state?: string | null
          mailbox?: string
          shop_id?: number | null
          subscription_id?: string | null
          updated_at?: string
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
          customer_name: string | null
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
          customer_name?: string | null
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
          customer_name?: string | null
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
      qbo_accounts: {
        Row: {
          account_sub_type: string | null
          account_type: string | null
          acct_num: string | null
          active: boolean
          classification: string | null
          created_at: string
          deleted_at: string | null
          fully_qualified_name: string | null
          id: string
          name: string
          qbo_account_id: string
          realm_id: string
          shop_id: number
          synced_at: string
          updated_at: string
        }
        Insert: {
          account_sub_type?: string | null
          account_type?: string | null
          acct_num?: string | null
          active?: boolean
          classification?: string | null
          created_at?: string
          deleted_at?: string | null
          fully_qualified_name?: string | null
          id?: string
          name: string
          qbo_account_id: string
          realm_id: string
          shop_id: number
          synced_at?: string
          updated_at?: string
        }
        Update: {
          account_sub_type?: string | null
          account_type?: string | null
          acct_num?: string | null
          active?: boolean
          classification?: string | null
          created_at?: string
          deleted_at?: string | null
          fully_qualified_name?: string | null
          id?: string
          name?: string
          qbo_account_id?: string
          realm_id?: string
          shop_id?: number
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_accounts_connection_fk"
            columns: ["shop_id", "realm_id"]
            isOneToOne: false
            referencedRelation: "qbo_connections"
            referencedColumns: ["shop_id", "realm_id"]
          },
        ]
      }
      qbo_coa_sync_state: {
        Row: {
          account_count: number
          last_synced_at: string
          realm_id: string
          shop_id: number
        }
        Insert: {
          account_count?: number
          last_synced_at?: string
          realm_id: string
          shop_id: number
        }
        Update: {
          account_count?: number
          last_synced_at?: string
          realm_id?: string
          shop_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "qbo_coa_sync_state_connection_fk"
            columns: ["shop_id", "realm_id"]
            isOneToOne: true
            referencedRelation: "qbo_connections"
            referencedColumns: ["shop_id", "realm_id"]
          },
        ]
      }
      qbo_connections: {
        Row: {
          access_token_expires_at: string
          environment: string
          realm_id: string
          refresh_token_expires_at: string
          shop_id: number | null
          updated_at: string
        }
        Insert: {
          access_token_expires_at: string
          environment?: string
          realm_id: string
          refresh_token_expires_at: string
          shop_id?: number | null
          updated_at?: string
        }
        Update: {
          access_token_expires_at?: string
          environment?: string
          realm_id?: string
          refresh_token_expires_at?: string
          shop_id?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      qteklink_allowed_users: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          email: string
          entra_object_id: string | null
          entra_tenant_id: string | null
          full_name: string | null
          id: string
          role: string
          shop_id: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          email: string
          entra_object_id?: string | null
          entra_tenant_id?: string | null
          full_name?: string | null
          id?: string
          role?: string
          shop_id: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          email?: string
          entra_object_id?: string | null
          entra_tenant_id?: string | null
          full_name?: string | null
          id?: string
          role?: string
          shop_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      qteklink_customers: {
        Row: {
          created_at: string
          display_name: string | null
          fetched_at: string
          first_name: string | null
          id: string
          last_name: string | null
          shop_id: number
          tekmetric_customer_id: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          fetched_at?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          shop_id: number
          tekmetric_customer_id: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          fetched_at?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          shop_id?: number
          tekmetric_customer_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      qteklink_daily_postings: {
        Row: {
          action: string
          approved_at: string | null
          approved_by: string | null
          business_date: string
          category: string
          constituents: Json
          created_at: string
          id: string
          lease_until: string | null
          posting_version: number
          proposed_je: Json
          qbo_je_id: string | null
          qbo_response: Json | null
          qbo_sync_token: string | null
          realm_id: string
          rejected_at: string | null
          rejected_by: string | null
          requestid: string
          shop_id: number
          source_state_hash: string
          status: string
          updated_at: string
        }
        Insert: {
          action?: string
          approved_at?: string | null
          approved_by?: string | null
          business_date: string
          category: string
          constituents?: Json
          created_at?: string
          id?: string
          lease_until?: string | null
          posting_version?: number
          proposed_je: Json
          qbo_je_id?: string | null
          qbo_response?: Json | null
          qbo_sync_token?: string | null
          realm_id: string
          rejected_at?: string | null
          rejected_by?: string | null
          requestid: string
          shop_id: number
          source_state_hash: string
          status?: string
          updated_at?: string
        }
        Update: {
          action?: string
          approved_at?: string | null
          approved_by?: string | null
          business_date?: string
          category?: string
          constituents?: Json
          created_at?: string
          id?: string
          lease_until?: string | null
          posting_version?: number
          proposed_je?: Json
          qbo_je_id?: string | null
          qbo_response?: Json | null
          qbo_sync_token?: string | null
          realm_id?: string
          rejected_at?: string | null
          rejected_by?: string | null
          requestid?: string
          shop_id?: number
          source_state_hash?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qteklink_daily_postings_conn_fk"
            columns: ["shop_id", "realm_id"]
            isOneToOne: false
            referencedRelation: "qbo_connections"
            referencedColumns: ["shop_id", "realm_id"]
          },
        ]
      }
      qteklink_events: {
        Row: {
          event_hash: string | null
          event_kind: string
          event_text: string | null
          event_time_raw: string | null
          id: string
          payment_id: number | null
          raw_body: Json
          raw_headers: Json | null
          raw_query_string: string | null
          realm_id: string
          received_at: string
          shop_id: number
          source_id: string | null
          tekmetric_event_at: string | null
          tekmetric_ro_id: number | null
        }
        Insert: {
          event_hash?: string | null
          event_kind: string
          event_text?: string | null
          event_time_raw?: string | null
          id?: string
          payment_id?: number | null
          raw_body: Json
          raw_headers?: Json | null
          raw_query_string?: string | null
          realm_id: string
          received_at?: string
          shop_id: number
          source_id?: string | null
          tekmetric_event_at?: string | null
          tekmetric_ro_id?: number | null
        }
        Update: {
          event_hash?: string | null
          event_kind?: string
          event_text?: string | null
          event_time_raw?: string | null
          id?: string
          payment_id?: number | null
          raw_body?: Json
          raw_headers?: Json | null
          raw_query_string?: string | null
          realm_id?: string
          received_at?: string
          shop_id?: number
          source_id?: string | null
          tekmetric_event_at?: string | null
          tekmetric_ro_id?: number | null
        }
        Relationships: []
      }
      qteklink_manual_payments: {
        Row: {
          amount_cents: number
          cc_fee_cents: number
          created_at: string
          created_by: string
          id: string
          method: string
          other_payment_type: string | null
          payment_date: string
          realm_id: string
          repair_order_id: number
          shop_id: number
          updated_at: string
        }
        Insert: {
          amount_cents: number
          cc_fee_cents?: number
          created_at?: string
          created_by: string
          id?: string
          method: string
          other_payment_type?: string | null
          payment_date: string
          realm_id: string
          repair_order_id: number
          shop_id: number
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          cc_fee_cents?: number
          created_at?: string
          created_by?: string
          id?: string
          method?: string
          other_payment_type?: string | null
          payment_date?: string
          realm_id?: string
          repair_order_id?: number
          shop_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qteklink_manual_payments_conn_fk"
            columns: ["shop_id", "realm_id"]
            isOneToOne: false
            referencedRelation: "qbo_connections"
            referencedColumns: ["shop_id", "realm_id"]
          },
        ]
      }
      qteklink_mappings: {
        Row: {
          active: boolean
          created_at: string
          effective_from: string
          id: string
          kind: string
          pass_through: boolean
          posting_role: string
          qbo_account_id: string
          realm_id: string
          shop_id: number
          source_id: string | null
          source_key: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          effective_from?: string
          id?: string
          kind: string
          pass_through?: boolean
          posting_role: string
          qbo_account_id: string
          realm_id: string
          shop_id: number
          source_id?: string | null
          source_key: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          effective_from?: string
          id?: string
          kind?: string
          pass_through?: boolean
          posting_role?: string
          qbo_account_id?: string
          realm_id?: string
          shop_id?: number
          source_id?: string | null
          source_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qteklink_mappings_account_fk"
            columns: ["shop_id", "realm_id", "qbo_account_id"]
            isOneToOne: false
            referencedRelation: "qbo_accounts"
            referencedColumns: ["shop_id", "realm_id", "qbo_account_id"]
          },
        ]
      }
      qteklink_payment_redates: {
        Row: {
          amount_cents: number
          approved_at: string | null
          approved_by: string | null
          business_date: string
          created_at: string
          customer_name: string | null
          detected_at: string
          id: string
          notified_at: string | null
          payment_id: number
          realm_id: string
          resolved_at: string | null
          ro_number: string | null
          shop_id: number
          status: string
          tekmetric_ro_id: number | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          approved_at?: string | null
          approved_by?: string | null
          business_date: string
          created_at?: string
          customer_name?: string | null
          detected_at?: string
          id?: string
          notified_at?: string | null
          payment_id: number
          realm_id: string
          resolved_at?: string | null
          ro_number?: string | null
          shop_id: number
          status?: string
          tekmetric_ro_id?: number | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          approved_at?: string | null
          approved_by?: string | null
          business_date?: string
          created_at?: string
          customer_name?: string | null
          detected_at?: string
          id?: string
          notified_at?: string | null
          payment_id?: number
          realm_id?: string
          resolved_at?: string | null
          ro_number?: string | null
          shop_id?: number
          status?: string
          tekmetric_ro_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qteklink_payment_redates_conn_fk"
            columns: ["shop_id", "realm_id"]
            isOneToOne: false
            referencedRelation: "qbo_connections"
            referencedColumns: ["shop_id", "realm_id"]
          },
        ]
      }
      qteklink_payment_state: {
        Row: {
          created_at: string
          id: string
          is_refund: boolean
          latest_event_at: string | null
          other_payment_type: string | null
          payment_date: string | null
          payment_id: number
          payment_type: string | null
          realm_id: string
          reduced_from_event_ids: string[]
          repair_order_id: number | null
          shop_id: number
          signed_amount_cents: number
          signed_processing_fee_cents: number
          status: string
          updated_at: string
          voided_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_refund?: boolean
          latest_event_at?: string | null
          other_payment_type?: string | null
          payment_date?: string | null
          payment_id: number
          payment_type?: string | null
          realm_id: string
          reduced_from_event_ids?: string[]
          repair_order_id?: number | null
          shop_id: number
          signed_amount_cents: number
          signed_processing_fee_cents?: number
          status: string
          updated_at?: string
          voided_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_refund?: boolean
          latest_event_at?: string | null
          other_payment_type?: string | null
          payment_date?: string | null
          payment_id?: number
          payment_type?: string | null
          realm_id?: string
          reduced_from_event_ids?: string[]
          repair_order_id?: number | null
          shop_id?: number
          signed_amount_cents?: number
          signed_processing_fee_cents?: number
          status?: string
          updated_at?: string
          voided_at?: string | null
        }
        Relationships: []
      }
      qteklink_payroll_audit_log: {
        Row: {
          action: string
          actor_label: string
          actor_user_id: string | null
          created_at: string
          detail: Json
          employee_id: string | null
          id: number
          run_employee_id: string | null
          run_id: string | null
          shop_id: number
        }
        Insert: {
          action: string
          actor_label: string
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          employee_id?: string | null
          id?: number
          run_employee_id?: string | null
          run_id?: string | null
          shop_id: number
        }
        Update: {
          action?: string
          actor_label?: string
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          employee_id?: string | null
          id?: number
          run_employee_id?: string | null
          run_id?: string | null
          shop_id?: number
        }
        Relationships: []
      }
      qteklink_payroll_confirm_tokens: {
        Row: {
          action_kind: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          run_id: string
          scope_hash: string
          shop_id: number
        }
        Insert: {
          action_kind: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          run_id: string
          scope_hash: string
          shop_id: number
        }
        Update: {
          action_kind?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          run_id?: string
          scope_hash?: string
          shop_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "qteklink_payroll_confirm_tokens_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "qteklink_payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      qteklink_payroll_email_log: {
        Row: {
          created_at: string
          detail: string | null
          employee_id: string | null
          id: string
          kind: string
          recipient: string
          run_id: string | null
          sent_at: string | null
          shop_id: number
          status: string
          subject: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          employee_id?: string | null
          id?: string
          kind: string
          recipient?: string
          run_id?: string | null
          sent_at?: string | null
          shop_id: number
          status: string
          subject?: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          employee_id?: string | null
          id?: string
          kind?: string
          recipient?: string
          run_id?: string | null
          sent_at?: string | null
          shop_id?: number
          status?: string
          subject?: string
        }
        Relationships: []
      }
      qteklink_payroll_employees: {
        Row: {
          address: string | null
          archived_at: string | null
          created_at: string
          created_by_label: string | null
          display_name: string
          full_time: boolean
          id: string
          pay_config: Json
          personal_email: string | null
          personal_phone: string | null
          pto_grandfathered: boolean
          pto_tenure_credit_date: string | null
          role: string
          shop_id: number
          start_date: string | null
          tekmetric_employee_id: number | null
          tekmetric_id_type: string | null
          termination_date: string | null
          updated_at: string
          updated_by_label: string | null
          work_email: string | null
          work_phone: string | null
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          created_at?: string
          created_by_label?: string | null
          display_name: string
          full_time?: boolean
          id?: string
          pay_config: Json
          personal_email?: string | null
          personal_phone?: string | null
          pto_grandfathered?: boolean
          pto_tenure_credit_date?: string | null
          role: string
          shop_id: number
          start_date?: string | null
          tekmetric_employee_id?: number | null
          tekmetric_id_type?: string | null
          termination_date?: string | null
          updated_at?: string
          updated_by_label?: string | null
          work_email?: string | null
          work_phone?: string | null
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          created_at?: string
          created_by_label?: string | null
          display_name?: string
          full_time?: boolean
          id?: string
          pay_config?: Json
          personal_email?: string | null
          personal_phone?: string | null
          pto_grandfathered?: boolean
          pto_tenure_credit_date?: string | null
          role?: string
          shop_id?: number
          start_date?: string | null
          tekmetric_employee_id?: number | null
          tekmetric_id_type?: string | null
          termination_date?: string | null
          updated_at?: string
          updated_by_label?: string | null
          work_email?: string | null
          work_phone?: string | null
        }
        Relationships: []
      }
      qteklink_payroll_pto_ledger: {
        Row: {
          balance_after_hours: number
          boundary_year: number | null
          created_at: string
          created_by_label: string
          employee_id: string
          hours: number
          id: string
          kind: string
          reason: string | null
          reverses_ledger_id: string | null
          run_id: string | null
          shop_id: number
        }
        Insert: {
          balance_after_hours: number
          boundary_year?: number | null
          created_at?: string
          created_by_label: string
          employee_id: string
          hours: number
          id?: string
          kind: string
          reason?: string | null
          reverses_ledger_id?: string | null
          run_id?: string | null
          shop_id: number
        }
        Update: {
          balance_after_hours?: number
          boundary_year?: number | null
          created_at?: string
          created_by_label?: string
          employee_id?: string
          hours?: number
          id?: string
          kind?: string
          reason?: string | null
          reverses_ledger_id?: string | null
          run_id?: string | null
          shop_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "qteklink_payroll_pto_ledger_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "qteklink_payroll_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qteklink_payroll_pto_ledger_reverses_ledger_id_fkey"
            columns: ["reverses_ledger_id"]
            isOneToOne: false
            referencedRelation: "qteklink_payroll_pto_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qteklink_payroll_pto_ledger_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "qteklink_payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      qteklink_payroll_run_employees: {
        Row: {
          bereavement_w1: number | null
          bereavement_w2: number | null
          clock_hours_w1: number | null
          clock_hours_w2: number | null
          created_at: string
          employee_id: string
          holiday_w1: number | null
          holiday_w2: number | null
          id: string
          manual_incentive_cents: number | null
          overrides: Json
          pay_config: Json
          pto_w1: number | null
          pto_w2: number | null
          role_snapshot: string
          run_id: string
          shop_id: number
          training_w1: number | null
          training_w2: number | null
          updated_at: string
        }
        Insert: {
          bereavement_w1?: number | null
          bereavement_w2?: number | null
          clock_hours_w1?: number | null
          clock_hours_w2?: number | null
          created_at?: string
          employee_id: string
          holiday_w1?: number | null
          holiday_w2?: number | null
          id?: string
          manual_incentive_cents?: number | null
          overrides?: Json
          pay_config: Json
          pto_w1?: number | null
          pto_w2?: number | null
          role_snapshot: string
          run_id: string
          shop_id: number
          training_w1?: number | null
          training_w2?: number | null
          updated_at?: string
        }
        Update: {
          bereavement_w1?: number | null
          bereavement_w2?: number | null
          clock_hours_w1?: number | null
          clock_hours_w2?: number | null
          created_at?: string
          employee_id?: string
          holiday_w1?: number | null
          holiday_w2?: number | null
          id?: string
          manual_incentive_cents?: number | null
          overrides?: Json
          pay_config?: Json
          pto_w1?: number | null
          pto_w2?: number | null
          role_snapshot?: string
          run_id?: string
          shop_id?: number
          training_w1?: number | null
          training_w2?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qteklink_payroll_run_employees_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "qteklink_payroll_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qteklink_payroll_run_employees_employee_shop_fk"
            columns: ["employee_id", "shop_id"]
            isOneToOne: false
            referencedRelation: "qteklink_payroll_employees"
            referencedColumns: ["id", "shop_id"]
          },
          {
            foreignKeyName: "qteklink_payroll_run_employees_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "qteklink_payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qteklink_payroll_run_employees_run_shop_fk"
            columns: ["run_id", "shop_id"]
            isOneToOne: false
            referencedRelation: "qteklink_payroll_runs"
            referencedColumns: ["id", "shop_id"]
          },
        ]
      }
      qteklink_payroll_runs: {
        Row: {
          bonus_month: string | null
          bonus_period: boolean
          cloned_from_run_id: string | null
          completed_at: string | null
          completed_by_label: string | null
          completed_by_user_id: string | null
          created_at: string
          id: string
          live_snapshot: Json | null
          live_snapshot_at: string | null
          live_snapshot_invalidated_at: string | null
          live_snapshot_stale: boolean
          period_end: string
          period_start: string
          shop_id: number
          snapshot: Json | null
          status: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by_label: string | null
          voided_by_user_id: string | null
        }
        Insert: {
          bonus_month?: string | null
          bonus_period?: boolean
          cloned_from_run_id?: string | null
          completed_at?: string | null
          completed_by_label?: string | null
          completed_by_user_id?: string | null
          created_at?: string
          id?: string
          live_snapshot?: Json | null
          live_snapshot_at?: string | null
          live_snapshot_invalidated_at?: string | null
          live_snapshot_stale?: boolean
          period_end: string
          period_start: string
          shop_id: number
          snapshot?: Json | null
          status?: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by_label?: string | null
          voided_by_user_id?: string | null
        }
        Update: {
          bonus_month?: string | null
          bonus_period?: boolean
          cloned_from_run_id?: string | null
          completed_at?: string | null
          completed_by_label?: string | null
          completed_by_user_id?: string | null
          created_at?: string
          id?: string
          live_snapshot?: Json | null
          live_snapshot_at?: string | null
          live_snapshot_invalidated_at?: string | null
          live_snapshot_stale?: boolean
          period_end?: string
          period_start?: string
          shop_id?: number
          snapshot?: Json | null
          status?: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by_label?: string | null
          voided_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qteklink_payroll_runs_cloned_from_run_id_fkey"
            columns: ["cloned_from_run_id"]
            isOneToOne: false
            referencedRelation: "qteklink_payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      qteklink_postings: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          batch_date: string
          created_at: string
          id: string
          kind: string
          lease_until: string | null
          payment_id: number | null
          posting_version: number
          proposed_je: Json
          qbo_je_id: string | null
          qbo_response: Json | null
          realm_id: string
          recon_status: string
          requestid: string
          shop_id: number
          source_state_hash: string
          status: string
          tekmetric_ro_id: number
          txn_date: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          batch_date: string
          created_at?: string
          id?: string
          kind: string
          lease_until?: string | null
          payment_id?: number | null
          posting_version?: number
          proposed_je: Json
          qbo_je_id?: string | null
          qbo_response?: Json | null
          realm_id: string
          recon_status?: string
          requestid: string
          shop_id: number
          source_state_hash: string
          status?: string
          tekmetric_ro_id: number
          txn_date: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          batch_date?: string
          created_at?: string
          id?: string
          kind?: string
          lease_until?: string | null
          payment_id?: number | null
          posting_version?: number
          proposed_je?: Json
          qbo_je_id?: string | null
          qbo_response?: Json | null
          realm_id?: string
          recon_status?: string
          requestid?: string
          shop_id?: number
          source_state_hash?: string
          status?: string
          tekmetric_ro_id?: number
          txn_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qteklink_postings_conn_fk"
            columns: ["shop_id", "realm_id"]
            isOneToOne: false
            referencedRelation: "qbo_connections"
            referencedColumns: ["shop_id", "realm_id"]
          },
        ]
      }
      qteklink_projection_state: {
        Row: {
          last_reduced_received_at: string
          realm_id: string
          shop_id: number
          updated_at: string
        }
        Insert: {
          last_reduced_received_at: string
          realm_id: string
          shop_id: number
          updated_at?: string
        }
        Update: {
          last_reduced_received_at?: string
          realm_id?: string
          shop_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qteklink_projection_state_conn_fk"
            columns: ["shop_id", "realm_id"]
            isOneToOne: true
            referencedRelation: "qbo_connections"
            referencedColumns: ["shop_id", "realm_id"]
          },
        ]
      }
      qteklink_review_items: {
        Row: {
          created_at: string
          detail: Json
          id: string
          kind: string
          realm_id: string
          resolution: Json | null
          resolved_at: string | null
          resolved_by: string | null
          shop_id: number
          status: string
          subject_kind: string
          subject_ref: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          id?: string
          kind: string
          realm_id: string
          resolution?: Json | null
          resolved_at?: string | null
          resolved_by?: string | null
          shop_id: number
          status?: string
          subject_kind: string
          subject_ref: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          detail?: Json
          id?: string
          kind?: string
          realm_id?: string
          resolution?: Json | null
          resolved_at?: string | null
          resolved_by?: string | null
          shop_id?: number
          status?: string
          subject_kind?: string
          subject_ref?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qteklink_review_items_conn_fk"
            columns: ["shop_id", "realm_id"]
            isOneToOne: false
            referencedRelation: "qbo_connections"
            referencedColumns: ["shop_id", "realm_id"]
          },
        ]
      }
      qteklink_ro_date_moves: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          detected_at: string
          id: string
          new_business_date: string
          new_total_cents: number | null
          original_business_date: string
          original_total_cents: number | null
          realm_id: string
          resolved_at: string | null
          ro_number: string | null
          shop_id: number
          status: string
          tekmetric_ro_id: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          detected_at?: string
          id?: string
          new_business_date: string
          new_total_cents?: number | null
          original_business_date: string
          original_total_cents?: number | null
          realm_id: string
          resolved_at?: string | null
          ro_number?: string | null
          shop_id: number
          status?: string
          tekmetric_ro_id: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          detected_at?: string
          id?: string
          new_business_date?: string
          new_total_cents?: number | null
          original_business_date?: string
          original_total_cents?: number | null
          realm_id?: string
          resolved_at?: string | null
          ro_number?: string | null
          shop_id?: number
          status?: string
          tekmetric_ro_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qteklink_date_moves_conn_fk"
            columns: ["shop_id", "realm_id"]
            isOneToOne: false
            referencedRelation: "qbo_connections"
            referencedColumns: ["shop_id", "realm_id"]
          },
        ]
      }
      qteklink_ro_state: {
        Row: {
          created_at: string
          id: string
          last_posted_date: string | null
          last_total_cents: number | null
          realm_id: string
          ro_number: string | null
          sale_qbo_je_id: string | null
          sale_qbo_sync_token: string | null
          shop_id: number
          source_snapshot_hash: string | null
          status: string
          tekmetric_ro_id: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_posted_date?: string | null
          last_total_cents?: number | null
          realm_id: string
          ro_number?: string | null
          sale_qbo_je_id?: string | null
          sale_qbo_sync_token?: string | null
          shop_id: number
          source_snapshot_hash?: string | null
          status?: string
          tekmetric_ro_id: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_posted_date?: string | null
          last_total_cents?: number | null
          realm_id?: string
          ro_number?: string | null
          sale_qbo_je_id?: string | null
          sale_qbo_sync_token?: string | null
          shop_id?: number
          source_snapshot_hash?: string | null
          status?: string
          tekmetric_ro_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qteklink_ro_state_conn_fk"
            columns: ["shop_id", "realm_id"]
            isOneToOne: false
            referencedRelation: "qbo_connections"
            referencedColumns: ["shop_id", "realm_id"]
          },
        ]
      }
      qteklink_ros: {
        Row: {
          created_at: string
          fetched_at: string
          id: string
          repair_order_number: string | null
          shop_id: number
          tekmetric_ro_id: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          fetched_at?: string
          id?: string
          repair_order_number?: string | null
          shop_id: number
          tekmetric_ro_id: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          fetched_at?: string
          id?: string
          repair_order_number?: string | null
          shop_id?: number
          tekmetric_ro_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      qteklink_settings: {
        Row: {
          advisor_emails: string | null
          auto_post: boolean
          back_office: Json | null
          created_at: string
          date_change_alert_emails: string | null
          day_correction_alert_emails: string | null
          office_manager_email: string | null
          payroll: Json | null
          realm_id: string
          sales_tax_rate_bps: number
          settle_window_minutes: number
          shop_id: number
          shop_timezone: string
          tire_fee_cents: number
          updated_at: string
        }
        Insert: {
          advisor_emails?: string | null
          auto_post?: boolean
          back_office?: Json | null
          created_at?: string
          date_change_alert_emails?: string | null
          day_correction_alert_emails?: string | null
          office_manager_email?: string | null
          payroll?: Json | null
          realm_id: string
          sales_tax_rate_bps?: number
          settle_window_minutes?: number
          shop_id: number
          shop_timezone?: string
          tire_fee_cents?: number
          updated_at?: string
        }
        Update: {
          advisor_emails?: string | null
          auto_post?: boolean
          back_office?: Json | null
          created_at?: string
          date_change_alert_emails?: string | null
          day_correction_alert_emails?: string | null
          office_manager_email?: string | null
          payroll?: Json | null
          realm_id?: string
          sales_tax_rate_bps?: number
          settle_window_minutes?: number
          shop_id?: number
          shop_timezone?: string
          tire_fee_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qteklink_settings_conn_fk"
            columns: ["shop_id", "realm_id"]
            isOneToOne: true
            referencedRelation: "qbo_connections"
            referencedColumns: ["shop_id", "realm_id"]
          },
        ]
      }
      rate_limit_buckets: {
        Row: {
          id: number
          key: string
          occurred_at: string
        }
        Insert: {
          id?: never
          key: string
          occurred_at?: string
        }
        Update: {
          id?: never
          key?: string
          occurred_at?: string
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
          reverts_upload_id: number | null
          rows_added: number
          rows_deactivated: number
          rows_modified: number
          shop_id: number
          snapshot_pruned_at: string | null
          successor_revert_id: number | null
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
          reverts_upload_id?: number | null
          rows_added?: number
          rows_deactivated?: number
          rows_modified?: number
          shop_id: number
          snapshot_pruned_at?: string | null
          successor_revert_id?: number | null
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
          reverts_upload_id?: number | null
          rows_added?: number
          rows_deactivated?: number
          rows_modified?: number
          shop_id?: number
          snapshot_pruned_at?: string | null
          successor_revert_id?: number | null
          table_name?: string
          user_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduler_admin_audit_log_reverts_upload_id_fkey"
            columns: ["reverts_upload_id"]
            isOneToOne: false
            referencedRelation: "scheduler_admin_audit_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduler_admin_audit_log_successor_revert_id_fkey"
            columns: ["successor_revert_id"]
            isOneToOne: false
            referencedRelation: "scheduler_admin_audit_log"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduler_admin_revert_attempts: {
        Row: {
          actor_email: string | null
          attempted_at: string
          completed_at: string | null
          dry_run: boolean
          dry_run_confirm_token_hash: string | null
          error_detail: string | null
          id: number
          metadata: Json | null
          oauth_client_id: string | null
          outcome: string
          reason_code: string | null
          revert_audit_log_id: number | null
          shop_id: number
          upload_id: number
        }
        Insert: {
          actor_email?: string | null
          attempted_at?: string
          completed_at?: string | null
          dry_run: boolean
          dry_run_confirm_token_hash?: string | null
          error_detail?: string | null
          id?: number
          metadata?: Json | null
          oauth_client_id?: string | null
          outcome: string
          reason_code?: string | null
          revert_audit_log_id?: number | null
          shop_id: number
          upload_id: number
        }
        Update: {
          actor_email?: string | null
          attempted_at?: string
          completed_at?: string | null
          dry_run?: boolean
          dry_run_confirm_token_hash?: string | null
          error_detail?: string | null
          id?: number
          metadata?: Json | null
          oauth_client_id?: string | null
          outcome?: string
          reason_code?: string | null
          revert_audit_log_id?: number | null
          shop_id?: number
          upload_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "scheduler_admin_revert_attempts_revert_audit_log_id_fkey"
            columns: ["revert_audit_log_id"]
            isOneToOne: false
            referencedRelation: "scheduler_admin_audit_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduler_admin_revert_attempts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "scheduler_admin_audit_log"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduler_appointment_types: {
        Row: {
          active: boolean
          card_description: string | null
          card_title: string
          created_at: string
          emoji: string | null
          id: string
          is_system: boolean
          label: string
          requires_time_slot: boolean
          shop_id: number
          slug: string
          sort: number
          tekmetric_color: string
          updated_at: string
          updated_by_email: string | null
        }
        Insert: {
          active?: boolean
          card_description?: string | null
          card_title: string
          created_at?: string
          emoji?: string | null
          id?: string
          is_system?: boolean
          label: string
          requires_time_slot?: boolean
          shop_id: number
          slug: string
          sort?: number
          tekmetric_color: string
          updated_at?: string
          updated_by_email?: string | null
        }
        Update: {
          active?: boolean
          card_description?: string | null
          card_title?: string
          created_at?: string
          emoji?: string | null
          id?: string
          is_system?: boolean
          label?: string
          requires_time_slot?: boolean
          shop_id?: number
          slug?: string
          sort?: number
          tekmetric_color?: string
          updated_at?: string
          updated_by_email?: string | null
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
      scheduler_card_text: {
        Row: {
          active: boolean
          allowed_merge_fields: string[]
          body: string
          card_key: string
          created_at: string
          default_body: string
          id: string
          label: string
          shop_id: number
          slot_key: string
          sort: number
          updated_at: string
          updated_by_email: string | null
        }
        Insert: {
          active?: boolean
          allowed_merge_fields?: string[]
          body: string
          card_key: string
          created_at?: string
          default_body: string
          id?: string
          label: string
          shop_id: number
          slot_key: string
          sort?: number
          updated_at?: string
          updated_by_email?: string | null
        }
        Update: {
          active?: boolean
          allowed_merge_fields?: string[]
          body?: string
          card_key?: string
          created_at?: string
          default_body?: string
          id?: string
          label?: string
          shop_id?: number
          slot_key?: string
          sort?: number
          updated_at?: string
          updated_by_email?: string | null
        }
        Relationships: []
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
      scheduler_message_templates: {
        Row: {
          active: boolean
          body: string
          channel: string
          created_at: string
          id: string
          kind: string
          shop_id: number
          subject: string | null
          type_id: string | null
          updated_at: string
          updated_by_email: string | null
        }
        Insert: {
          active?: boolean
          body: string
          channel: string
          created_at?: string
          id?: string
          kind: string
          shop_id: number
          subject?: string | null
          type_id?: string | null
          updated_at?: string
          updated_by_email?: string | null
        }
        Update: {
          active?: boolean
          body?: string
          channel?: string
          created_at?: string
          id?: string
          kind?: string
          shop_id?: number
          subject?: string | null
          type_id?: string | null
          updated_at?: string
          updated_by_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduler_message_templates_shop_id_type_id_fkey"
            columns: ["shop_id", "type_id"]
            isOneToOne: false
            referencedRelation: "scheduler_appointment_types"
            referencedColumns: ["shop_id", "id"]
          },
        ]
      }
      scheduler_reminders: {
        Row: {
          channel: string
          created_at: string
          error: string | null
          id: string
          reminder_kind: string
          sent_at: string | null
          shop_id: number
          skip_reason: string | null
          status: string
          tekmetric_appointment_id: number
          updated_at: string
        }
        Insert: {
          channel: string
          created_at?: string
          error?: string | null
          id?: string
          reminder_kind: string
          sent_at?: string | null
          shop_id: number
          skip_reason?: string | null
          status: string
          tekmetric_appointment_id: number
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          reminder_kind?: string
          sent_at?: string | null
          shop_id?: number
          skip_reason?: string | null
          status?: string
          tekmetric_appointment_id?: number
          updated_at?: string
        }
        Relationships: []
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
      sms_appointment_opt_outs: {
        Row: {
          chat_session_id: string | null
          created_at: string
          id: string
          opted_out_at: string
          phone_e164: string
          restore_source: string | null
          restored_at: string | null
          shop_id: number
          source: string
        }
        Insert: {
          chat_session_id?: string | null
          created_at?: string
          id?: string
          opted_out_at?: string
          phone_e164: string
          restore_source?: string | null
          restored_at?: string | null
          shop_id: number
          source: string
        }
        Update: {
          chat_session_id?: string | null
          created_at?: string
          id?: string
          opted_out_at?: string
          phone_e164?: string
          restore_source?: string | null
          restored_at?: string | null
          shop_id?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_appointment_opt_outs_chat_session_id_fkey"
            columns: ["chat_session_id"]
            isOneToOne: false
            referencedRelation: "customer_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_consents: {
        Row: {
          acquisition_medium: string
          chat_session_id: string | null
          consent_ip: string | null
          consenter_label: string | null
          created_at: string
          cta_text: string
          cta_version: string
          granted_at: string
          id: string
          phone_e164: string
          revoke_source: string | null
          revoked_at: string | null
          shop_id: number
          user_agent: string | null
        }
        Insert: {
          acquisition_medium: string
          chat_session_id?: string | null
          consent_ip?: string | null
          consenter_label?: string | null
          created_at?: string
          cta_text: string
          cta_version: string
          granted_at?: string
          id?: string
          phone_e164: string
          revoke_source?: string | null
          revoked_at?: string | null
          shop_id: number
          user_agent?: string | null
        }
        Update: {
          acquisition_medium?: string
          chat_session_id?: string | null
          consent_ip?: string | null
          consenter_label?: string | null
          created_at?: string
          cta_text?: string
          cta_version?: string
          granted_at?: string
          id?: string
          phone_e164?: string
          revoke_source?: string | null
          revoked_at?: string | null
          shop_id?: number
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_consents_chat_session_id_fkey"
            columns: ["chat_session_id"]
            isOneToOne: false
            referencedRelation: "customer_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_messages: {
        Row: {
          body: string | null
          chat_session_id: string | null
          created_at: string
          direction: string
          id: string
          kind: string
          phone_e164: string
          shop_id: number
          status: string
          status_detail: string | null
          tekmetric_appointment_id: number | null
          telnyx_message_id: string | null
          updated_at: string
        }
        Insert: {
          body?: string | null
          chat_session_id?: string | null
          created_at?: string
          direction: string
          id?: string
          kind: string
          phone_e164: string
          shop_id: number
          status?: string
          status_detail?: string | null
          tekmetric_appointment_id?: number | null
          telnyx_message_id?: string | null
          updated_at?: string
        }
        Update: {
          body?: string | null
          chat_session_id?: string | null
          created_at?: string
          direction?: string
          id?: string
          kind?: string
          phone_e164?: string
          shop_id?: number
          status?: string
          status_detail?: string | null
          tekmetric_appointment_id?: number | null
          telnyx_message_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_messages_chat_session_id_fkey"
            columns: ["chat_session_id"]
            isOneToOne: false
            referencedRelation: "customer_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      tekbridge_audit_log: {
        Row: {
          actor: string | null
          capability: string
          created_at: string
          error: string | null
          id: string
          input_summary: Json | null
          outcome: string
          shop_id: number
          tekmetric_ref: Json | null
          verified: boolean | null
        }
        Insert: {
          actor?: string | null
          capability: string
          created_at?: string
          error?: string | null
          id?: string
          input_summary?: Json | null
          outcome: string
          shop_id: number
          tekmetric_ref?: Json | null
          verified?: boolean | null
        }
        Update: {
          actor?: string | null
          capability?: string
          created_at?: string
          error?: string | null
          id?: string
          input_summary?: Json | null
          outcome?: string
          shop_id?: number
          tekmetric_ref?: Json | null
          verified?: boolean | null
        }
        Relationships: []
      }
      tekbridge_jobs: {
        Row: {
          actor: string | null
          after_snapshot: Json | null
          attempts: number
          before_snapshot: Json | null
          capability: string
          created_at: string
          error: string | null
          id: string
          idempotency_key: string
          input: Json
          result: Json | null
          shop_id: number
          status: string
          updated_at: string
        }
        Insert: {
          actor?: string | null
          after_snapshot?: Json | null
          attempts?: number
          before_snapshot?: Json | null
          capability: string
          created_at?: string
          error?: string | null
          id?: string
          idempotency_key: string
          input: Json
          result?: Json | null
          shop_id: number
          status?: string
          updated_at?: string
        }
        Update: {
          actor?: string | null
          after_snapshot?: Json | null
          attempts?: number
          before_snapshot?: Json | null
          capability?: string
          created_at?: string
          error?: string | null
          id?: string
          idempotency_key?: string
          input?: Json
          result?: Json | null
          shop_id?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      tekbridge_session_state: {
        Row: {
          expires_at: string | null
          last_alert_at: string | null
          last_error: string | null
          last_refreshed_at: string | null
          shop_id: number
          status: string
          updated_at: string
        }
        Insert: {
          expires_at?: string | null
          last_alert_at?: string | null
          last_error?: string | null
          last_refreshed_at?: string | null
          shop_id: number
          status?: string
          updated_at?: string
        }
        Update: {
          expires_at?: string | null
          last_alert_at?: string | null
          last_error?: string | null
          last_refreshed_at?: string | null
          shop_id?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      tekmetric_ro_customer_concerns: {
        Row: {
          concern: string | null
          id: number
          ro_id: number
          tech_comment: string | null
        }
        Insert: {
          concern?: string | null
          id: number
          ro_id: number
          tech_comment?: string | null
        }
        Update: {
          concern?: string | null
          id?: number
          ro_id?: number
          tech_comment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tekmetric_ro_customer_concerns_ro_id_fkey"
            columns: ["ro_id"]
            isOneToOne: false
            referencedRelation: "tekmetric_ros"
            referencedColumns: ["id"]
          },
        ]
      }
      tekmetric_ro_discounts: {
        Row: {
          id: number
          name: string | null
          ro_id: number
          total_cents: number | null
        }
        Insert: {
          id: number
          name?: string | null
          ro_id: number
          total_cents?: number | null
        }
        Update: {
          id?: number
          name?: string | null
          ro_id?: number
          total_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tekmetric_ro_discounts_ro_id_fkey"
            columns: ["ro_id"]
            isOneToOne: false
            referencedRelation: "tekmetric_ros"
            referencedColumns: ["id"]
          },
        ]
      }
      tekmetric_ro_fees: {
        Row: {
          id: number
          name: string | null
          ro_id: number
          total_cents: number | null
        }
        Insert: {
          id: number
          name?: string | null
          ro_id: number
          total_cents?: number | null
        }
        Update: {
          id?: number
          name?: string | null
          ro_id?: number
          total_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tekmetric_ro_fees_ro_id_fkey"
            columns: ["ro_id"]
            isOneToOne: false
            referencedRelation: "tekmetric_ros"
            referencedColumns: ["id"]
          },
        ]
      }
      tekmetric_ro_ingest_alerts: {
        Row: {
          first_seen: string
          id: number
          last_seen: string
          level: string
          occurrences: number
          ro_id: number | null
          sample: Json | null
          unknown_keys: string[]
        }
        Insert: {
          first_seen?: string
          id?: number
          last_seen?: string
          level: string
          occurrences?: number
          ro_id?: number | null
          sample?: Json | null
          unknown_keys: string[]
        }
        Update: {
          first_seen?: string
          id?: number
          last_seen?: string
          level?: string
          occurrences?: number
          ro_id?: number | null
          sample?: Json | null
          unknown_keys?: string[]
        }
        Relationships: []
      }
      tekmetric_ro_job_discounts: {
        Row: {
          id: number
          job_id: number
          name: string | null
          ro_id: number
          total_cents: number | null
        }
        Insert: {
          id: number
          job_id: number
          name?: string | null
          ro_id: number
          total_cents?: number | null
        }
        Update: {
          id?: number
          job_id?: number
          name?: string | null
          ro_id?: number
          total_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tekmetric_ro_job_discounts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "tekmetric_ro_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      tekmetric_ro_job_fees: {
        Row: {
          id: number
          job_id: number
          name: string | null
          ro_id: number
          total_cents: number | null
        }
        Insert: {
          id: number
          job_id: number
          name?: string | null
          ro_id: number
          total_cents?: number | null
        }
        Update: {
          id?: number
          job_id?: number
          name?: string | null
          ro_id?: number
          total_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tekmetric_ro_job_fees_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "tekmetric_ro_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      tekmetric_ro_job_labor: {
        Row: {
          complete: boolean | null
          hours: number | null
          id: number
          job_id: number
          name: string | null
          rate_cents: number | null
          ro_id: number
          technician_id: number | null
        }
        Insert: {
          complete?: boolean | null
          hours?: number | null
          id: number
          job_id: number
          name?: string | null
          rate_cents?: number | null
          ro_id: number
          technician_id?: number | null
        }
        Update: {
          complete?: boolean | null
          hours?: number | null
          id?: number
          job_id?: number
          name?: string | null
          rate_cents?: number | null
          ro_id?: number
          technician_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tekmetric_ro_job_labor_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "tekmetric_ro_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      tekmetric_ro_job_parts: {
        Row: {
          brand: string | null
          construction_type: string | null
          cost_cents: number | null
          description: string | null
          diameter: number | null
          dot_numbers: string[] | null
          id: number
          job_id: number
          load_index: string | null
          load_range: string | null
          mileage_warranty: string | null
          model: string | null
          name: string | null
          part_number: string | null
          part_status_code: string | null
          part_status_id: number | null
          part_status_name: string | null
          part_type_code: string | null
          part_type_id: number | null
          part_type_name: string | null
          quantity: number | null
          ratio: number | null
          retail_cents: number | null
          ro_id: number
          run_flat: boolean | null
          side_wall_style: string | null
          speed_rating: string | null
          temperature: string | null
          tire_category: string | null
          tire_type: string | null
          traction: string | null
          treadwear: string | null
          width: string | null
        }
        Insert: {
          brand?: string | null
          construction_type?: string | null
          cost_cents?: number | null
          description?: string | null
          diameter?: number | null
          dot_numbers?: string[] | null
          id: number
          job_id: number
          load_index?: string | null
          load_range?: string | null
          mileage_warranty?: string | null
          model?: string | null
          name?: string | null
          part_number?: string | null
          part_status_code?: string | null
          part_status_id?: number | null
          part_status_name?: string | null
          part_type_code?: string | null
          part_type_id?: number | null
          part_type_name?: string | null
          quantity?: number | null
          ratio?: number | null
          retail_cents?: number | null
          ro_id: number
          run_flat?: boolean | null
          side_wall_style?: string | null
          speed_rating?: string | null
          temperature?: string | null
          tire_category?: string | null
          tire_type?: string | null
          traction?: string | null
          treadwear?: string | null
          width?: string | null
        }
        Update: {
          brand?: string | null
          construction_type?: string | null
          cost_cents?: number | null
          description?: string | null
          diameter?: number | null
          dot_numbers?: string[] | null
          id?: number
          job_id?: number
          load_index?: string | null
          load_range?: string | null
          mileage_warranty?: string | null
          model?: string | null
          name?: string | null
          part_number?: string | null
          part_status_code?: string | null
          part_status_id?: number | null
          part_status_name?: string | null
          part_type_code?: string | null
          part_type_id?: number | null
          part_type_name?: string | null
          quantity?: number | null
          ratio?: number | null
          retail_cents?: number | null
          ro_id?: number
          run_flat?: boolean | null
          side_wall_style?: string | null
          speed_rating?: string | null
          temperature?: string | null
          tire_category?: string | null
          tire_type?: string | null
          traction?: string | null
          treadwear?: string | null
          width?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tekmetric_ro_job_parts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "tekmetric_ro_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      tekmetric_ro_jobs: {
        Row: {
          archived: boolean | null
          authorized: boolean | null
          authorized_date: string | null
          canned_job_id: number | null
          completed_date: string | null
          created_date: string | null
          customer_id: number | null
          discount_total_cents: number | null
          fee_total_cents: number | null
          id: number
          job_category_name: string | null
          labor_hours: number | null
          labor_total_cents: number | null
          logged_hours: number | null
          name: string | null
          note: string | null
          parts_total_cents: number | null
          ro_id: number
          selected: boolean | null
          shop_id: number
          sort: number | null
          subtotal_cents: number | null
          technician_id: number | null
          updated_date: string | null
          vehicle_id: number | null
        }
        Insert: {
          archived?: boolean | null
          authorized?: boolean | null
          authorized_date?: string | null
          canned_job_id?: number | null
          completed_date?: string | null
          created_date?: string | null
          customer_id?: number | null
          discount_total_cents?: number | null
          fee_total_cents?: number | null
          id: number
          job_category_name?: string | null
          labor_hours?: number | null
          labor_total_cents?: number | null
          logged_hours?: number | null
          name?: string | null
          note?: string | null
          parts_total_cents?: number | null
          ro_id: number
          selected?: boolean | null
          shop_id: number
          sort?: number | null
          subtotal_cents?: number | null
          technician_id?: number | null
          updated_date?: string | null
          vehicle_id?: number | null
        }
        Update: {
          archived?: boolean | null
          authorized?: boolean | null
          authorized_date?: string | null
          canned_job_id?: number | null
          completed_date?: string | null
          created_date?: string | null
          customer_id?: number | null
          discount_total_cents?: number | null
          fee_total_cents?: number | null
          id?: number
          job_category_name?: string | null
          labor_hours?: number | null
          labor_total_cents?: number | null
          logged_hours?: number | null
          name?: string | null
          note?: string | null
          parts_total_cents?: number | null
          ro_id?: number
          selected?: boolean | null
          shop_id?: number
          sort?: number | null
          subtotal_cents?: number | null
          technician_id?: number | null
          updated_date?: string | null
          vehicle_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tekmetric_ro_jobs_ro_id_fkey"
            columns: ["ro_id"]
            isOneToOne: false
            referencedRelation: "tekmetric_ros"
            referencedColumns: ["id"]
          },
        ]
      }
      tekmetric_ro_sublet_items: {
        Row: {
          complete: boolean | null
          cost_cents: number | null
          id: number
          name: string | null
          price_cents: number | null
          ro_id: number
          sublet_id: number
        }
        Insert: {
          complete?: boolean | null
          cost_cents?: number | null
          id: number
          name?: string | null
          price_cents?: number | null
          ro_id: number
          sublet_id: number
        }
        Update: {
          complete?: boolean | null
          cost_cents?: number | null
          id?: number
          name?: string | null
          price_cents?: number | null
          ro_id?: number
          sublet_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "tekmetric_ro_sublet_items_sublet_id_fkey"
            columns: ["sublet_id"]
            isOneToOne: false
            referencedRelation: "tekmetric_ro_sublets"
            referencedColumns: ["id"]
          },
        ]
      }
      tekmetric_ro_sublets: {
        Row: {
          ap_amount_cents: number | null
          ap_amount_paid_cents: number | null
          ap_id: number | null
          ap_payment_details: Json | null
          ap_payment_type: Json | null
          authorized: boolean | null
          authorized_date: string | null
          cost_cents: number | null
          feeable: boolean | null
          id: number
          name: string | null
          note: string | null
          price_cents: number | null
          ro_id: number
          selected: boolean | null
          sort: number | null
          tax_sublet: boolean | null
          vendor_id: number | null
          vendor_name: string | null
          vendor_nickname: string | null
          vendor_phone: string | null
          vendor_website: string | null
        }
        Insert: {
          ap_amount_cents?: number | null
          ap_amount_paid_cents?: number | null
          ap_id?: number | null
          ap_payment_details?: Json | null
          ap_payment_type?: Json | null
          authorized?: boolean | null
          authorized_date?: string | null
          cost_cents?: number | null
          feeable?: boolean | null
          id: number
          name?: string | null
          note?: string | null
          price_cents?: number | null
          ro_id: number
          selected?: boolean | null
          sort?: number | null
          tax_sublet?: boolean | null
          vendor_id?: number | null
          vendor_name?: string | null
          vendor_nickname?: string | null
          vendor_phone?: string | null
          vendor_website?: string | null
        }
        Update: {
          ap_amount_cents?: number | null
          ap_amount_paid_cents?: number | null
          ap_id?: number | null
          ap_payment_details?: Json | null
          ap_payment_type?: Json | null
          authorized?: boolean | null
          authorized_date?: string | null
          cost_cents?: number | null
          feeable?: boolean | null
          id?: number
          name?: string | null
          note?: string | null
          price_cents?: number | null
          ro_id?: number
          selected?: boolean | null
          sort?: number | null
          tax_sublet?: boolean | null
          vendor_id?: number | null
          vendor_name?: string | null
          vendor_nickname?: string | null
          vendor_phone?: string | null
          vendor_website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tekmetric_ro_sublets_ro_id_fkey"
            columns: ["ro_id"]
            isOneToOne: false
            referencedRelation: "tekmetric_ros"
            referencedColumns: ["id"]
          },
        ]
      }
      tekmetric_ros: {
        Row: {
          amount_paid_cents: number | null
          appointment_id: number | null
          color: string | null
          completed_date: string | null
          created_date: string | null
          custom_label_name: string | null
          customer_id: number | null
          customer_time_out: string | null
          deleted_date: string | null
          discount_total_cents: number | null
          estimate_share_date: string | null
          estimate_url: string | null
          fee_total_cents: number | null
          id: number
          inspection_share_date: string | null
          inspection_url: string | null
          invoice_share_date: string | null
          invoice_url: string | null
          keytag: string | null
          label_code: string | null
          label_id: number | null
          label_name: string | null
          label_status_code: string | null
          label_status_id: number | null
          label_status_name: string | null
          label_status_posted_or_accrecv: boolean | null
          labor_sales_cents: number | null
          lead_source: string | null
          miles_in: number | null
          miles_out: number | null
          parts_sales_cents: number | null
          posted_date: string | null
          raw: Json
          repair_order_number: number | null
          service_writer_id: number | null
          shop_id: number
          status_code: string | null
          status_id: number | null
          status_name: string | null
          status_posted_or_accrecv: boolean | null
          sublet_sales_cents: number | null
          synced_at: string
          taxes_cents: number | null
          technician_id: number | null
          total_sales_cents: number | null
          updated_date: string | null
          vehicle_id: number | null
        }
        Insert: {
          amount_paid_cents?: number | null
          appointment_id?: number | null
          color?: string | null
          completed_date?: string | null
          created_date?: string | null
          custom_label_name?: string | null
          customer_id?: number | null
          customer_time_out?: string | null
          deleted_date?: string | null
          discount_total_cents?: number | null
          estimate_share_date?: string | null
          estimate_url?: string | null
          fee_total_cents?: number | null
          id: number
          inspection_share_date?: string | null
          inspection_url?: string | null
          invoice_share_date?: string | null
          invoice_url?: string | null
          keytag?: string | null
          label_code?: string | null
          label_id?: number | null
          label_name?: string | null
          label_status_code?: string | null
          label_status_id?: number | null
          label_status_name?: string | null
          label_status_posted_or_accrecv?: boolean | null
          labor_sales_cents?: number | null
          lead_source?: string | null
          miles_in?: number | null
          miles_out?: number | null
          parts_sales_cents?: number | null
          posted_date?: string | null
          raw: Json
          repair_order_number?: number | null
          service_writer_id?: number | null
          shop_id: number
          status_code?: string | null
          status_id?: number | null
          status_name?: string | null
          status_posted_or_accrecv?: boolean | null
          sublet_sales_cents?: number | null
          synced_at?: string
          taxes_cents?: number | null
          technician_id?: number | null
          total_sales_cents?: number | null
          updated_date?: string | null
          vehicle_id?: number | null
        }
        Update: {
          amount_paid_cents?: number | null
          appointment_id?: number | null
          color?: string | null
          completed_date?: string | null
          created_date?: string | null
          custom_label_name?: string | null
          customer_id?: number | null
          customer_time_out?: string | null
          deleted_date?: string | null
          discount_total_cents?: number | null
          estimate_share_date?: string | null
          estimate_url?: string | null
          fee_total_cents?: number | null
          id?: number
          inspection_share_date?: string | null
          inspection_url?: string | null
          invoice_share_date?: string | null
          invoice_url?: string | null
          keytag?: string | null
          label_code?: string | null
          label_id?: number | null
          label_name?: string | null
          label_status_code?: string | null
          label_status_id?: number | null
          label_status_name?: string | null
          label_status_posted_or_accrecv?: boolean | null
          labor_sales_cents?: number | null
          lead_source?: string | null
          miles_in?: number | null
          miles_out?: number | null
          parts_sales_cents?: number | null
          posted_date?: string | null
          raw?: Json
          repair_order_number?: number | null
          service_writer_id?: number | null
          shop_id?: number
          status_code?: string | null
          status_id?: number | null
          status_name?: string | null
          status_posted_or_accrecv?: boolean | null
          sublet_sales_cents?: number | null
          synced_at?: string
          taxes_cents?: number | null
          technician_id?: number | null
          total_sales_cents?: number | null
          updated_date?: string | null
          vehicle_id?: number | null
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
      telnyx_webhook_events: {
        Row: {
          event_type: string
          id: string
          occurred_at: string | null
          payload: Json
          raw_headers: Json | null
          raw_query_string: string | null
          received_at: string
          shop_id: number | null
          signature_verified: boolean
          telnyx_event_id: string | null
        }
        Insert: {
          event_type?: string
          id?: string
          occurred_at?: string | null
          payload: Json
          raw_headers?: Json | null
          raw_query_string?: string | null
          received_at?: string
          shop_id?: number | null
          signature_verified?: boolean
          telnyx_event_id?: string | null
        }
        Update: {
          event_type?: string
          id?: string
          occurred_at?: string | null
          payload?: Json
          raw_headers?: Json | null
          raw_query_string?: string | null
          received_at?: string
          shop_id?: number | null
          signature_verified?: boolean
          telnyx_event_id?: string | null
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
      apply_appointment_default_limits_upload: {
        Args: {
          p_audit: Json
          p_diff: Json
          p_shop_id: number
          p_snapshot: Json
        }
        Returns: number
      }
      apply_closed_dates_upload: {
        Args: {
          p_audit: Json
          p_diff: Json
          p_shop_id: number
          p_snapshot: Json
        }
        Returns: number
      }
      apply_concern_category_guideline_upload: {
        Args: {
          p_audit: Json
          p_category_slug: string
          p_diff: Json
          p_shop_id: number
          p_snapshot: Json
        }
        Returns: number
      }
      apply_concern_category_upload: {
        Args: {
          p_audit: Json
          p_category_slug: string
          p_diff: Json
          p_shop_id: number
          p_snapshot: Json
        }
        Returns: number
      }
      apply_concern_questions_flat_upload: {
        Args: {
          p_audit: Json
          p_diff: Json
          p_shop_id: number
          p_snapshot: Json
        }
        Returns: number
      }
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
      auto_resolve_manual_review: {
        Args: { p_code: string; p_reason: string; p_source?: string }
        Returns: {
          audit_log_id: number
          failure_reason: string
          ok: boolean
          review_id: number
        }[]
      }
      auto_resolve_reviews_for_ro: {
        Args: { p_reason: string; p_ro_id: number; p_source?: string }
        Returns: number
      }
      back_office_close_open_ro: {
        Args: {
          p_closed_at: string
          p_ro_number: string
          p_shop_id: number
          p_tekmetric_ro_id: number
        }
        Returns: string[]
      }
      back_office_create_issue: {
        Args: {
          p_actor: string
          p_actor_app: string
          p_kind: string
          p_payload: Json
          p_shop_id: number
          p_source: string
        }
        Returns: string
      }
      back_office_dashboard_counts: {
        Args: {
          p_month_start: string
          p_shop_id: number
          p_stale_hours: number
        }
        Returns: Json
      }
      back_office_send_to_sa: {
        Args: {
          p_actor: string
          p_issue_id: string
          p_note: string
          p_shop_id: number
        }
        Returns: string
      }
      back_office_stamp_email: {
        Args: { p_action: string; p_error: string; p_issue_id: string }
        Returns: undefined
      }
      back_office_submit_fix: {
        Args: {
          p_actor: string
          p_issue_id: string
          p_sa_note: string
          p_shop_id: number
        }
        Returns: boolean
      }
      back_office_upsert_reopened: {
        Args: { p_cycle: Json; p_shop_id: number; p_tekmetric_ro_id: number }
        Returns: {
          issue_id: string
          was_created: boolean
        }[]
      }
      back_office_upsert_settings: {
        Args: { p_back_office: Json; p_realm_id: string; p_shop_id: number }
        Returns: undefined
      }
      back_office_verify: {
        Args: {
          p_actor: string
          p_actor_app: string
          p_issue_id: string
          p_shop_id: number
        }
        Returns: boolean
      }
      canonical_state_appointment_default_limits: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: string
      }
      canonical_state_closed_dates_future: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: string
      }
      canonical_state_concern_category_guideline: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: string
      }
      canonical_state_concern_category_upload: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: string
      }
      canonical_state_concern_questions_flat: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: string
      }
      canonical_state_question_required_facts_v2: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: string
      }
      canonical_state_routine_services_v2: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: string
      }
      canonical_state_subcategory_descriptions_v2: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: string
      }
      canonical_state_subcategory_service_map_v2: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: string
      }
      canonical_state_testing_services_v2: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: string
      }
      check_and_increment_rate_limit: {
        Args: { p_key: string; p_max: number; p_window_seconds: number }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
        }[]
      }
      check_manual_review_lockout: {
        Args: { p_user_label: string }
        Returns: boolean
      }
      compute_current_canonical_for_kind: {
        Args: { p_kind: string; p_shop_id: number; p_snapshot: Json }
        Returns: string
      }
      compute_unified_diff: {
        Args: { p_current: string; p_expected: string; p_max_lines?: number }
        Returns: string
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
      document_intake_claim_cron_lease: {
        Args: { p_run_id: string; p_ttl_minutes?: number }
        Returns: boolean
      }
      document_intake_orphan_objects: {
        Args: { p_bucket: string }
        Returns: {
          mimetype: string
          name: string
          size_bytes: number
        }[]
      }
      document_intake_release_cron_lease: {
        Args: { p_run_id: string }
        Returns: boolean
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
      list_scheduler_admin_audit_log_filtered: {
        Args: {
          p_limit: number
          p_only_successful: boolean
          p_shop_id: number
          p_surface_filter: string
          p_table_filter: string
        }
        Returns: {
          diff_summary: Json
          error_message: string
          id: number
          md_content_hash: string
          oauth_client_id: string
          occurred_at: string
          operation: string
          pre_state_snapshot: Json
          reverts_upload_id: number
          rows_added: number
          rows_deactivated: number
          rows_modified: number
          shop_id: number
          snapshot_pruned_at: string
          successor_revert_id: number
          table_name: string
          user_label: string
        }[]
      }
      lock_surface_for_kind: {
        Args: { p_kind: string; p_shop_id: number }
        Returns: undefined
      }
      lock_targets_for_kind: {
        Args: { p_kind: string; p_shop_id: number; p_snapshot: Json }
        Returns: number
      }
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
      process_sms_stop: { Args: { p_phone: string }; Returns: Json }
      qbo_accounts_sync: {
        Args: { p_accounts: Json; p_realm_id: string; p_shop_id: number }
        Returns: number
      }
      qbo_disconnect: { Args: { p_realm_id: string }; Returns: boolean }
      qbo_get_connection: {
        Args: { p_realm_id?: string }
        Returns: {
          access_token: string
          access_token_expires_at: string
          environment: string
          realm_id: string
          refresh_token: string
          refresh_token_expires_at: string
        }[]
      }
      qbo_persist_tokens: {
        Args: {
          p_access_token: string
          p_access_token_expires_at: string
          p_realm_id: string
          p_refresh_token: string
          p_refresh_token_expires_at: string
        }
        Returns: undefined
      }
      qbo_resolve_realm_for_shop: {
        Args: { p_shop_id: number }
        Returns: string
      }
      qteklink_accept_daily_variance: {
        Args: {
          p_accepted_by: string
          p_id: string
          p_realm_id: string
          p_shop_id: number
        }
        Returns: boolean
      }
      qteklink_acknowledge_daily_posting: {
        Args: {
          p_acknowledged_by: string
          p_id: string
          p_realm_id: string
          p_shop_id: number
        }
        Returns: boolean
      }
      qteklink_add_allowed_user: {
        Args: {
          p_added_by: string
          p_email: string
          p_full_name: string
          p_role: string
          p_shop_id: number
        }
        Returns: string
      }
      qteklink_advance_projection_watermark: {
        Args: { p_realm_id: string; p_shop_id: number; p_watermark: string }
        Returns: string
      }
      qteklink_approve_daily_posting: {
        Args: {
          p_approved_by: string
          p_id: string
          p_realm_id: string
          p_shop_id: number
        }
        Returns: boolean
      }
      qteklink_approve_date_move: {
        Args: {
          p_approved_by: string
          p_id: string
          p_realm_id: string
          p_shop_id: number
        }
        Returns: boolean
      }
      qteklink_approve_payment_redate: {
        Args: {
          p_approved_by: string
          p_id: string
          p_realm_id: string
          p_shop_id: number
        }
        Returns: boolean
      }
      qteklink_approve_posting: {
        Args: {
          p_approved_by: string
          p_id: string
          p_realm_id: string
          p_shop_id: number
        }
        Returns: boolean
      }
      qteklink_auto_resolve_review_items: {
        Args: {
          p_ids: string[]
          p_realm_id: string
          p_resolution?: Json
          p_resolved_by: string
          p_shop_id: number
        }
        Returns: number
      }
      qteklink_claim_daily_posting_by_id: {
        Args: {
          p_id: string
          p_lease_seconds: number
          p_realm_id: string
          p_shop_id: number
        }
        Returns: {
          action: string
          approved_at: string | null
          approved_by: string | null
          business_date: string
          category: string
          constituents: Json
          created_at: string
          id: string
          lease_until: string | null
          posting_version: number
          proposed_je: Json
          qbo_je_id: string | null
          qbo_response: Json | null
          qbo_sync_token: string | null
          realm_id: string
          rejected_at: string | null
          rejected_by: string | null
          requestid: string
          shop_id: number
          source_state_hash: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "qteklink_daily_postings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      qteklink_claim_posting: {
        Args: { p_lease_seconds: number; p_realm_id: string; p_shop_id: number }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          batch_date: string
          created_at: string
          id: string
          kind: string
          lease_until: string | null
          payment_id: number | null
          posting_version: number
          proposed_je: Json
          qbo_je_id: string | null
          qbo_response: Json | null
          realm_id: string
          recon_status: string
          requestid: string
          shop_id: number
          source_state_hash: string
          status: string
          tekmetric_ro_id: number
          txn_date: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "qteklink_postings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      qteklink_claim_posting_by_id: {
        Args: {
          p_id: string
          p_lease_seconds: number
          p_realm_id: string
          p_shop_id: number
        }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          batch_date: string
          created_at: string
          id: string
          kind: string
          lease_until: string | null
          payment_id: number | null
          posting_version: number
          proposed_je: Json
          qbo_je_id: string | null
          qbo_response: Json | null
          realm_id: string
          recon_status: string
          requestid: string
          shop_id: number
          source_state_hash: string
          status: string
          tekmetric_ro_id: number
          txn_date: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "qteklink_postings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      qteklink_deactivate_mapping: {
        Args: { p_id: string; p_realm_id: string; p_shop_id: number }
        Returns: boolean
      }
      qteklink_delete_manual_payment: {
        Args: {
          p_deleted_by: string
          p_id: string
          p_realm_id: string
          p_shop_id: number
        }
        Returns: boolean
      }
      qteklink_discover_tekmetric_items: {
        Args: { p_realm_id: string; p_shop_id: number }
        Returns: {
          kind: string
          seen: number
          source_key: string
        }[]
      }
      qteklink_enqueue_daily_posting: {
        Args: {
          p_action: string
          p_business_date: string
          p_category: string
          p_constituents: Json
          p_posting_version: number
          p_proposed_je: Json
          p_realm_id: string
          p_requestid: string
          p_shop_id: number
          p_source_state_hash: string
        }
        Returns: string
      }
      qteklink_enqueue_posting: {
        Args: {
          p_batch_date: string
          p_kind: string
          p_payment_id: number
          p_posting_version: number
          p_proposed_je: Json
          p_realm_id: string
          p_recon_status: string
          p_requestid: string
          p_shop_id: number
          p_source_state_hash: string
          p_tekmetric_ro_id: number
          p_txn_date: string
        }
        Returns: string
      }
      qteklink_get_allowed_user: {
        Args: { p_object_id: string }
        Returns: {
          active: boolean
          email: string
          entra_object_id: string
          full_name: string
          id: string
          role: string
          shop_id: number
        }[]
      }
      qteklink_kind_accepts_role: {
        Args: { p_kind: string; p_role: string }
        Returns: boolean
      }
      qteklink_mark_daily_failed: {
        Args: {
          p_id: string
          p_qbo_response: Json
          p_realm_id: string
          p_retryable: boolean
          p_shop_id: number
        }
        Returns: boolean
      }
      qteklink_mark_daily_posted: {
        Args: {
          p_id: string
          p_qbo_je_id: string
          p_qbo_response: Json
          p_qbo_sync_token: string
          p_realm_id: string
          p_shop_id: number
        }
        Returns: boolean
      }
      qteklink_mark_failed: {
        Args: {
          p_id: string
          p_qbo_response: Json
          p_realm_id: string
          p_retryable: boolean
          p_shop_id: number
        }
        Returns: boolean
      }
      qteklink_mark_payment_redate_notified: {
        Args: { p_id: string; p_realm_id: string; p_shop_id: number }
        Returns: boolean
      }
      qteklink_mark_posted: {
        Args: {
          p_id: string
          p_qbo_je_id: string
          p_qbo_response: Json
          p_realm_id: string
          p_shop_id: number
        }
        Returns: boolean
      }
      qteklink_mirror_apply_ro: {
        Args: {
          p_concerns: Json
          p_discounts: Json
          p_fees: Json
          p_job_discounts: Json
          p_job_fees: Json
          p_jobs: Json
          p_labor: Json
          p_parts: Json
          p_ro: Json
          p_sublet_items: Json
          p_sublets: Json
        }
        Returns: undefined
      }
      qteklink_payroll_adjust_pto: {
        Args: {
          p_actor: string
          p_employee: string
          p_hours: number
          p_kind: string
          p_reason: string
          p_shop: number
        }
        Returns: Json
      }
      qteklink_payroll_apply_entry_patch: {
        Args: {
          p_actor_label: string
          p_actor_user_id: string
          p_batch_id: string
          p_fn: string
          p_patch: Json
          p_row: Database["public"]["Tables"]["qteklink_payroll_run_employees"]["Row"]
        }
        Returns: undefined
      }
      qteklink_payroll_complete_run: {
        Args: {
          p_actor_label: string
          p_actor_user_id: string
          p_confirm_token: string
          p_dry_run: boolean
          p_pto_entries?: Json
          p_run_id: string
          p_snapshot: Json
          p_state_hash: string
        }
        Returns: Json
      }
      qteklink_payroll_create_run: {
        Args: {
          p_actor_label: string
          p_actor_user_id: string
          p_period_start: string
          p_shop_id: number
        }
        Returns: string
      }
      qteklink_payroll_distinct_job_categories: {
        Args: { p_shop_id: number }
        Returns: string[]
      }
      qteklink_payroll_issue_confirm_token: {
        Args: {
          p_action_kind: string
          p_actor_label: string
          p_actor_user_id: string
          p_run_id: string
          p_scope_hash: string
        }
        Returns: {
          expires_at: string
          token_id: string
        }[]
      }
      qteklink_payroll_log_email: {
        Args: {
          p_detail?: string
          p_employee?: string
          p_kind: string
          p_recipient: string
          p_run?: string
          p_shop: number
          p_status?: string
          p_subject: string
        }
        Returns: string
      }
      qteklink_payroll_mark_open_runs_stale: {
        Args: { p_shop_id: number }
        Returns: number
      }
      qteklink_payroll_state_hash: {
        Args: { p_run_id: string }
        Returns: string
      }
      qteklink_payroll_store_live_snapshot: {
        Args: {
          p_compute_started_at: string
          p_computed_at: string
          p_run_id: string
          p_snapshot: Json
        }
        Returns: undefined
      }
      qteklink_payroll_sync_run_roster: {
        Args: {
          p_actor_label: string
          p_actor_user_id: string
          p_run_id: string
        }
        Returns: Json
      }
      qteklink_payroll_transition_email: {
        Args: {
          p_detail?: string
          p_email_id: string
          p_recipient?: string
          p_subject?: string
          p_to_status: string
        }
        Returns: Json
      }
      qteklink_payroll_update_employee_profile: {
        Args: {
          p_actor?: string
          p_archived?: boolean
          p_employee: string
          p_patch?: Json
          p_shop: number
        }
        Returns: undefined
      }
      qteklink_payroll_update_entries: {
        Args: {
          p_actor_label: string
          p_actor_user_id: string
          p_patches: Json
          p_run_id: string
        }
        Returns: Json
      }
      qteklink_payroll_update_entry: {
        Args: {
          p_actor_label: string
          p_actor_user_id: string
          p_patch: Json
          p_run_employee_id: string
        }
        Returns: undefined
      }
      qteklink_payroll_update_run: {
        Args: {
          p_actor_label: string
          p_actor_user_id: string
          p_patch: Json
          p_run_id: string
        }
        Returns: undefined
      }
      qteklink_payroll_upsert_employee: {
        Args: {
          p_actor_label: string
          p_actor_user_id: string
          p_archived: boolean
          p_display_name: string
          p_employee_id: string
          p_pay_config: Json
          p_role: string
          p_shop_id: number
          p_tekmetric_employee_id: number
        }
        Returns: string
      }
      qteklink_payroll_validate_overrides: {
        Args: { p_context: string; p_overrides: Json }
        Returns: undefined
      }
      qteklink_payroll_validate_pay_config: {
        Args: {
          p_allow_rates_w2: boolean
          p_context: string
          p_pay_config: Json
          p_role: string
        }
        Returns: undefined
      }
      qteklink_payroll_void_run: {
        Args: {
          p_actor_label: string
          p_actor_user_id: string
          p_confirm_token: string
          p_dry_run: boolean
          p_reason: string
          p_run_id: string
          p_state_hash: string
        }
        Returns: Json
      }
      qteklink_record_manual_payment: {
        Args: {
          p_amount_cents: number
          p_cc_fee_cents: number
          p_created_by: string
          p_method: string
          p_other_payment_type: string
          p_payment_date: string
          p_realm_id: string
          p_repair_order_id: number
          p_shop_id: number
        }
        Returns: string
      }
      qteklink_refresh_daily_posting: {
        Args: {
          p_action: string
          p_constituents: Json
          p_id: string
          p_proposed_je: Json
          p_realm_id: string
          p_requestid?: string
          p_shop_id: number
          p_source_state_hash: string
        }
        Returns: boolean
      }
      qteklink_reject_daily_posting: {
        Args: {
          p_id: string
          p_realm_id: string
          p_rejected_by: string
          p_shop_id: number
        }
        Returns: boolean
      }
      qteklink_reject_posting: {
        Args: {
          p_id: string
          p_realm_id: string
          p_rejected_by: string
          p_shop_id: number
        }
        Returns: boolean
      }
      qteklink_remove_allowed_user: {
        Args: { p_id: string; p_shop_id: number }
        Returns: boolean
      }
      qteklink_requeue_expired_daily_leases: {
        Args: { p_realm_id: string; p_shop_id: number }
        Returns: number
      }
      qteklink_requeue_expired_leases: {
        Args: { p_realm_id: string; p_shop_id: number }
        Returns: number
      }
      qteklink_resolve_allowed_user: {
        Args: { p_user_id: string }
        Returns: {
          active: boolean
          email: string
          entra_object_id: string
          full_name: string
          id: string
          role: string
          shop_id: number
        }[]
      }
      qteklink_resolve_date_move: {
        Args: { p_id: string; p_realm_id: string; p_shop_id: number }
        Returns: boolean
      }
      qteklink_resolve_payment_redate: {
        Args: { p_id: string; p_realm_id: string; p_shop_id: number }
        Returns: boolean
      }
      qteklink_resolve_review_item: {
        Args: {
          p_id: string
          p_realm_id: string
          p_resolution: Json
          p_resolved_by: string
          p_shop_id: number
        }
        Returns: boolean
      }
      qteklink_retry_daily_posting: {
        Args: {
          p_id: string
          p_realm_id: string
          p_retried_by: string
          p_shop_id: number
        }
        Returns: boolean
      }
      qteklink_role_accepts_type: {
        Args: { p_account_type: string; p_role: string }
        Returns: boolean
      }
      qteklink_set_allowed_user_active: {
        Args: { p_active: boolean; p_id: string; p_shop_id: number }
        Returns: boolean
      }
      qteklink_set_allowed_user_role: {
        Args: { p_id: string; p_role: string; p_shop_id: number }
        Returns: boolean
      }
      qteklink_set_mapping: {
        Args: {
          p_kind: string
          p_pass_through?: boolean
          p_posting_role: string
          p_qbo_account_id: string
          p_realm_id: string
          p_shop_id: number
          p_source_id: string
          p_source_key: string
        }
        Returns: string
      }
      qteklink_unapprove_date_move: {
        Args: {
          p_id: string
          p_realm_id: string
          p_shop_id: number
          p_unapproved_by: string
        }
        Returns: boolean
      }
      qteklink_upsert_customers: {
        Args: { p_customers: Json; p_shop_id: number }
        Returns: number
      }
      qteklink_upsert_date_move: {
        Args: {
          p_new_business_date: string
          p_new_total_cents: number
          p_original_business_date: string
          p_original_total_cents: number
          p_realm_id: string
          p_ro_number: string
          p_shop_id: number
          p_tekmetric_ro_id: number
        }
        Returns: {
          changed: boolean
          id: string
        }[]
      }
      qteklink_upsert_payment_redate: {
        Args: {
          p_amount_cents: number
          p_business_date: string
          p_customer_name: string
          p_payment_id: number
          p_realm_id: string
          p_ro_number: string
          p_shop_id: number
          p_tekmetric_ro_id: number
        }
        Returns: {
          changed: boolean
          id: string
        }[]
      }
      qteklink_upsert_payment_state: {
        Args: { p_realm_id: string; p_shop_id: number; p_states: Json }
        Returns: number
      }
      qteklink_upsert_review_item: {
        Args: {
          p_detail: Json
          p_kind: string
          p_realm_id: string
          p_shop_id: number
          p_subject_kind: string
          p_subject_ref: string
        }
        Returns: string
      }
      qteklink_upsert_ro_state: {
        Args: {
          p_last_posted_date: string
          p_last_total_cents: number
          p_realm_id: string
          p_ro_number: string
          p_sale_qbo_je_id: string
          p_sale_qbo_sync_token: string
          p_shop_id: number
          p_source_snapshot_hash: string
          p_status: string
          p_tekmetric_ro_id: number
        }
        Returns: string
      }
      qteklink_upsert_ros: {
        Args: { p_ros: Json; p_shop_id: number }
        Returns: number
      }
      qteklink_upsert_settings: {
        Args: {
          p_auto_post: boolean
          p_date_change_alert_emails?: string
          p_day_correction_alert_emails?: string
          p_payroll?: Json
          p_realm_id: string
          p_sales_tax_rate_bps: number
          p_settle_window_minutes: number
          p_shop_id: number
          p_shop_timezone: string
          p_tire_fee_cents: number
        }
        Returns: undefined
      }
      record_keytag_patched: {
        Args: { p_error?: string; p_ro_id: number; p_success: boolean }
        Returns: undefined
      }
      record_tekmetric_ingest_alert: {
        Args: {
          p_level: string
          p_ro_id: number
          p_sample: Json
          p_unknown_keys: string[]
        }
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
      revert_appointment_default_limits: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: {
          deactivated: number
          deleted: number
          details: Json
          restored: number
        }[]
      }
      revert_closed_dates_future: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: {
          deactivated: number
          deleted: number
          details: Json
          restored: number
        }[]
      }
      revert_concern_category_guideline: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: {
          deactivated: number
          deleted: number
          details: Json
          restored: number
        }[]
      }
      revert_concern_category_upload: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: {
          deactivated: number
          deleted: number
          details: Json
          restored: number
        }[]
      }
      revert_concern_questions_flat: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: {
          deactivated: number
          deleted: number
          details: Json
          restored: number
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
      revert_md_upload_apply: {
        Args: {
          p_actor_email: string
          p_attempt_id: number
          p_dry_run: boolean
          p_expected_confirm_token: string
          p_force_no_after_hash: boolean
          p_oauth_client_id: string
          p_shop_id: number
          p_upload_id: number
        }
        Returns: {
          audit_log_id: number
          confirm_token: string
          deactivated: number
          deleted: number
          restored: number
        }[]
      }
      revert_md_upload_attempt: {
        Args: {
          p_actor_email: string
          p_dry_run: boolean
          p_expected_confirm_token: string
          p_force_no_after_hash: boolean
          p_oauth_client_id: string
          p_shop_id: number
          p_upload_id: number
        }
        Returns: {
          attempt_id: number
          audit_log_id: number
          confirm_token: string
          deactivated: number
          deleted: number
          dry_run: boolean
          error_message: string
          outcome: string
          reason_code: string
          restored: number
        }[]
      }
      revert_question_required_facts_v2: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: {
          deactivated: number
          deleted: number
          details: Json
          restored: number
        }[]
      }
      revert_routine_services_v2: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: {
          deactivated: number
          deleted: number
          details: Json
          restored: number
        }[]
      }
      revert_subcategory_descriptions_v2: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: {
          deactivated: number
          deleted: number
          details: Json
          restored: number
        }[]
      }
      revert_subcategory_service_map_v2: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: {
          deactivated: number
          deleted: number
          details: Json
          restored: number
        }[]
      }
      revert_testing_services_v2: {
        Args: { p_shop_id: number; p_snapshot: Json }
        Returns: {
          deactivated: number
          deleted: number
          details: Json
          restored: number
        }[]
      }
      run_admin_snapshot_prune: { Args: never; Returns: undefined }
      run_keytag_bulk_reconcile_with_checkin: {
        Args: never
        Returns: undefined
      }
      run_keytag_daily_report_with_checkin: { Args: never; Returns: undefined }
      run_rate_limit_buckets_prune: { Args: never; Returns: undefined }
      run_scheduler_appointments_sync_with_checkin: {
        Args: never
        Returns: undefined
      }
      run_scheduler_transcript_dispatcher_with_checkin: {
        Args: never
        Returns: undefined
      }
      scheduler_admin_add_closed_date: {
        Args: {
          p_actor: string
          p_closed_date: string
          p_reason: string
          p_shop_id: number
        }
        Returns: Json
      }
      scheduler_admin_direct_log: {
        Args: {
          p_actor: string
          p_added: number
          p_deactivated: number
          p_diff: Json
          p_modified: number
          p_shop_id: number
          p_snapshot: Json
          p_surface: string
          p_table_name: string
        }
        Returns: number
      }
      scheduler_admin_remove_closed_date: {
        Args: { p_actor: string; p_closed_date: string; p_shop_id: number }
        Returns: Json
      }
      scheduler_admin_set_appointment_limits: {
        Args: {
          p_actor: string
          p_day_of_week: number
          p_expected_updated_at?: string
          p_patch: Json
          p_shop_id: number
        }
        Returns: Json
      }
      scheduler_admin_update_category_guideline: {
        Args: {
          p_actor: string
          p_category: string
          p_display_label: string
          p_expected_updated_at?: string
          p_guideline_prose: string
          p_shop_id: number
        }
        Returns: Json
      }
      scheduler_admin_update_question_required_facts: {
        Args: {
          p_actor: string
          p_expected_updated_at?: string
          p_question_id: number
          p_required_facts: string[]
          p_shop_id: number
        }
        Returns: Json
      }
      scheduler_admin_update_subcategory_enrichment: {
        Args: {
          p_actor: string
          p_expected_updated_at?: string
          p_patch: Json
          p_shop_id: number
          p_subcategory_id: number
        }
        Returns: Json
      }
      scheduler_admin_update_subcategory_service_map: {
        Args: {
          p_actor: string
          p_eligible_keys: string[]
          p_expected_updated_at?: string
          p_shop_id: number
          p_subcategory_id: number
        }
        Returns: Json
      }
      scheduler_admin_upsert_concern_question: {
        Args: {
          p_actor: string
          p_expected_updated_at?: string
          p_question: Json
          p_shop_id: number
        }
        Returns: Json
      }
      scheduler_admin_upsert_routine_service: {
        Args: {
          p_actor: string
          p_expected_updated_at?: string
          p_service: Json
          p_shop_id: number
        }
        Returns: Json
      }
      scheduler_admin_upsert_testing_service: {
        Args: {
          p_actor: string
          p_expected_updated_at?: string
          p_service: Json
          p_shop_id: number
        }
        Returns: Json
      }
      scheduler_deactivate_appointment_type: {
        Args: { p_actor: string; p_id: string; p_shop_id: number }
        Returns: Json
      }
      scheduler_get_service_role_key: { Args: never; Returns: string }
      scheduler_invoke_edge_function: {
        Args: { p_body?: Json; p_function_name: string }
        Returns: number
      }
      scheduler_reset_card_text: {
        Args: {
          p_actor: string
          p_card_key: string
          p_expected_updated_at?: string
          p_shop_id: number
          p_slot_key: string
        }
        Returns: Json
      }
      scheduler_set_appointment_type: {
        Args: {
          p_actor: string
          p_expected_updated_at?: string
          p_shop_id: number
          p_type: Json
        }
        Returns: Json
      }
      scheduler_set_card_text: {
        Args: {
          p_actor: string
          p_allowed_merge_fields: string[]
          p_body: string
          p_card_key: string
          p_default_body: string
          p_expected_updated_at?: string
          p_label: string
          p_shop_id: number
          p_slot_key: string
          p_sort: number
        }
        Returns: Json
      }
      scheduler_set_message_template: {
        Args: {
          p_actor: string
          p_body: string
          p_channel: string
          p_expected_updated_at?: string
          p_kind: string
          p_shop_id: number
          p_subject: string
          p_type_id: string
        }
        Returns: Json
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
