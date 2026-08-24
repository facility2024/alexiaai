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
      agent_handoffs: {
        Row: {
          case_id: string
          created_at: string
          from_agent: Database["public"]["Enums"]["agent_type"]
          id: string
          notes: string | null
          payload: Json
          to_agent: Database["public"]["Enums"]["agent_type"]
        }
        Insert: {
          case_id: string
          created_at?: string
          from_agent: Database["public"]["Enums"]["agent_type"]
          id?: string
          notes?: string | null
          payload?: Json
          to_agent: Database["public"]["Enums"]["agent_type"]
        }
        Update: {
          case_id?: string
          created_at?: string
          from_agent?: Database["public"]["Enums"]["agent_type"]
          id?: string
          notes?: string | null
          payload?: Json
          to_agent?: Database["public"]["Enums"]["agent_type"]
        }
        Relationships: [
          {
            foreignKeyName: "agent_handoffs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_global_state: {
        Row: {
          active: boolean
          owner_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          owner_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          owner_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      ai_personality: {
        Row: {
          agent_key: string
          created_at: string
          id: string
          max_chars_per_chunk: number
          persona: string | null
          rules: string | null
          tone: string | null
          typing_delay_ms: number
          updated_at: string
          use_knowledge_base: boolean
          user_id: string
        }
        Insert: {
          agent_key?: string
          created_at?: string
          id?: string
          max_chars_per_chunk?: number
          persona?: string | null
          rules?: string | null
          tone?: string | null
          typing_delay_ms?: number
          updated_at?: string
          use_knowledge_base?: boolean
          user_id: string
        }
        Update: {
          agent_key?: string
          created_at?: string
          id?: string
          max_chars_per_chunk?: number
          persona?: string | null
          rules?: string | null
          tone?: string | null
          typing_delay_ms?: number
          updated_at?: string
          use_knowledge_base?: boolean
          user_id?: string
        }
        Relationships: []
      }
      ai_settings: {
        Row: {
          agent_key: string
          api_key: string | null
          base_url: string | null
          created_at: string
          gemini_key: string | null
          id: string
          inworld_key: string | null
          model: string
          openai_key: string | null
          provider: string
          system_prompt: string | null
          temperature: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_key: string
          api_key?: string | null
          base_url?: string | null
          created_at?: string
          gemini_key?: string | null
          id?: string
          inworld_key?: string | null
          model: string
          openai_key?: string | null
          provider: string
          system_prompt?: string | null
          temperature?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_key?: string
          api_key?: string | null
          base_url?: string | null
          created_at?: string
          gemini_key?: string | null
          id?: string
          inworld_key?: string | null
          model?: string
          openai_key?: string | null
          provider?: string
          system_prompt?: string | null
          temperature?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      appointments: {
        Row: {
          calendar_event_id: string | null
          case_id: string
          created_at: string
          duration_minutes: number
          google_event_id: string | null
          google_event_link: string | null
          id: string
          meeting_link: string | null
          notes: string | null
          scheduled_at: string
          specialist_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          calendar_event_id?: string | null
          case_id: string
          created_at?: string
          duration_minutes?: number
          google_event_id?: string | null
          google_event_link?: string | null
          id?: string
          meeting_link?: string | null
          notes?: string | null
          scheduled_at: string
          specialist_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          calendar_event_id?: string | null
          case_id?: string
          created_at?: string
          duration_minutes?: number
          google_event_id?: string | null
          google_event_link?: string | null
          id?: string
          meeting_link?: string | null
          notes?: string | null
          scheduled_at?: string
          specialist_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      billings: {
        Row: {
          amount: number
          bank_slip_url: string | null
          billing_type: string | null
          card_id: string | null
          client_id: string | null
          created_at: string
          currency: string
          description: string | null
          due_date: string | null
          external_id: string | null
          gateway: string
          id: string
          invoice_url: string | null
          paid_at: string | null
          pix_code: string | null
          raw: Json | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          bank_slip_url?: string | null
          billing_type?: string | null
          card_id?: string | null
          client_id?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          due_date?: string | null
          external_id?: string | null
          gateway: string
          id?: string
          invoice_url?: string | null
          paid_at?: string | null
          pix_code?: string | null
          raw?: Json | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          bank_slip_url?: string | null
          billing_type?: string | null
          card_id?: string | null
          client_id?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          due_date?: string | null
          external_id?: string | null
          gateway?: string
          id?: string
          invoice_url?: string | null
          paid_at?: string | null
          pix_code?: string | null
          raw?: Json | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billings_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "kanban_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      case_analysis: {
        Row: {
          case_id: string
          generated_at: string
          id: string
          knowledge_refs: Json | null
          legal_summary: string | null
          opportunities: string | null
          pending_items: string | null
          risks: string | null
          suggested_strategy: string | null
          updated_at: string
          viability_score: number | null
        }
        Insert: {
          case_id: string
          generated_at?: string
          id?: string
          knowledge_refs?: Json | null
          legal_summary?: string | null
          opportunities?: string | null
          pending_items?: string | null
          risks?: string | null
          suggested_strategy?: string | null
          updated_at?: string
          viability_score?: number | null
        }
        Update: {
          case_id?: string
          generated_at?: string
          id?: string
          knowledge_refs?: Json | null
          legal_summary?: string | null
          opportunities?: string | null
          pending_items?: string | null
          risks?: string | null
          suggested_strategy?: string | null
          updated_at?: string
          viability_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "case_analysis_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          assigned_specialist_id: string | null
          case_type: string | null
          classification: string | null
          client_id: string
          created_at: string
          current_agent: Database["public"]["Enums"]["agent_type"]
          id: string
          status: Database["public"]["Enums"]["case_status"]
          summary: string | null
          updated_at: string
        }
        Insert: {
          assigned_specialist_id?: string | null
          case_type?: string | null
          classification?: string | null
          client_id: string
          created_at?: string
          current_agent?: Database["public"]["Enums"]["agent_type"]
          id?: string
          status?: Database["public"]["Enums"]["case_status"]
          summary?: string | null
          updated_at?: string
        }
        Update: {
          assigned_specialist_id?: string | null
          case_type?: string | null
          classification?: string | null
          client_id?: string
          created_at?: string
          current_agent?: Database["public"]["Enums"]["agent_type"]
          id?: string
          status?: Database["public"]["Enums"]["case_status"]
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string
          assigned_to: string | null
          chat_id: string
          id: string
          owner_id: string
          sector_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string
          assigned_to?: string | null
          chat_id: string
          id?: string
          owner_id: string
          sector_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          assigned_to?: string | null
          chat_id?: string
          id?: string
          owner_id?: string
          sector_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_assignments_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_label_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string
          chat_id: string
          label_id: string
          owner_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          chat_id: string
          label_id: string
          owner_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          chat_id?: string
          label_id?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_label_assignments_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "chat_labels"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_labels: {
        Row: {
          color: string
          created_at: string
          created_by: string
          id: string
          name: string
          owner_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by: string
          id?: string
          name: string
          owner_id: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
      chat_transfer_log: {
        Row: {
          actor: string
          chat_id: string
          created_at: string
          from_user: string | null
          id: string
          owner_id: string
          reason: string | null
          sector_id: string | null
          to_user: string | null
        }
        Insert: {
          actor: string
          chat_id: string
          created_at?: string
          from_user?: string | null
          id?: string
          owner_id: string
          reason?: string | null
          sector_id?: string | null
          to_user?: string | null
        }
        Update: {
          actor?: string
          chat_id?: string
          created_at?: string
          from_user?: string | null
          id?: string
          owner_id?: string
          reason?: string | null
          sector_id?: string | null
          to_user?: string | null
        }
        Relationships: []
      }
      client_sms_followups: {
        Row: {
          client_id: string
          created_at: string
          error: string | null
          id: string
          message: string
          phone: string
          provider: string | null
          scheduled_at: string
          sent_at: string | null
          status: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          error?: string | null
          id?: string
          message: string
          phone: string
          provider?: string | null
          scheduled_at: string
          sent_at?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          error?: string | null
          id?: string
          message?: string
          phone?: string
          provider?: string | null
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_sms_followups_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          access_token: string
          address: string | null
          address_complement: string | null
          address_number: string | null
          address_street: string | null
          birth_date: string | null
          city: string | null
          cpf: string | null
          created_at: string
          email: string | null
          followup_queued_at: string | null
          followup_status: string
          full_name: string | null
          id: string
          interest_level: string | null
          is_complete: boolean
          neighborhood: string | null
          notes: string | null
          phone: string | null
          state: string | null
          updated_at: string
          zip: string | null
        }
        Insert: {
          access_token?: string
          address?: string | null
          address_complement?: string | null
          address_number?: string | null
          address_street?: string | null
          birth_date?: string | null
          city?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          followup_queued_at?: string | null
          followup_status?: string
          full_name?: string | null
          id?: string
          interest_level?: string | null
          is_complete?: boolean
          neighborhood?: string | null
          notes?: string | null
          phone?: string | null
          state?: string | null
          updated_at?: string
          zip?: string | null
        }
        Update: {
          access_token?: string
          address?: string | null
          address_complement?: string | null
          address_number?: string | null
          address_street?: string | null
          birth_date?: string | null
          city?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          followup_queued_at?: string | null
          followup_status?: string
          full_name?: string | null
          id?: string
          interest_level?: string | null
          is_complete?: boolean
          neighborhood?: string | null
          notes?: string | null
          phone?: string | null
          state?: string | null
          updated_at?: string
          zip?: string | null
        }
        Relationships: []
      }
      contract_events: {
        Row: {
          autentique_document_id: string | null
          contract_id: string | null
          created_at: string
          dedupe_key: string | null
          event_type: string
          id: string
          payload: Json
          signer_email: string | null
        }
        Insert: {
          autentique_document_id?: string | null
          contract_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          event_type: string
          id?: string
          payload?: Json
          signer_email?: string | null
        }
        Update: {
          autentique_document_id?: string | null
          contract_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          event_type?: string
          id?: string
          payload?: Json
          signer_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_events_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_reminders: {
        Row: {
          channel: string
          contract_id: string
          id: string
          level: number
          sent_at: string
        }
        Insert: {
          channel?: string
          contract_id: string
          id?: string
          level: number
          sent_at?: string
        }
        Update: {
          channel?: string
          contract_id?: string
          id?: string
          level?: number
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_reminders_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_signers: {
        Row: {
          action: string
          autentique_signer_id: string | null
          contract_id: string
          created_at: string
          email: string
          id: string
          name: string
          owner_id: string
          phone: string | null
          position: number
          signed_at: string | null
          signing_url: string | null
          status: string
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          action?: string
          autentique_signer_id?: string | null
          contract_id: string
          created_at?: string
          email: string
          id?: string
          name: string
          owner_id: string
          phone?: string | null
          position?: number
          signed_at?: string | null
          signing_url?: string | null
          status?: string
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          action?: string
          autentique_signer_id?: string | null
          contract_id?: string
          created_at?: string
          email?: string
          id?: string
          name?: string
          owner_id?: string
          phone?: string | null
          position?: number
          signed_at?: string | null
          signing_url?: string | null
          status?: string
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_signers_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_templates: {
        Row: {
          active: boolean
          body_html: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          owner_id: string
          source_pdf_path: string | null
          updated_at: string
          variables: Json
        }
        Insert: {
          active?: boolean
          body_html?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          owner_id: string
          source_pdf_path?: string | null
          updated_at?: string
          variables?: Json
        }
        Update: {
          active?: boolean
          body_html?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          owner_id?: string
          source_pdf_path?: string | null
          updated_at?: string
          variables?: Json
        }
        Relationships: []
      }
      contracts: {
        Row: {
          autentique_document_id: string | null
          autentique_public_id: string | null
          card_id: string | null
          client_id: string | null
          contract_code: string | null
          created_at: string
          created_by: string
          expires_at: string | null
          file_url: string | null
          id: string
          integrity_report: Json | null
          integrity_score: number | null
          message: string | null
          metadata: Json
          owner_id: string
          payment_method: string | null
          responsible_agent_id: string | null
          sent_at: string | null
          signed_at: string | null
          signed_file_url: string | null
          status: string
          template_id: string | null
          title: string
          updated_at: string
          values: Json
        }
        Insert: {
          autentique_document_id?: string | null
          autentique_public_id?: string | null
          card_id?: string | null
          client_id?: string | null
          contract_code?: string | null
          created_at?: string
          created_by: string
          expires_at?: string | null
          file_url?: string | null
          id?: string
          integrity_report?: Json | null
          integrity_score?: number | null
          message?: string | null
          metadata?: Json
          owner_id: string
          payment_method?: string | null
          responsible_agent_id?: string | null
          sent_at?: string | null
          signed_at?: string | null
          signed_file_url?: string | null
          status?: string
          template_id?: string | null
          title: string
          updated_at?: string
          values?: Json
        }
        Update: {
          autentique_document_id?: string | null
          autentique_public_id?: string | null
          card_id?: string | null
          client_id?: string | null
          contract_code?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string | null
          file_url?: string | null
          id?: string
          integrity_report?: Json | null
          integrity_score?: number | null
          message?: string | null
          metadata?: Json
          owner_id?: string
          payment_method?: string | null
          responsible_agent_id?: string | null
          sent_at?: string | null
          signed_at?: string | null
          signed_file_url?: string | null
          status?: string
          template_id?: string | null
          title?: string
          updated_at?: string
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "contracts_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "kanban_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "contract_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_agent_ratings: {
        Row: {
          agent_key: string
          chat_id: string
          created_at: string
          id: string
          owner_id: string
          rating: number
          raw_message: string | null
        }
        Insert: {
          agent_key: string
          chat_id: string
          created_at?: string
          id?: string
          owner_id: string
          rating: number
          raw_message?: string | null
        }
        Update: {
          agent_key?: string
          chat_id?: string
          created_at?: string
          id?: string
          owner_id?: string
          rating?: number
          raw_message?: string | null
        }
        Relationships: []
      }
      crm_chat_reads: {
        Row: {
          chat_id: string
          last_read_at: string
          owner_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          chat_id: string
          last_read_at?: string
          owner_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          chat_id?: string
          last_read_at?: string
          owner_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      crm_chat_surveys: {
        Row: {
          answered_at: string | null
          chat_id: string
          owner_id: string
          sent_at: string | null
          updated_at: string
        }
        Insert: {
          answered_at?: string | null
          chat_id: string
          owner_id: string
          sent_at?: string | null
          updated_at?: string
        }
        Update: {
          answered_at?: string | null
          chat_id?: string
          owner_id?: string
          sent_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      crm_messages: {
        Row: {
          chat_id: string
          content: string | null
          created_at: string
          direction: string
          duration_ms: number | null
          filename: string | null
          height: number | null
          id: string
          media_attempts: number
          media_id: string | null
          media_last_error: string | null
          media_next_retry_at: string | null
          media_status: string | null
          media_url: string | null
          message_type: string
          mime: string | null
          raw: Json | null
          sender: string
          sha256: string | null
          size: number | null
          status: string
          storage_path: string | null
          transcription: string | null
          user_id: string
          wapi_message_id: string | null
          width: number | null
        }
        Insert: {
          chat_id: string
          content?: string | null
          created_at?: string
          direction: string
          duration_ms?: number | null
          filename?: string | null
          height?: number | null
          id?: string
          media_attempts?: number
          media_id?: string | null
          media_last_error?: string | null
          media_next_retry_at?: string | null
          media_status?: string | null
          media_url?: string | null
          message_type?: string
          mime?: string | null
          raw?: Json | null
          sender: string
          sha256?: string | null
          size?: number | null
          status?: string
          storage_path?: string | null
          transcription?: string | null
          user_id: string
          wapi_message_id?: string | null
          width?: number | null
        }
        Update: {
          chat_id?: string
          content?: string | null
          created_at?: string
          direction?: string
          duration_ms?: number | null
          filename?: string | null
          height?: number | null
          id?: string
          media_attempts?: number
          media_id?: string | null
          media_last_error?: string | null
          media_next_retry_at?: string | null
          media_status?: string | null
          media_url?: string | null
          message_type?: string
          mime?: string | null
          raw?: Json | null
          sender?: string
          sha256?: string | null
          size?: number | null
          status?: string
          storage_path?: string | null
          transcription?: string | null
          user_id?: string
          wapi_message_id?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_messages_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_paused_chats: {
        Row: {
          chat_id: string
          created_at: string
          id: string
          paused_by: string
          user_id: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          id?: string
          paused_by: string
          user_id: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          id?: string
          paused_by?: string
          user_id?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          case_id: string
          created_at: string
          document_type: string | null
          extracted_text: string | null
          file_name: string
          file_path: string
          id: string
          metadata: Json | null
          mime_type: string | null
          size_bytes: number | null
          status: Database["public"]["Enums"]["document_status"]
          updated_at: string
        }
        Insert: {
          case_id: string
          created_at?: string
          document_type?: string | null
          extracted_text?: string | null
          file_name: string
          file_path: string
          id?: string
          metadata?: Json | null
          mime_type?: string | null
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["document_status"]
          updated_at?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          document_type?: string | null
          extracted_text?: string | null
          file_name?: string
          file_path?: string
          id?: string
          metadata?: Json | null
          mime_type?: string | null
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["document_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      eduardo_contract_reviews: {
        Row: {
          approved_at: string | null
          card_id: string | null
          contract_id: string
          created_at: string
          created_by: string
          draft_message: string | null
          draft_sent_at: string | null
          handed_off_at: string | null
          handoff_note: string | null
          id: string
          owner_id: string
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          card_id?: string | null
          contract_id: string
          created_at?: string
          created_by: string
          draft_message?: string | null
          draft_sent_at?: string | null
          handed_off_at?: string | null
          handoff_note?: string | null
          id?: string
          owner_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          card_id?: string | null
          contract_id?: string
          created_at?: string
          created_by?: string
          draft_message?: string | null
          draft_sent_at?: string | null
          handed_off_at?: string | null
          handoff_note?: string | null
          id?: string
          owner_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eduardo_contract_reviews_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "kanban_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eduardo_contract_reviews_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      flow_conversations: {
        Row: {
          chat_id: string
          created_at: string
          current_node_id: string | null
          flow_id: string | null
          id: string
          last_activity_at: string
          session_variables: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          current_node_id?: string | null
          flow_id?: string | null
          id?: string
          last_activity_at?: string
          session_variables?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          current_node_id?: string | null
          flow_id?: string | null
          id?: string
          last_activity_at?: string
          session_variables?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_conversations_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
        ]
      }
      flows: {
        Row: {
          created_at: string
          definition: Json
          id: string
          is_active: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          definition?: Json
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          definition?: Json
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      import_events: {
        Row: {
          created_at: string
          error: string | null
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          result: Json | null
          source: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          event_type: string
          id?: string
          payload: Json
          processed_at?: string | null
          result?: Json | null
          source: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          result?: Json | null
          source?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      invite_access_requests: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          invite_id: string
          notes: string | null
          owner_id: string
          status: string
          token_used: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          invite_id: string
          notes?: string | null
          owner_id: string
          status?: string
          token_used: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          invite_id?: string
          notes?: string | null
          owner_id?: string
          status?: string
          token_used?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_access_requests_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: false
            referencedRelation: "invites"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          created_at: string
          email: string | null
          expires_at: string
          id: string
          note: string | null
          owner_id: string
          permissions: Json
          revoked_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          sector_ids: string[]
          slug: string | null
          token: string
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          note?: string | null
          owner_id: string
          permissions?: Json
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          sector_ids?: string[]
          slug?: string | null
          token?: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          note?: string | null
          owner_id?: string
          permissions?: Json
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          sector_ids?: string[]
          slug?: string | null
          token?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: []
      }
      kanban_card_documents: {
        Row: {
          card_id: string
          created_at: string
          document_name: string
          id: string
          notes: string | null
          position: number
          received: boolean
          received_at: string | null
          required: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          card_id: string
          created_at?: string
          document_name: string
          id?: string
          notes?: string | null
          position?: number
          received?: boolean
          received_at?: string | null
          required?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          card_id?: string
          created_at?: string
          document_name?: string
          id?: string
          notes?: string | null
          position?: number
          received?: boolean
          received_at?: string | null
          required?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kanban_card_documents_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "kanban_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      kanban_card_events: {
        Row: {
          actor: string
          card_id: string
          created_at: string
          event_type: string
          from_column_id: string | null
          id: string
          payload: Json | null
          to_column_id: string | null
          user_id: string
        }
        Insert: {
          actor?: string
          card_id: string
          created_at?: string
          event_type: string
          from_column_id?: string | null
          id?: string
          payload?: Json | null
          to_column_id?: string | null
          user_id: string
        }
        Update: {
          actor?: string
          card_id?: string
          created_at?: string
          event_type?: string
          from_column_id?: string | null
          id?: string
          payload?: Json | null
          to_column_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kanban_card_events_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "kanban_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      kanban_cards: {
        Row: {
          ai_enabled: boolean
          assignee: string | null
          case_facts: Json
          case_timeline: Json
          chat_id: string
          column_id: string
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          estimated_ticket: number | null
          estimated_value: number | null
          id: string
          last_ai_analysis_at: string | null
          last_client_message_at: string | null
          last_message_at: string | null
          legal_area: string | null
          position: number
          qualified_at: string | null
          sla_hours: number
          summary: string | null
          tag_ids: string[]
          updated_at: string
          urgency: string | null
          user_id: string
          viability_score: number | null
        }
        Insert: {
          ai_enabled?: boolean
          assignee?: string | null
          case_facts?: Json
          case_timeline?: Json
          chat_id: string
          column_id: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          estimated_ticket?: number | null
          estimated_value?: number | null
          id?: string
          last_ai_analysis_at?: string | null
          last_client_message_at?: string | null
          last_message_at?: string | null
          legal_area?: string | null
          position?: number
          qualified_at?: string | null
          sla_hours?: number
          summary?: string | null
          tag_ids?: string[]
          updated_at?: string
          urgency?: string | null
          user_id: string
          viability_score?: number | null
        }
        Update: {
          ai_enabled?: boolean
          assignee?: string | null
          case_facts?: Json
          case_timeline?: Json
          chat_id?: string
          column_id?: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          estimated_ticket?: number | null
          estimated_value?: number | null
          id?: string
          last_ai_analysis_at?: string | null
          last_client_message_at?: string | null
          last_message_at?: string | null
          legal_area?: string | null
          position?: number
          qualified_at?: string | null
          sla_hours?: number
          summary?: string | null
          tag_ids?: string[]
          updated_at?: string
          urgency?: string | null
          user_id?: string
          viability_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "kanban_cards_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "kanban_columns"
            referencedColumns: ["id"]
          },
        ]
      }
      kanban_columns: {
        Row: {
          auto_action: string | null
          color: string
          created_at: string
          icon: string
          id: string
          is_default: boolean
          name: string
          position: number
          rule_prompt: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_action?: string | null
          color?: string
          created_at?: string
          icon?: string
          id?: string
          is_default?: boolean
          name: string
          position?: number
          rule_prompt?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_action?: string | null
          color?: string
          created_at?: string
          icon?: string
          id?: string
          is_default?: boolean
          name?: string
          position?: number
          rule_prompt?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      kanban_doc_checklist: {
        Row: {
          case_type: string
          created_at: string
          document_name: string
          id: string
          position: number
          required: boolean
          user_id: string
        }
        Insert: {
          case_type?: string
          created_at?: string
          document_name: string
          id?: string
          position?: number
          required?: boolean
          user_id: string
        }
        Update: {
          case_type?: string
          created_at?: string
          document_name?: string
          id?: string
          position?: number
          required?: boolean
          user_id?: string
        }
        Relationships: []
      }
      kanban_tags: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      knowledge_base: {
        Row: {
          active: boolean
          agent_keys: string[]
          category: string | null
          content: string
          created_at: string
          created_by: string | null
          id: string
          tags: string[] | null
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          agent_keys?: string[]
          category?: string | null
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          tags?: string[] | null
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          agent_keys?: string[]
          category?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          tags?: string[] | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      knowledge_base_documents: {
        Row: {
          created_at: string
          id: string
          source_type: string
          source_url: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          source_type?: string
          source_url?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          source_type?: string
          source_url?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      knowledge_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          user_id: string
        }
        Insert: {
          chunk_index?: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          user_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_base_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_area_templates: {
        Row: {
          area: string
          created_at: string
          document_name: string
          id: string
          position: number
          required: boolean
          user_id: string
        }
        Insert: {
          area: string
          created_at?: string
          document_name: string
          id?: string
          position?: number
          required?: boolean
          user_id: string
        }
        Update: {
          area?: string
          created_at?: string
          document_name?: string
          id?: string
          position?: number
          required?: boolean
          user_id?: string
        }
        Relationships: []
      }
      media_assets: {
        Row: {
          created_at: string
          duration_ms: number | null
          filename: string | null
          height: number | null
          id: string
          kind: string
          last_error: string | null
          mime: string | null
          origin: string | null
          sha256: string | null
          size: number | null
          status: string
          storage_path: string | null
          storage_provider: string
          thumbnail_path: string | null
          updated_at: string
          user_id: string
          width: number | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          filename?: string | null
          height?: number | null
          id: string
          kind: string
          last_error?: string | null
          mime?: string | null
          origin?: string | null
          sha256?: string | null
          size?: number | null
          status?: string
          storage_path?: string | null
          storage_provider?: string
          thumbnail_path?: string | null
          updated_at?: string
          user_id: string
          width?: number | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          filename?: string | null
          height?: number | null
          id?: string
          kind?: string
          last_error?: string | null
          mime?: string | null
          origin?: string | null
          sha256?: string | null
          size?: number | null
          status?: string
          storage_path?: string | null
          storage_provider?: string
          thumbnail_path?: string | null
          updated_at?: string
          user_id?: string
          width?: number | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          agent: Database["public"]["Enums"]["agent_type"]
          attachments: Json | null
          case_id: string
          content: string
          created_at: string
          id: string
          metadata: Json | null
          role: Database["public"]["Enums"]["message_role"]
        }
        Insert: {
          agent: Database["public"]["Enums"]["agent_type"]
          attachments?: Json | null
          case_id: string
          content: string
          created_at?: string
          id?: string
          metadata?: Json | null
          role: Database["public"]["Enums"]["message_role"]
        }
        Update: {
          agent?: Database["public"]["Enums"]["agent_type"]
          attachments?: Json | null
          case_id?: string
          content?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          role?: Database["public"]["Enums"]["message_role"]
        }
        Relationships: [
          {
            foreignKeyName: "messages_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          active: boolean
          created_at: string
          id: string
          member_id: string
          owner_id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          member_id: string
          owner_id: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          member_id?: string
          owner_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      payment_credentials: {
        Row: {
          api_key: string | null
          created_at: string
          display_name: string | null
          environment: string
          extra: Json
          gateway: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key?: string | null
          created_at?: string
          display_name?: string | null
          environment?: string
          extra?: Json
          gateway: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key?: string | null
          created_at?: string
          display_name?: string | null
          environment?: string
          extra?: Json
          gateway?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      payment_webhook_events: {
        Row: {
          error: string | null
          event_type: string | null
          external_id: string | null
          gateway: string
          id: string
          payload: Json
          processed: boolean
          received_at: string
        }
        Insert: {
          error?: string | null
          event_type?: string | null
          external_id?: string | null
          gateway: string
          id?: string
          payload: Json
          processed?: boolean
          received_at?: string
        }
        Update: {
          error?: string | null
          event_type?: string | null
          external_id?: string | null
          gateway?: string
          id?: string
          payload?: Json
          processed?: boolean
          received_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          max_members: number
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          max_members?: number
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          max_members?: number
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      required_documents: {
        Row: {
          case_id: string
          created_at: string
          document_id: string | null
          document_name: string
          id: string
          is_mandatory: boolean
          received: boolean
        }
        Insert: {
          case_id: string
          created_at?: string
          document_id?: string | null
          document_name: string
          id?: string
          is_mandatory?: boolean
          received?: boolean
        }
        Update: {
          case_id?: string
          created_at?: string
          document_id?: string | null
          document_name?: string
          id?: string
          is_mandatory?: boolean
          received?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "required_documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "required_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      sector_members: {
        Row: {
          created_at: string
          id: string
          is_lead: boolean
          sector_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_lead?: boolean
          sector_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_lead?: boolean
          sector_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sector_members_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
        ]
      }
      sectors: {
        Row: {
          active: boolean
          color: string | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          keywords: string[]
          name: string
          owner_id: string
          position: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          keywords?: string[]
          name: string
          owner_id: string
          position?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          keywords?: string[]
          name?: string
          owner_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: []
      }
      sms_credentials: {
        Row: {
          api_key: string
          api_secret: string | null
          base_url: string | null
          created_at: string
          display_name: string | null
          environment: string
          extra: Json
          id: string
          provider: string
          sender_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key: string
          api_secret?: string | null
          base_url?: string | null
          created_at?: string
          display_name?: string | null
          environment?: string
          extra?: Json
          id?: string
          provider: string
          sender_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key?: string
          api_secret?: string | null
          base_url?: string | null
          created_at?: string
          display_name?: string | null
          environment?: string
          extra?: Json
          id?: string
          provider?: string
          sender_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sms_followup_templates: {
        Row: {
          active: boolean
          created_at: string
          days_after_inactivity: number
          id: string
          message: string
          name: string
          send_hour: number
          send_minute: number
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          days_after_inactivity?: number
          id?: string
          message: string
          name: string
          send_hour?: number
          send_minute?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          days_after_inactivity?: number
          id?: string
          message?: string
          name?: string
          send_hour?: number
          send_minute?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      user_permissions: {
        Row: {
          can_access_knowledge: boolean
          can_configure_ai: boolean
          can_edit_kanban: boolean
          can_export: boolean
          can_manage_cases: boolean
          can_manage_clients: boolean
          can_manage_contracts: boolean
          can_manage_sectors: boolean
          can_send_billing: boolean
          can_view_all_chats: boolean
          created_at: string
          extra: Json
          id: string
          owner_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          can_access_knowledge?: boolean
          can_configure_ai?: boolean
          can_edit_kanban?: boolean
          can_export?: boolean
          can_manage_cases?: boolean
          can_manage_clients?: boolean
          can_manage_contracts?: boolean
          can_manage_sectors?: boolean
          can_send_billing?: boolean
          can_view_all_chats?: boolean
          created_at?: string
          extra?: Json
          id?: string
          owner_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          can_access_knowledge?: boolean
          can_configure_ai?: boolean
          can_edit_kanban?: boolean
          can_export?: boolean
          can_manage_cases?: boolean
          can_manage_clients?: boolean
          can_manage_contracts?: boolean
          can_manage_sectors?: boolean
          can_send_billing?: boolean
          can_view_all_chats?: boolean
          created_at?: string
          extra?: Json
          id?: string
          owner_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wapi_config: {
        Row: {
          api_token: string
          created_at: string
          id: string
          instance_id: string
          is_connected: boolean
          last_checked_at: string | null
          phone_number: string | null
          reply_in_groups: boolean
          status: string
          updated_at: string
          user_id: string
          webhook_url: string | null
        }
        Insert: {
          api_token: string
          created_at?: string
          id?: string
          instance_id: string
          is_connected?: boolean
          last_checked_at?: string | null
          phone_number?: string | null
          reply_in_groups?: boolean
          status?: string
          updated_at?: string
          user_id: string
          webhook_url?: string | null
        }
        Update: {
          api_token?: string
          created_at?: string
          id?: string
          instance_id?: string
          is_connected?: boolean
          last_checked_at?: string | null
          phone_number?: string | null
          reply_in_groups?: boolean
          status?: string
          updated_at?: string
          user_id?: string
          webhook_url?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_invite_membership: {
        Args: {
          _active?: boolean
          _member_id: string
          _owner_id: string
          _permissions?: Json
          _role?: Database["public"]["Enums"]["app_role"]
          _sector_ids?: string[]
        }
        Returns: undefined
      }
      approve_invite_access_request: {
        Args: { _email?: string; _request_id: string }
        Returns: Json
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      find_access_request_by_token_public: {
        Args: { _email?: string; _token: string }
        Returns: {
          created_at: string
          email: string
          full_name: string
          id: string
          status: string
        }[]
      }
      get_access_request_status_public: {
        Args: { _id: string }
        Returns: {
          created_at: string
          email: string
          full_name: string
          id: string
          notes: string
          status: string
        }[]
      }
      get_invite_public: {
        Args: { _token: string }
        Returns: {
          email: string
          inviter_name: string
          reason: string
          role: string
          valid: boolean
        }[]
      }
      get_master_owner: { Args: never; Returns: string }
      get_org_owner: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_org_member: {
        Args: { _owner: string; _user: string }
        Returns: boolean
      }
      match_knowledge_chunks: {
        Args: {
          _user_id: string
          match_count?: number
          query_embedding: string
        }
        Returns: {
          content: string
          document_id: string
          id: string
          similarity: number
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      request_invite_access: {
        Args: { _email?: string; _full_name: string; _token: string }
        Returns: string
      }
      seed_kanban_defaults: { Args: { _user_id: string }; Returns: undefined }
      seed_legal_area_templates: {
        Args: { _user_id: string }
        Returns: undefined
      }
      sync_approved_invite_for_current_user: { Args: never; Returns: Json }
    }
    Enums: {
      agent_type: "agent_1" | "agent_2" | "agent_3"
      app_role: "admin" | "specialist" | "manager" | "agent"
      case_status:
        | "triage"
        | "analysis"
        | "scheduling"
        | "scheduled"
        | "closed"
        | "cancelled"
      document_status: "pending" | "processing" | "processed" | "failed"
      message_role: "user" | "assistant" | "system"
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
    Enums: {
      agent_type: ["agent_1", "agent_2", "agent_3"],
      app_role: ["admin", "specialist", "manager", "agent"],
      case_status: [
        "triage",
        "analysis",
        "scheduling",
        "scheduled",
        "closed",
        "cancelled",
      ],
      document_status: ["pending", "processing", "processed", "failed"],
      message_role: ["user", "assistant", "system"],
    },
  },
} as const
