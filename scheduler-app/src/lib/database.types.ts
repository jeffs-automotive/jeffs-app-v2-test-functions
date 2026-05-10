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
      appointment_holds: {
        Row: {
          appointment_type: string
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
          color: string | null
          created_at: string
          customer_id: number | null
          deleted_at: string | null
          description: string | null
          end_time: string
          id: string
          ride_option: string | null
          shop_id: number
          source: string
          start_time: string
          tekmetric_appointment_id: number
          tekmetric_synced_at: string
          title: string | null
          updated_at: string
          vehicle_id: number | null
        }
        Insert: {
          appointment_option?: string | null
          appointment_status: string
          appointment_type: string
          color?: string | null
          created_at?: string
          customer_id?: number | null
          deleted_at?: string | null
          description?: string | null
          end_time: string
          id?: string
          ride_option?: string | null
          shop_id: number
          source?: string
          start_time: string
          tekmetric_appointment_id: number
          tekmetric_synced_at?: string
          title?: string | null
          updated_at?: string
          vehicle_id?: number | null
        }
        Update: {
          appointment_option?: string | null
          appointment_status?: string
          appointment_type?: string
          color?: string | null
          created_at?: string
          customer_id?: number | null
          deleted_at?: string | null
          description?: string | null
          end_time?: string
          id?: string
          ride_option?: string | null
          shop_id?: number
          source?: string
          start_time?: string
          tekmetric_appointment_id?: number
          tekmetric_synced_at?: string
          title?: string | null
          updated_at?: string
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
          appointment_id: number | null
          channel: string
          cookie_session: string | null
          customer_id: number | null
          customer_self_identified: string | null
          ended_at: string | null
          id: string
          last_active_at: string
          opted_out_at: string | null
          outcome: string | null
          phone_e164: string | null
          sentiment: string | null
          shop_id: number
          started_at: string
          status: string
          vehicle_id: number | null
        }
        Insert: {
          appointment_id?: number | null
          channel: string
          cookie_session?: string | null
          customer_id?: number | null
          customer_self_identified?: string | null
          ended_at?: string | null
          id?: string
          last_active_at?: string
          opted_out_at?: string | null
          outcome?: string | null
          phone_e164?: string | null
          sentiment?: string | null
          shop_id: number
          started_at?: string
          status?: string
          vehicle_id?: number | null
        }
        Update: {
          appointment_id?: number | null
          channel?: string
          cookie_session?: string | null
          customer_id?: number | null
          customer_self_identified?: string | null
          ended_at?: string | null
          id?: string
          last_active_at?: string
          opted_out_at?: string | null
          outcome?: string | null
          phone_e164?: string | null
          sentiment?: string | null
          shop_id?: number
          started_at?: string
          status?: string
          vehicle_id?: number | null
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
      keytag_webhook_events: {
        Row: {
          error_message: string | null
          event_kind: string
          event_text: string | null
          id: string
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
          event_kind: string
          event_text?: string | null
          id?: string
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
          event_kind?: string
          event_text?: string | null
          id?: string
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
          customer_id: number | null
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
          customer_id?: number | null
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
          customer_id?: number | null
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
          created_at: string
          display_name: string
          display_order: number
          id: string
          service_key: string
          shop_id: number
          updated_at: string
          updated_by_name: string | null
          updated_by_oauth_client_id: string | null
        }
        Insert: {
          abbreviation: string
          active?: boolean
          created_at?: string
          display_name: string
          display_order: number
          id?: string
          service_key: string
          shop_id: number
          updated_at?: string
          updated_by_name?: string | null
          updated_by_oauth_client_id?: string | null
        }
        Update: {
          abbreviation?: string
          active?: boolean
          created_at?: string
          display_name?: string
          display_order?: number
          id?: string
          service_key?: string
          shop_id?: number
          updated_at?: string
          updated_by_name?: string | null
          updated_by_oauth_client_id?: string | null
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
          event_kind_inferred: string | null
          event_text: string | null
          event_type: string | null
          id: string
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
          event_kind_inferred?: string | null
          event_text?: string | null
          event_type?: string | null
          id?: string
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
          event_kind_inferred?: string | null
          event_text?: string | null
          event_type?: string | null
          id?: string
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
          display_name: string
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
          display_name: string
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
          display_name?: string
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
      assign_next_keytag: {
        Args: {
          p_advisor_id?: number
          p_customer_id?: number
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
      hold_waiter_slot: {
        Args: {
          p_active_tekmetric_appts: number
          p_customer_id: number
          p_scheduled_date: string
          p_scheduled_time: string
          p_service_summary: string
          p_session_id: string
          p_shop_id: number
          p_vehicle_id: number
        }
        Returns: string
      }
      mark_keytag_posted: {
        Args: { p_ro_id: number }
        Returns: {
          tag_color: string
          tag_number: number
        }[]
      }
      oauth_validate_access_token: {
        Args: { p_token_hash: string }
        Returns: {
          client_id: string
          scope: string
          user_label: string
        }[]
      }
      record_keytag_patched: {
        Args: { p_error?: string; p_ro_id: number; p_success: boolean }
        Returns: undefined
      }
      release_keytag_for_ro: {
        Args: { p_reason?: string; p_ro_id: number }
        Returns: {
          tag_color: string
          tag_number: number
        }[]
      }
      tekmetric_get_secret: { Args: { p_name: string }; Returns: string }
      tekmetric_set_secret: {
        Args: { p_description?: string; p_name: string; p_value: string }
        Returns: undefined
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
