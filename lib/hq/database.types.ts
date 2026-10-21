export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  hq: {
    Tables: {
      ai_requests: {
        Row: {
          asked_at: string
          finished_at: string | null
          id: string
          input_tokens: number | null
          output_tokens: number | null
          question: string
          staff_id: string
          status: string
          tools_used: string[]
        }
        Insert: {
          asked_at?: string
          finished_at?: string | null
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          question: string
          staff_id: string
          status?: string
          tools_used?: string[]
        }
        Update: {
          asked_at?: string
          finished_at?: string | null
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          question?: string
          staff_id?: string
          status?: string
          tools_used?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "ai_requests_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          at: string
          changes: Json
          entity_id: string | null
          entity_type: string
          id: number
          summary: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          at?: string
          changes?: Json
          entity_id?: string | null
          entity_type: string
          id?: never
          summary?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          at?: string
          changes?: Json
          entity_id?: string | null
          entity_type?: string
          id?: never
          summary?: string | null
        }
        Relationships: []
      }
      brand_resource_versions: {
        Row: {
          change_note: string | null
          content_sha256: string
          created_at: string
          created_by: string | null
          created_by_name: string | null
          file_name: string
          id: string
          label: string
          mime_type: string
          resource_id: string
          size_bytes: number
          storage_path: string
          version_number: number
        }
        Insert: {
          change_note?: string | null
          content_sha256: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          file_name: string
          id?: string
          label: string
          mime_type: string
          resource_id: string
          size_bytes: number
          storage_path: string
          version_number: number
        }
        Update: {
          change_note?: string | null
          content_sha256?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          file_name?: string
          id?: string
          label?: string
          mime_type?: string
          resource_id?: string
          size_bytes?: number
          storage_path?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "brand_resource_versions_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "brand_resource_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_resource_versions_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "brand_resources"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_resources: {
        Row: {
          category: Database["hq"]["Enums"]["brand_resource_category"]
          content_sha256: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          file_name: string
          id: string
          mime_type: string
          note: string | null
          ref_number: number
          size_bytes: number
          sort_order: number
          storage_path: string
          tags: string[]
          title: string
          updated_at: string
          updated_by: string | null
          version: string
        }
        Insert: {
          category: Database["hq"]["Enums"]["brand_resource_category"]
          content_sha256: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          file_name: string
          id?: string
          mime_type: string
          note?: string | null
          ref_number?: never
          size_bytes: number
          sort_order?: number
          storage_path: string
          tags?: string[]
          title: string
          updated_at?: string
          updated_by?: string | null
          version?: string
        }
        Update: {
          category?: Database["hq"]["Enums"]["brand_resource_category"]
          content_sha256?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          file_name?: string
          id?: string
          mime_type?: string
          note?: string | null
          ref_number?: never
          size_bytes?: number
          sort_order?: number
          storage_path?: string
          tags?: string[]
          title?: string
          updated_at?: string
          updated_by?: string | null
          version?: string
        }
        Relationships: []
      }
      bulk_usage: {
        Row: {
          at: string
          calls: number
          id: number
          items: number
          staff_id: string
        }
        Insert: {
          at?: string
          calls: number
          id?: never
          items: number
          staff_id: string
        }
        Update: {
          at?: string
          calls?: number
          id?: never
          items?: number
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_usage_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          categories: Database["hq"]["Enums"]["partner_category"][]
          contact_kind: Database["hq"]["Enums"]["contact_kind"]
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          email: string | null
          external_ids: Json
          full_name: string
          id: string
          last_contact_at: string | null
          location: string | null
          name_key: string | null
          needs_verification: boolean
          next_follow_up_date: string | null
          notes: string | null
          org_contact_role: Database["hq"]["Enums"]["org_contact_role"]
          organisation_id: string | null
          phone: string | null
          position: string | null
          priority: Database["hq"]["Enums"]["priority_level"]
          relationship_owner_id: string | null
          relationship_status: Database["hq"]["Enums"]["relationship_status"]
          service_region: string | null
          source: string | null
          updated_at: string
          verified_at: string | null
          verified_by: string | null
          website: string | null
        }
        Insert: {
          categories?: Database["hq"]["Enums"]["partner_category"][]
          contact_kind?: Database["hq"]["Enums"]["contact_kind"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          external_ids?: Json
          full_name: string
          id?: string
          last_contact_at?: string | null
          location?: string | null
          name_key?: string | null
          needs_verification?: boolean
          next_follow_up_date?: string | null
          notes?: string | null
          org_contact_role?: Database["hq"]["Enums"]["org_contact_role"]
          organisation_id?: string | null
          phone?: string | null
          position?: string | null
          priority?: Database["hq"]["Enums"]["priority_level"]
          relationship_owner_id?: string | null
          relationship_status?: Database["hq"]["Enums"]["relationship_status"]
          service_region?: string | null
          source?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          website?: string | null
        }
        Update: {
          categories?: Database["hq"]["Enums"]["partner_category"][]
          contact_kind?: Database["hq"]["Enums"]["contact_kind"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          external_ids?: Json
          full_name?: string
          id?: string
          last_contact_at?: string | null
          location?: string | null
          name_key?: string | null
          needs_verification?: boolean
          next_follow_up_date?: string | null
          notes?: string | null
          org_contact_role?: Database["hq"]["Enums"]["org_contact_role"]
          organisation_id?: string | null
          phone?: string | null
          position?: string | null
          priority?: Database["hq"]["Enums"]["priority_level"]
          relationship_owner_id?: string | null
          relationship_status?: Database["hq"]["Enums"]["relationship_status"]
          service_region?: string | null
          source?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "partner_performance"
            referencedColumns: ["organisation_id"]
          },
          {
            foreignKeyName: "contacts_relationship_owner_id_fkey"
            columns: ["relationship_owner_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_documents: {
        Row: {
          contractor_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          document_type: Database["hq"]["Enums"]["contractor_document_type"]
          expires_on: string | null
          file_name: string
          id: string
          mime_type: string
          notes: string | null
          size_bytes: number
          storage_path: string
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
          verification: Database["hq"]["Enums"]["document_verification"]
          verification_note: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          contractor_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          document_type: Database["hq"]["Enums"]["contractor_document_type"]
          expires_on?: string | null
          file_name: string
          id?: string
          mime_type: string
          notes?: string | null
          size_bytes: number
          storage_path: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          verification?: Database["hq"]["Enums"]["document_verification"]
          verification_note?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          contractor_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          document_type?: Database["hq"]["Enums"]["contractor_document_type"]
          expires_on?: string | null
          file_name?: string
          id?: string
          mime_type?: string
          notes?: string | null
          size_bytes?: number
          storage_path?: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          verification?: Database["hq"]["Enums"]["document_verification"]
          verification_note?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contractor_documents_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_documents_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_reviews: {
        Row: {
          communication: number | null
          contractor_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          invoice_accuracy: number | null
          job_date: string | null
          job_reference: string | null
          notes: string | null
          recorded_by: string | null
          response_time: number | null
          rework_required: boolean | null
          tenant_feedback: Database["hq"]["Enums"]["tenant_feedback"] | null
          updated_at: string
          work_quality: number | null
        }
        Insert: {
          communication?: number | null
          contractor_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          invoice_accuracy?: number | null
          job_date?: string | null
          job_reference?: string | null
          notes?: string | null
          recorded_by?: string | null
          response_time?: number | null
          rework_required?: boolean | null
          tenant_feedback?: Database["hq"]["Enums"]["tenant_feedback"] | null
          updated_at?: string
          work_quality?: number | null
        }
        Update: {
          communication?: number | null
          contractor_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          invoice_accuracy?: number | null
          job_date?: string | null
          job_reference?: string | null
          notes?: string | null
          recorded_by?: string | null
          response_time?: number | null
          rework_required?: boolean | null
          tenant_feedback?: Database["hq"]["Enums"]["tenant_feedback"] | null
          updated_at?: string
          work_quality?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contractor_reviews_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_reviews_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          contractor_id: string
          from_status: Database["hq"]["Enums"]["contractor_status"] | null
          id: number
          note: string | null
          to_status: Database["hq"]["Enums"]["contractor_status"]
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          contractor_id: string
          from_status?: Database["hq"]["Enums"]["contractor_status"] | null
          id?: never
          note?: string | null
          to_status: Database["hq"]["Enums"]["contractor_status"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          contractor_id?: string
          from_status?: Database["hq"]["Enums"]["contractor_status"] | null
          id?: never
          note?: string | null
          to_status?: Database["hq"]["Enums"]["contractor_status"]
        }
        Relationships: [
          {
            foreignKeyName: "contractor_status_history_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_status_history_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_vetting_steps: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          contractor_id: string
          note: string | null
          status: Database["hq"]["Enums"]["vetting_step_status"]
          step: Database["hq"]["Enums"]["vetting_step"]
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          contractor_id: string
          note?: string | null
          status?: Database["hq"]["Enums"]["vetting_step_status"]
          step: Database["hq"]["Enums"]["vetting_step"]
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          contractor_id?: string
          note?: string | null
          status?: Database["hq"]["Enums"]["vetting_step_status"]
          step?: Database["hq"]["Enums"]["vetting_step"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contractor_vetting_steps_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_vetting_steps_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      contractors: {
        Row: {
          abn: string | null
          after_hours_fee_cents: number | null
          approved_at: string | null
          approved_by: string | null
          business_hours: string | null
          business_name: string
          callout_fee_cents: number | null
          categories: string[]
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          email: string | null
          emergency_available: boolean | null
          external_ids: Json
          hourly_rate_cents: number | null
          id: string
          insurance_details: string | null
          insurance_expires_on: string | null
          insurance_verified_at: string | null
          internal_notes: string | null
          invoice_terms: string | null
          last_job_date: string | null
          licence_details: string | null
          licence_expires_on: string | null
          licence_verified_at: string | null
          minimum_charge_cents: number | null
          name_key: string | null
          needs_verification: boolean
          phone: string | null
          primary_contact_name: string | null
          relationship_owner_id: string | null
          service_regions: string[]
          service_suburbs: string[]
          source: string | null
          status: Database["hq"]["Enums"]["contractor_status"]
          status_reason: string | null
          updated_at: string
          verified_at: string | null
          verified_by: string | null
          website: string | null
        }
        Insert: {
          abn?: string | null
          after_hours_fee_cents?: number | null
          approved_at?: string | null
          approved_by?: string | null
          business_hours?: string | null
          business_name: string
          callout_fee_cents?: number | null
          categories: string[]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          emergency_available?: boolean | null
          external_ids?: Json
          hourly_rate_cents?: number | null
          id?: string
          insurance_details?: string | null
          insurance_expires_on?: string | null
          insurance_verified_at?: string | null
          internal_notes?: string | null
          invoice_terms?: string | null
          last_job_date?: string | null
          licence_details?: string | null
          licence_expires_on?: string | null
          licence_verified_at?: string | null
          minimum_charge_cents?: number | null
          name_key?: string | null
          needs_verification?: boolean
          phone?: string | null
          primary_contact_name?: string | null
          relationship_owner_id?: string | null
          service_regions?: string[]
          service_suburbs?: string[]
          source?: string | null
          status?: Database["hq"]["Enums"]["contractor_status"]
          status_reason?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          website?: string | null
        }
        Update: {
          abn?: string | null
          after_hours_fee_cents?: number | null
          approved_at?: string | null
          approved_by?: string | null
          business_hours?: string | null
          business_name?: string
          callout_fee_cents?: number | null
          categories?: string[]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          emergency_available?: boolean | null
          external_ids?: Json
          hourly_rate_cents?: number | null
          id?: string
          insurance_details?: string | null
          insurance_expires_on?: string | null
          insurance_verified_at?: string | null
          internal_notes?: string | null
          invoice_terms?: string | null
          last_job_date?: string | null
          licence_details?: string | null
          licence_expires_on?: string | null
          licence_verified_at?: string | null
          minimum_charge_cents?: number | null
          name_key?: string | null
          needs_verification?: boolean
          phone?: string | null
          primary_contact_name?: string | null
          relationship_owner_id?: string | null
          service_regions?: string[]
          service_suburbs?: string[]
          source?: string | null
          status?: Database["hq"]["Enums"]["contractor_status"]
          status_reason?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contractors_relationship_owner_id_fkey"
            columns: ["relationship_owner_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_history: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          changed_by_name: string | null
          changes: Json
          decision_id: string
          id: number
          note: string | null
          summary: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          changes?: Json
          decision_id: string
          id?: never
          note?: string | null
          summary: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          changes?: Json
          decision_id?: string
          id?: never
          note?: string | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_history_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "decision_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_history_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_tasks: {
        Row: {
          decision_id: string
          linked_at: string
          linked_by: string | null
          task_id: string
        }
        Insert: {
          decision_id: string
          linked_at?: string
          linked_by?: string | null
          task_id: string
        }
        Update: {
          decision_id?: string
          linked_at?: string
          linked_by?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_tasks_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "decision_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_tasks_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_tasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "open_meeting_actions"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "decision_tasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_tasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      decisions: {
        Row: {
          category: Database["hq"]["Enums"]["decision_category"]
          created_at: string
          created_by: string | null
          decision_date: string
          decision_maker_id: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          rationale: string | null
          ref_number: number
          reversed_note: string | null
          status: Database["hq"]["Enums"]["decision_status"]
          superseded_by_id: string | null
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category: Database["hq"]["Enums"]["decision_category"]
          created_at?: string
          created_by?: string | null
          decision_date: string
          decision_maker_id: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          rationale?: string | null
          ref_number?: never
          reversed_note?: string | null
          status?: Database["hq"]["Enums"]["decision_status"]
          superseded_by_id?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: Database["hq"]["Enums"]["decision_category"]
          created_at?: string
          created_by?: string | null
          decision_date?: string
          decision_maker_id?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          rationale?: string | null
          ref_number?: never
          reversed_note?: string | null
          status?: Database["hq"]["Enums"]["decision_status"]
          superseded_by_id?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "decisions_decision_maker_id_fkey"
            columns: ["decision_maker_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_superseded_by_id_fkey"
            columns: ["superseded_by_id"]
            isOneToOne: false
            referencedRelation: "decision_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_superseded_by_id_fkey"
            columns: ["superseded_by_id"]
            isOneToOne: false
            referencedRelation: "decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      email_drafts: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          body_text: string
          created_at: string
          created_by: string
          created_via: string
          discarded_at: string | null
          discarded_by: string | null
          error_code: string | null
          id: string
          interaction_id: string | null
          mcp_client_id: string | null
          opportunity_id: string | null
          provider_message_id: string | null
          recipient_contact_id: string | null
          recipient_staff_id: string | null
          ref_number: number
          reply_to_email: string
          send_started_at: string | null
          send_via: string | null
          sent_at: string | null
          sent_by: string | null
          status: Database["hq"]["Enums"]["email_status"]
          subject: string
          template: Database["hq"]["Enums"]["email_template"]
          to_email: string
          to_name: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          body_text: string
          created_at?: string
          created_by: string
          created_via?: string
          discarded_at?: string | null
          discarded_by?: string | null
          error_code?: string | null
          id?: string
          interaction_id?: string | null
          mcp_client_id?: string | null
          opportunity_id?: string | null
          provider_message_id?: string | null
          recipient_contact_id?: string | null
          recipient_staff_id?: string | null
          ref_number?: never
          reply_to_email: string
          send_started_at?: string | null
          send_via?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: Database["hq"]["Enums"]["email_status"]
          subject: string
          template?: Database["hq"]["Enums"]["email_template"]
          to_email: string
          to_name: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          body_text?: string
          created_at?: string
          created_by?: string
          created_via?: string
          discarded_at?: string | null
          discarded_by?: string | null
          error_code?: string | null
          id?: string
          interaction_id?: string | null
          mcp_client_id?: string | null
          opportunity_id?: string | null
          provider_message_id?: string | null
          recipient_contact_id?: string | null
          recipient_staff_id?: string | null
          ref_number?: never
          reply_to_email?: string
          send_started_at?: string | null
          send_via?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: Database["hq"]["Enums"]["email_status"]
          subject?: string
          template?: Database["hq"]["Enums"]["email_template"]
          to_email?: string
          to_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_drafts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_discarded_by_fkey"
            columns: ["discarded_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_interaction_id_fkey"
            columns: ["interaction_id"]
            isOneToOne: false
            referencedRelation: "interactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "overdue_opportunities"
            referencedColumns: ["opportunity_id"]
          },
          {
            foreignKeyName: "email_drafts_recipient_contact_id_fkey"
            columns: ["recipient_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_recipient_contact_id_fkey"
            columns: ["recipient_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_recipient_contact_id_fkey"
            columns: ["recipient_contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["primary_contact_id"]
          },
          {
            foreignKeyName: "email_drafts_recipient_contact_id_fkey"
            columns: ["recipient_contact_id"]
            isOneToOne: false
            referencedRelation: "overdue_followups"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "email_drafts_recipient_staff_id_fkey"
            columns: ["recipient_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      enquiries: {
        Row: {
          auto_reply_at: string | null
          auto_reply_interaction_id: string | null
          auto_reply_message_id: string | null
          auto_reply_reason: string | null
          auto_reply_status: Database["hq"]["Enums"]["enquiry_auto_reply_status"]
          contact_id: string | null
          created_contact: boolean
          created_lead: boolean
          details: Json
          email: string
          handled_at: string | null
          handled_by: string | null
          id: string
          interaction_id: string | null
          ip_hash: string | null
          kind: Database["hq"]["Enums"]["enquiry_kind"]
          message: string | null
          name: string
          opportunity_id: string | null
          phone: string | null
          received_at: string
          ref_number: number
          source_page: string | null
          spam_marked_at: string | null
          spam_marked_by: string | null
          status: Database["hq"]["Enums"]["enquiry_status"]
          status_note: string | null
          submission_hash: string
          suburb: string | null
          task_id: string | null
          updated_at: string
        }
        Insert: {
          auto_reply_at?: string | null
          auto_reply_interaction_id?: string | null
          auto_reply_message_id?: string | null
          auto_reply_reason?: string | null
          auto_reply_status?: Database["hq"]["Enums"]["enquiry_auto_reply_status"]
          contact_id?: string | null
          created_contact?: boolean
          created_lead?: boolean
          details?: Json
          email: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          interaction_id?: string | null
          ip_hash?: string | null
          kind: Database["hq"]["Enums"]["enquiry_kind"]
          message?: string | null
          name: string
          opportunity_id?: string | null
          phone?: string | null
          received_at?: string
          ref_number?: never
          source_page?: string | null
          spam_marked_at?: string | null
          spam_marked_by?: string | null
          status?: Database["hq"]["Enums"]["enquiry_status"]
          status_note?: string | null
          submission_hash: string
          suburb?: string | null
          task_id?: string | null
          updated_at?: string
        }
        Update: {
          auto_reply_at?: string | null
          auto_reply_interaction_id?: string | null
          auto_reply_message_id?: string | null
          auto_reply_reason?: string | null
          auto_reply_status?: Database["hq"]["Enums"]["enquiry_auto_reply_status"]
          contact_id?: string | null
          created_contact?: boolean
          created_lead?: boolean
          details?: Json
          email?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          interaction_id?: string | null
          ip_hash?: string | null
          kind?: Database["hq"]["Enums"]["enquiry_kind"]
          message?: string | null
          name?: string
          opportunity_id?: string | null
          phone?: string | null
          received_at?: string
          ref_number?: never
          source_page?: string | null
          spam_marked_at?: string | null
          spam_marked_by?: string | null
          status?: Database["hq"]["Enums"]["enquiry_status"]
          status_note?: string | null
          submission_hash?: string
          suburb?: string | null
          task_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enquiries_auto_reply_interaction_id_fkey"
            columns: ["auto_reply_interaction_id"]
            isOneToOne: false
            referencedRelation: "interactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["primary_contact_id"]
          },
          {
            foreignKeyName: "enquiries_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "overdue_followups"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "enquiries_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_interaction_id_fkey"
            columns: ["interaction_id"]
            isOneToOne: false
            referencedRelation: "interactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "overdue_opportunities"
            referencedColumns: ["opportunity_id"]
          },
          {
            foreignKeyName: "enquiries_spam_marked_by_fkey"
            columns: ["spam_marked_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "open_meeting_actions"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "enquiries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          created_at: string
          id: number
          key: string
          request_hash: string
          result: Json
          scope: string
          staff_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          key: string
          request_hash: string
          result: Json
          scope: string
          staff_id: string
        }
        Update: {
          created_at?: string
          id?: never
          key?: string
          request_hash?: string
          result?: Json
          scope?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "idempotency_keys_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          applied_at: string
          applied_by: string | null
          contacts_created: number
          contractors_created: number
          duplicates_skipped: number
          file_name: string | null
          flagged: number
          id: string
          kind: string
          organisations_created: number
          row_count: number
          source: string
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          contacts_created?: number
          contractors_created?: number
          duplicates_skipped?: number
          file_name?: string | null
          flagged?: number
          id?: string
          kind?: string
          organisations_created?: number
          row_count?: number
          source: string
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          contacts_created?: number
          contractors_created?: number
          duplicates_skipped?: number
          file_name?: string | null
          flagged?: number
          id?: string
          kind?: string
          organisations_created?: number
          row_count?: number
          source?: string
        }
        Relationships: []
      }
      interactions: {
        Row: {
          contact_id: string | null
          contractor_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          follow_up_date: string | null
          id: string
          interaction_type: Database["hq"]["Enums"]["interaction_type"]
          next_action: string | null
          occurred_at: string
          opportunity_id: string | null
          organisation_id: string | null
          staff_id: string | null
          summary: string
          task_id: string | null
          updated_at: string
        }
        Insert: {
          contact_id?: string | null
          contractor_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          follow_up_date?: string | null
          id?: string
          interaction_type: Database["hq"]["Enums"]["interaction_type"]
          next_action?: string | null
          occurred_at?: string
          opportunity_id?: string | null
          organisation_id?: string | null
          staff_id?: string | null
          summary: string
          task_id?: string | null
          updated_at?: string
        }
        Update: {
          contact_id?: string | null
          contractor_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          follow_up_date?: string | null
          id?: string
          interaction_type?: Database["hq"]["Enums"]["interaction_type"]
          next_action?: string | null
          occurred_at?: string
          opportunity_id?: string | null
          organisation_id?: string | null
          staff_id?: string | null
          summary?: string
          task_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["primary_contact_id"]
          },
          {
            foreignKeyName: "interactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "overdue_followups"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "interactions_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "overdue_opportunities"
            referencedColumns: ["opportunity_id"]
          },
          {
            foreignKeyName: "interactions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "partner_performance"
            referencedColumns: ["organisation_id"]
          },
          {
            foreignKeyName: "interactions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "open_meeting_actions"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "interactions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          approved_version: number | null
          category: Database["hq"]["Enums"]["knowledge_category"]
          created_at: string
          created_by: string | null
          current_version: number
          deleted_at: string | null
          deleted_by: string | null
          id: string
          is_template: boolean
          name_key: string | null
          owner_id: string | null
          ref_number: number
          review_due: string | null
          status: Database["hq"]["Enums"]["knowledge_status"]
          summary: string | null
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_version?: number | null
          category: Database["hq"]["Enums"]["knowledge_category"]
          created_at?: string
          created_by?: string | null
          current_version?: number
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_template?: boolean
          name_key?: string | null
          owner_id?: string | null
          ref_number?: never
          review_due?: string | null
          status?: Database["hq"]["Enums"]["knowledge_status"]
          summary?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_version?: number | null
          category?: Database["hq"]["Enums"]["knowledge_category"]
          created_at?: string
          created_by?: string | null
          current_version?: number
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_template?: boolean
          name_key?: string | null
          owner_id?: string | null
          ref_number?: never
          review_due?: string | null
          status?: Database["hq"]["Enums"]["knowledge_status"]
          summary?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_documents_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_versions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approved_by_name: string | null
          approved_via: string | null
          based_on_version: number | null
          body: string
          change_note: string | null
          discarded_at: string | null
          discarded_by: string | null
          document_id: string
          edited_at: string
          edited_by: string | null
          edited_by_name: string | null
          id: number
          mcp_client_id: string | null
          status: Database["hq"]["Enums"]["knowledge_version_status"]
          summary: string | null
          title: string
          version: number
          via: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          approved_via?: string | null
          based_on_version?: number | null
          body: string
          change_note?: string | null
          discarded_at?: string | null
          discarded_by?: string | null
          document_id: string
          edited_at?: string
          edited_by?: string | null
          edited_by_name?: string | null
          id?: never
          mcp_client_id?: string | null
          status?: Database["hq"]["Enums"]["knowledge_version_status"]
          summary?: string | null
          title: string
          version: number
          via?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          approved_via?: string | null
          based_on_version?: number | null
          body?: string
          change_note?: string | null
          discarded_at?: string | null
          discarded_by?: string | null
          document_id?: string
          edited_at?: string
          edited_by?: string | null
          edited_by_name?: string | null
          id?: never
          mcp_client_id?: string | null
          status?: Database["hq"]["Enums"]["knowledge_version_status"]
          summary?: string | null
          title?: string
          version?: number
          via?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_versions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_versions_discarded_by_fkey"
            columns: ["discarded_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_versions_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      managed_properties: {
        Row: {
          address_key: string | null
          agreement_signed_on: string | null
          ailo_reference: string | null
          ailo_status: Database["hq"]["Enums"]["ailo_status"]
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          ended_on: string | null
          fee_basis: Database["hq"]["Enums"]["fee_basis"] | null
          fee_notes: string | null
          fee_percent: number | null
          id: string
          managed_from: string | null
          manual_origin_note: string | null
          notes: string | null
          opportunity_id: string | null
          owner_contact_id: string | null
          owner_name: string | null
          property_address: string
          ref_number: number
          service_type: Database["hq"]["Enums"]["service_type"]
          status: Database["hq"]["Enums"]["managed_status"]
          suburb: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address_key?: string | null
          agreement_signed_on?: string | null
          ailo_reference?: string | null
          ailo_status?: Database["hq"]["Enums"]["ailo_status"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          ended_on?: string | null
          fee_basis?: Database["hq"]["Enums"]["fee_basis"] | null
          fee_notes?: string | null
          fee_percent?: number | null
          id?: string
          managed_from?: string | null
          manual_origin_note?: string | null
          notes?: string | null
          opportunity_id?: string | null
          owner_contact_id?: string | null
          owner_name?: string | null
          property_address: string
          ref_number?: never
          service_type: Database["hq"]["Enums"]["service_type"]
          status?: Database["hq"]["Enums"]["managed_status"]
          suburb?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address_key?: string | null
          agreement_signed_on?: string | null
          ailo_reference?: string | null
          ailo_status?: Database["hq"]["Enums"]["ailo_status"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          ended_on?: string | null
          fee_basis?: Database["hq"]["Enums"]["fee_basis"] | null
          fee_notes?: string | null
          fee_percent?: number | null
          id?: string
          managed_from?: string | null
          manual_origin_note?: string | null
          notes?: string | null
          opportunity_id?: string | null
          owner_contact_id?: string | null
          owner_name?: string | null
          property_address?: string
          ref_number?: never
          service_type?: Database["hq"]["Enums"]["service_type"]
          status?: Database["hq"]["Enums"]["managed_status"]
          suburb?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "managed_properties_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: true
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_properties_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: true
            referencedRelation: "opportunity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_properties_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: true
            referencedRelation: "overdue_opportunities"
            referencedColumns: ["opportunity_id"]
          },
          {
            foreignKeyName: "managed_properties_owner_contact_id_fkey"
            columns: ["owner_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_properties_owner_contact_id_fkey"
            columns: ["owner_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_properties_owner_contact_id_fkey"
            columns: ["owner_contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["primary_contact_id"]
          },
          {
            foreignKeyName: "managed_properties_owner_contact_id_fkey"
            columns: ["owner_contact_id"]
            isOneToOne: false
            referencedRelation: "overdue_followups"
            referencedColumns: ["contact_id"]
          },
        ]
      }
      meeting_actions: {
        Row: {
          created_at: string
          created_by: string | null
          meeting_id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          meeting_id: string
          task_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          meeting_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_actions_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_actions_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_actions_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "open_meeting_actions"
            referencedColumns: ["meeting_id"]
          },
          {
            foreignKeyName: "meeting_actions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "open_meeting_actions"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "meeting_actions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_actions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_attendees: {
        Row: {
          added_at: string
          added_by: string | null
          contact_id: string | null
          external_name: string | null
          id: number
          meeting_id: string
          staff_id: string | null
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          contact_id?: string | null
          external_name?: string | null
          id?: never
          meeting_id: string
          staff_id?: string | null
        }
        Update: {
          added_at?: string
          added_by?: string | null
          contact_id?: string | null
          external_name?: string | null
          id?: never
          meeting_id?: string
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_attendees_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_attendees_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_attendees_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["primary_contact_id"]
          },
          {
            foreignKeyName: "meeting_attendees_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "overdue_followups"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "meeting_attendees_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_attendees_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_attendees_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "open_meeting_actions"
            referencedColumns: ["meeting_id"]
          },
          {
            foreignKeyName: "meeting_attendees_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_history: {
        Row: {
          action: string
          change_note: string | null
          change_summary: string
          changes: Json
          decisions_text: string | null
          edited_at: string
          edited_by: string | null
          edited_by_name: string | null
          id: number
          mcp_client_id: string | null
          meeting_id: string
          minutes: string | null
          summary: string | null
          title: string
          version: number
          via: string
        }
        Insert: {
          action: string
          change_note?: string | null
          change_summary: string
          changes?: Json
          decisions_text?: string | null
          edited_at?: string
          edited_by?: string | null
          edited_by_name?: string | null
          id?: never
          mcp_client_id?: string | null
          meeting_id: string
          minutes?: string | null
          summary?: string | null
          title: string
          version: number
          via?: string
        }
        Update: {
          action?: string
          change_note?: string | null
          change_summary?: string
          changes?: Json
          decisions_text?: string | null
          edited_at?: string
          edited_by?: string | null
          edited_by_name?: string | null
          id?: never
          mcp_client_id?: string | null
          meeting_id?: string
          minutes?: string | null
          summary?: string | null
          title?: string
          version?: number
          via?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_history_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_history_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_history_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "open_meeting_actions"
            referencedColumns: ["meeting_id"]
          },
        ]
      }
      meeting_links: {
        Row: {
          contact_id: string | null
          contractor_id: string | null
          decision_id: string | null
          id: number
          interaction_id: string | null
          linked_at: string
          linked_by: string | null
          managed_property_id: string | null
          meeting_id: string
          opportunity_id: string | null
          organisation_id: string | null
        }
        Insert: {
          contact_id?: string | null
          contractor_id?: string | null
          decision_id?: string | null
          id?: never
          interaction_id?: string | null
          linked_at?: string
          linked_by?: string | null
          managed_property_id?: string | null
          meeting_id: string
          opportunity_id?: string | null
          organisation_id?: string | null
        }
        Update: {
          contact_id?: string | null
          contractor_id?: string | null
          decision_id?: string | null
          id?: never
          interaction_id?: string | null
          linked_at?: string
          linked_by?: string | null
          managed_property_id?: string | null
          meeting_id?: string
          opportunity_id?: string | null
          organisation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_links_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_links_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_links_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["primary_contact_id"]
          },
          {
            foreignKeyName: "meeting_links_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "overdue_followups"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "meeting_links_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_links_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_links_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "decision_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_links_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_links_interaction_id_fkey"
            columns: ["interaction_id"]
            isOneToOne: false
            referencedRelation: "interactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_links_managed_property_id_fkey"
            columns: ["managed_property_id"]
            isOneToOne: false
            referencedRelation: "managed_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_links_managed_property_id_fkey"
            columns: ["managed_property_id"]
            isOneToOne: false
            referencedRelation: "portfolio_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_links_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_links_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_links_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "open_meeting_actions"
            referencedColumns: ["meeting_id"]
          },
          {
            foreignKeyName: "meeting_links_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_links_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_links_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "overdue_opportunities"
            referencedColumns: ["opportunity_id"]
          },
          {
            foreignKeyName: "meeting_links_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_links_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_links_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "partner_performance"
            referencedColumns: ["organisation_id"]
          },
        ]
      }
      meetings: {
        Row: {
          confidential: boolean
          created_at: string
          created_by: string | null
          created_via: string
          decisions_text: string | null
          deleted_at: string | null
          deleted_by: string | null
          duration_minutes: number | null
          held_at: string
          id: string
          location: string | null
          mcp_client_id: string | null
          meeting_type: Database["hq"]["Enums"]["meeting_type"]
          minutes: string | null
          ref_number: number
          staff_attendee_ids: string[]
          summary: string | null
          title: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          confidential?: boolean
          created_at?: string
          created_by?: string | null
          created_via?: string
          decisions_text?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          duration_minutes?: number | null
          held_at: string
          id?: string
          location?: string | null
          mcp_client_id?: string | null
          meeting_type?: Database["hq"]["Enums"]["meeting_type"]
          minutes?: string | null
          ref_number?: never
          staff_attendee_ids?: string[]
          summary?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          confidential?: boolean
          created_at?: string
          created_by?: string | null
          created_via?: string
          decisions_text?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          duration_minutes?: number | null
          held_at?: string
          id?: string
          location?: string | null
          mcp_client_id?: string | null
          meeting_type?: Database["hq"]["Enums"]["meeting_type"]
          minutes?: string | null
          ref_number?: never
          staff_attendee_ids?: string[]
          summary?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: []
      }
      opportunities: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          display_number: number
          estimated_annual_value_cents: number | null
          expected_close_date: string | null
          id: string
          last_activity_at: string | null
          lost_reason: string | null
          lost_reason_code: Database["hq"]["Enums"]["lost_reason"] | null
          management_reference: string | null
          next_action: string | null
          next_action_due: string | null
          notes: string | null
          owner_contact_id: string | null
          property_address: string | null
          property_suburb: string | null
          prospect_email: string | null
          prospect_name: string
          prospect_phone: string | null
          signed_at: string | null
          source: Database["hq"]["Enums"]["lead_source"]
          stage: Database["hq"]["Enums"]["opportunity_stage"]
          stage_changed_at: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          display_number?: never
          estimated_annual_value_cents?: number | null
          expected_close_date?: string | null
          id?: string
          last_activity_at?: string | null
          lost_reason?: string | null
          lost_reason_code?: Database["hq"]["Enums"]["lost_reason"] | null
          management_reference?: string | null
          next_action?: string | null
          next_action_due?: string | null
          notes?: string | null
          owner_contact_id?: string | null
          property_address?: string | null
          property_suburb?: string | null
          prospect_email?: string | null
          prospect_name: string
          prospect_phone?: string | null
          signed_at?: string | null
          source?: Database["hq"]["Enums"]["lead_source"]
          stage?: Database["hq"]["Enums"]["opportunity_stage"]
          stage_changed_at?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          display_number?: never
          estimated_annual_value_cents?: number | null
          expected_close_date?: string | null
          id?: string
          last_activity_at?: string | null
          lost_reason?: string | null
          lost_reason_code?: Database["hq"]["Enums"]["lost_reason"] | null
          management_reference?: string | null
          next_action?: string | null
          next_action_due?: string | null
          notes?: string | null
          owner_contact_id?: string | null
          property_address?: string | null
          property_suburb?: string | null
          prospect_email?: string | null
          prospect_name?: string
          prospect_phone?: string | null
          signed_at?: string | null
          source?: Database["hq"]["Enums"]["lead_source"]
          stage?: Database["hq"]["Enums"]["opportunity_stage"]
          stage_changed_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_contact_id_fkey"
            columns: ["owner_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_contact_id_fkey"
            columns: ["owner_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_contact_id_fkey"
            columns: ["owner_contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["primary_contact_id"]
          },
          {
            foreignKeyName: "opportunities_owner_contact_id_fkey"
            columns: ["owner_contact_id"]
            isOneToOne: false
            referencedRelation: "overdue_followups"
            referencedColumns: ["contact_id"]
          },
        ]
      }
      opportunity_stage_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_stage: Database["hq"]["Enums"]["opportunity_stage"] | null
          id: number
          note: string | null
          opportunity_id: string
          to_stage: Database["hq"]["Enums"]["opportunity_stage"]
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_stage?: Database["hq"]["Enums"]["opportunity_stage"] | null
          id?: never
          note?: string | null
          opportunity_id: string
          to_stage: Database["hq"]["Enums"]["opportunity_stage"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_stage?: Database["hq"]["Enums"]["opportunity_stage"] | null
          id?: never
          note?: string | null
          opportunity_id?: string
          to_stage?: Database["hq"]["Enums"]["opportunity_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_stage_history_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_stage_history_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_stage_history_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "overdue_opportunities"
            referencedColumns: ["opportunity_id"]
          },
        ]
      }
      organisations: {
        Row: {
          categories: Database["hq"]["Enums"]["partner_category"][]
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          email: string | null
          external_ids: Json
          id: string
          location: string | null
          name: string
          name_key: string | null
          needs_verification: boolean
          notes: string | null
          phone: string | null
          relationship_owner_id: string | null
          service_region: string | null
          source: string | null
          updated_at: string
          verified_at: string | null
          verified_by: string | null
          website: string | null
        }
        Insert: {
          categories: Database["hq"]["Enums"]["partner_category"][]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          external_ids?: Json
          id?: string
          location?: string | null
          name: string
          name_key?: string | null
          needs_verification?: boolean
          notes?: string | null
          phone?: string | null
          relationship_owner_id?: string | null
          service_region?: string | null
          source?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          website?: string | null
        }
        Update: {
          categories?: Database["hq"]["Enums"]["partner_category"][]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          external_ids?: Json
          id?: string
          location?: string | null
          name?: string
          name_key?: string | null
          needs_verification?: boolean
          notes?: string | null
          phone?: string | null
          relationship_owner_id?: string | null
          service_region?: string | null
          source?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organisations_relationship_owner_id_fkey"
            columns: ["relationship_owner_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pods: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          region: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          region?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          region?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      project_activity: {
        Row: {
          actor_id: string | null
          at: string
          detail: Json
          id: number
          kind: string
          project_id: string
          summary: string
        }
        Insert: {
          actor_id?: string | null
          at?: string
          detail?: Json
          id?: never
          kind: string
          project_id: string
          summary: string
        }
        Update: {
          actor_id?: string | null
          at?: string
          detail?: Json
          id?: never
          kind?: string
          project_id?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_activity_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_activity_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_documents: {
        Row: {
          added_at: string
          added_by: string | null
          id: number
          project_id: string
          title: string
          url: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          id?: never
          project_id: string
          title: string
          url: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          id?: never
          project_id?: string
          title?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_links: {
        Row: {
          contact_id: string | null
          contractor_id: string | null
          id: number
          linked_at: string
          linked_by: string | null
          opportunity_id: string | null
          organisation_id: string | null
          project_id: string
        }
        Insert: {
          contact_id?: string | null
          contractor_id?: string | null
          id?: never
          linked_at?: string
          linked_by?: string | null
          opportunity_id?: string | null
          organisation_id?: string | null
          project_id: string
        }
        Update: {
          contact_id?: string | null
          contractor_id?: string | null
          id?: never
          linked_at?: string
          linked_by?: string | null
          opportunity_id?: string | null
          organisation_id?: string | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_links_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_links_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_links_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["primary_contact_id"]
          },
          {
            foreignKeyName: "project_links_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "overdue_followups"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "project_links_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_links_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_links_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_links_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_links_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "overdue_opportunities"
            referencedColumns: ["opportunity_id"]
          },
          {
            foreignKeyName: "project_links_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_links_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_links_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "partner_performance"
            referencedColumns: ["organisation_id"]
          },
          {
            foreignKeyName: "project_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_milestones: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          name: string
          project_id: string
          sort_order: number
          status: Database["hq"]["Enums"]["milestone_status"]
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          name: string
          project_id: string
          sort_order?: number
          status?: Database["hq"]["Enums"]["milestone_status"]
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          name?: string
          project_id?: string
          sort_order?: number
          status?: Database["hq"]["Enums"]["milestone_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          name: string
          notes: string | null
          owner_id: string | null
          priority: Database["hq"]["Enums"]["task_priority"]
          ref_number: number
          start_date: string | null
          status: Database["hq"]["Enums"]["project_status"]
          target_date: string | null
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          name: string
          notes?: string | null
          owner_id?: string | null
          priority?: Database["hq"]["Enums"]["task_priority"]
          ref_number?: never
          start_date?: string | null
          status?: Database["hq"]["Enums"]["project_status"]
          target_date?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          name?: string
          notes?: string | null
          owner_id?: string | null
          priority?: Database["hq"]["Enums"]["task_priority"]
          ref_number?: never
          start_date?: string | null
          status?: Database["hq"]["Enums"]["project_status"]
          target_date?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "projects_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      property_handover_steps: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          note: string | null
          property_id: string
          status: Database["hq"]["Enums"]["handover_step_status"]
          step: Database["hq"]["Enums"]["handover_step"]
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          note?: string | null
          property_id: string
          status?: Database["hq"]["Enums"]["handover_step_status"]
          step: Database["hq"]["Enums"]["handover_step"]
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          note?: string | null
          property_id?: string
          status?: Database["hq"]["Enums"]["handover_step_status"]
          step?: Database["hq"]["Enums"]["handover_step"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_handover_steps_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "managed_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_handover_steps_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "portfolio_overview"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          direction: Database["hq"]["Enums"]["referral_direction"]
          id: string
          is_attributed: boolean
          notes: string | null
          opportunity_id: string | null
          property_address: string | null
          property_suburb: string | null
          prospect_email: string | null
          prospect_name: string | null
          prospect_phone: string | null
          receiving_contact_id: string | null
          receiving_organisation_id: string | null
          ref_number: number
          referral_date: string
          referring_contact_id: string | null
          referring_organisation_id: string | null
          sent_outcome: Database["hq"]["Enums"]["sent_referral_outcome"] | null
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          direction: Database["hq"]["Enums"]["referral_direction"]
          id?: string
          is_attributed?: boolean
          notes?: string | null
          opportunity_id?: string | null
          property_address?: string | null
          property_suburb?: string | null
          prospect_email?: string | null
          prospect_name?: string | null
          prospect_phone?: string | null
          receiving_contact_id?: string | null
          receiving_organisation_id?: string | null
          ref_number?: never
          referral_date: string
          referring_contact_id?: string | null
          referring_organisation_id?: string | null
          sent_outcome?: Database["hq"]["Enums"]["sent_referral_outcome"] | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          direction?: Database["hq"]["Enums"]["referral_direction"]
          id?: string
          is_attributed?: boolean
          notes?: string | null
          opportunity_id?: string | null
          property_address?: string | null
          property_suburb?: string | null
          prospect_email?: string | null
          prospect_name?: string | null
          prospect_phone?: string | null
          receiving_contact_id?: string | null
          receiving_organisation_id?: string | null
          ref_number?: never
          referral_date?: string
          referring_contact_id?: string | null
          referring_organisation_id?: string | null
          sent_outcome?: Database["hq"]["Enums"]["sent_referral_outcome"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "overdue_opportunities"
            referencedColumns: ["opportunity_id"]
          },
          {
            foreignKeyName: "referrals_receiving_contact_id_fkey"
            columns: ["receiving_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_receiving_contact_id_fkey"
            columns: ["receiving_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_receiving_contact_id_fkey"
            columns: ["receiving_contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["primary_contact_id"]
          },
          {
            foreignKeyName: "referrals_receiving_contact_id_fkey"
            columns: ["receiving_contact_id"]
            isOneToOne: false
            referencedRelation: "overdue_followups"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "referrals_receiving_organisation_id_fkey"
            columns: ["receiving_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_receiving_organisation_id_fkey"
            columns: ["receiving_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_receiving_organisation_id_fkey"
            columns: ["receiving_organisation_id"]
            isOneToOne: false
            referencedRelation: "partner_performance"
            referencedColumns: ["organisation_id"]
          },
          {
            foreignKeyName: "referrals_referring_contact_id_fkey"
            columns: ["referring_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referring_contact_id_fkey"
            columns: ["referring_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referring_contact_id_fkey"
            columns: ["referring_contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["primary_contact_id"]
          },
          {
            foreignKeyName: "referrals_referring_contact_id_fkey"
            columns: ["referring_contact_id"]
            isOneToOne: false
            referencedRelation: "overdue_followups"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "referrals_referring_organisation_id_fkey"
            columns: ["referring_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referring_organisation_id_fkey"
            columns: ["referring_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referring_organisation_id_fkey"
            columns: ["referring_organisation_id"]
            isOneToOne: false
            referencedRelation: "partner_performance"
            referencedColumns: ["organisation_id"]
          },
        ]
      }
      role_capabilities: {
        Row: {
          capability: string
          role: Database["hq"]["Enums"]["staff_role"]
        }
        Insert: {
          capability: string
          role: Database["hq"]["Enums"]["staff_role"]
        }
        Update: {
          capability?: string
          role?: Database["hq"]["Enums"]["staff_role"]
        }
        Relationships: []
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      staff_profiles: {
        Row: {
          created_at: string
          created_by: string | null
          dashboard_widgets: string[] | null
          email: string
          employment_status: Database["hq"]["Enums"]["employment_status"]
          first_name: string
          full_name: string
          id: string
          invited_at: string | null
          invited_by: string | null
          is_active: boolean
          pod_id: string | null
          responsibilities: string | null
          role: Database["hq"]["Enums"]["staff_role"]
          start_date: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dashboard_widgets?: string[] | null
          email: string
          employment_status?: Database["hq"]["Enums"]["employment_status"]
          first_name: string
          full_name: string
          id: string
          invited_at?: string | null
          invited_by?: string | null
          is_active?: boolean
          pod_id?: string | null
          responsibilities?: string | null
          role: Database["hq"]["Enums"]["staff_role"]
          start_date?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dashboard_widgets?: string[] | null
          email?: string
          employment_status?: Database["hq"]["Enums"]["employment_status"]
          first_name?: string
          full_name?: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          is_active?: boolean
          pod_id?: string | null
          responsibilities?: string | null
          role?: Database["hq"]["Enums"]["staff_role"]
          start_date?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_profiles_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_profiles_pod_id_fkey"
            columns: ["pod_id"]
            isOneToOne: false
            referencedRelation: "pods"
            referencedColumns: ["id"]
          },
        ]
      }
      task_activity: {
        Row: {
          actor_id: string | null
          at: string
          detail: Json
          id: number
          kind: string
          summary: string
          task_id: string
        }
        Insert: {
          actor_id?: string | null
          at?: string
          detail?: Json
          id?: never
          kind: string
          summary: string
          task_id: string
        }
        Update: {
          actor_id?: string | null
          at?: string
          detail?: Json
          id?: never
          kind?: string
          summary?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "open_meeting_actions"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_checklist_items: {
        Row: {
          created_at: string
          created_by: string | null
          done: boolean
          done_at: string | null
          done_by: string | null
          id: number
          sort_order: number
          task_id: string
          text: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          id?: never
          sort_order?: number
          task_id: string
          text: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          id?: never
          sort_order?: number
          task_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "open_meeting_actions"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          edited_at: string | null
          id: number
          task_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          edited_at?: string | null
          id?: never
          task_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: never
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "open_meeting_actions"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          created_at: string
          created_by: string | null
          depends_on_open: boolean
          depends_on_task_id: string
          id: number
          task_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          depends_on_open?: boolean
          depends_on_task_id: string
          id?: never
          task_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          depends_on_open?: boolean
          depends_on_task_id?: string
          id?: never
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "open_meeting_actions"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_dependencies_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "open_meeting_actions"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          blocked_reason: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          due_date: string | null
          id: string
          milestone_id: string | null
          parent_task_id: string | null
          priority: Database["hq"]["Enums"]["task_priority"]
          project_id: string | null
          related_contact_id: string | null
          related_contractor_id: string | null
          related_opportunity_id: string | null
          related_organisation_id: string | null
          related_referral_id: string | null
          reminder_key: string | null
          sort_order: number
          source: string
          status: Database["hq"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          blocked_reason?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          milestone_id?: string | null
          parent_task_id?: string | null
          priority?: Database["hq"]["Enums"]["task_priority"]
          project_id?: string | null
          related_contact_id?: string | null
          related_contractor_id?: string | null
          related_opportunity_id?: string | null
          related_organisation_id?: string | null
          related_referral_id?: string | null
          reminder_key?: string | null
          sort_order?: number
          source?: string
          status?: Database["hq"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          blocked_reason?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          milestone_id?: string | null
          parent_task_id?: string | null
          priority?: Database["hq"]["Enums"]["task_priority"]
          project_id?: string | null
          related_contact_id?: string | null
          related_contractor_id?: string | null
          related_opportunity_id?: string | null
          related_organisation_id?: string | null
          related_referral_id?: string | null
          reminder_key?: string | null
          sort_order?: number
          source?: string
          status?: Database["hq"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "project_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "project_overview"
            referencedColumns: ["next_milestone_id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "open_meeting_actions"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_contact_id_fkey"
            columns: ["related_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_contact_id_fkey"
            columns: ["related_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_contact_id_fkey"
            columns: ["related_contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["primary_contact_id"]
          },
          {
            foreignKeyName: "tasks_related_contact_id_fkey"
            columns: ["related_contact_id"]
            isOneToOne: false
            referencedRelation: "overdue_followups"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "tasks_related_contractor_id_fkey"
            columns: ["related_contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_contractor_id_fkey"
            columns: ["related_contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "overdue_opportunities"
            referencedColumns: ["opportunity_id"]
          },
          {
            foreignKeyName: "tasks_related_organisation_id_fkey"
            columns: ["related_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_organisation_id_fkey"
            columns: ["related_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_organisation_id_fkey"
            columns: ["related_organisation_id"]
            isOneToOne: false
            referencedRelation: "partner_performance"
            referencedColumns: ["organisation_id"]
          },
          {
            foreignKeyName: "tasks_related_referral_id_fkey"
            columns: ["related_referral_id"]
            isOneToOne: false
            referencedRelation: "opportunity_overview"
            referencedColumns: ["credited_referral_id"]
          },
          {
            foreignKeyName: "tasks_related_referral_id_fkey"
            columns: ["related_referral_id"]
            isOneToOne: false
            referencedRelation: "referral_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_referral_id_fkey"
            columns: ["related_referral_id"]
            isOneToOne: false
            referencedRelation: "referrals"
            referencedColumns: ["id"]
          },
        ]
      }
      trades: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          label: string
          slug: string
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          label: string
          slug: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          label?: string
          slug?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      brand_resource_overview: {
        Row: {
          category: Database["hq"]["Enums"]["brand_resource_category"] | null
          content_sha256: string | null
          created_at: string | null
          created_by: string | null
          created_by_name: string | null
          deleted_at: string | null
          description: string | null
          file_name: string | null
          id: string | null
          mime_type: string | null
          note: string | null
          ref: string | null
          ref_number: number | null
          size_bytes: number | null
          sort_order: number | null
          storage_path: string | null
          tags: string[] | null
          title: string | null
          updated_at: string | null
          updated_by: string | null
          updated_by_name: string | null
          version: string | null
          version_number: number | null
        }
        Relationships: []
      }
      contact_directory: {
        Row: {
          categories: Database["hq"]["Enums"]["partner_category"][] | null
          contact_kind: Database["hq"]["Enums"]["contact_kind"] | null
          created_at: string | null
          email: string | null
          follow_up_overdue: boolean | null
          full_name: string | null
          id: string | null
          last_contact_at: string | null
          location: string | null
          needs_verification: boolean | null
          next_follow_up_date: string | null
          notes: string | null
          org_contact_role: Database["hq"]["Enums"]["org_contact_role"] | null
          organisation_id: string | null
          organisation_name: string | null
          phone: string | null
          position: string | null
          priority: Database["hq"]["Enums"]["priority_level"] | null
          referrals_received: number | null
          referrals_sent: number | null
          relationship_owner_id: string | null
          relationship_owner_name: string | null
          relationship_status:
            | Database["hq"]["Enums"]["relationship_status"]
            | null
          service_region: string | null
          source: string | null
          updated_at: string | null
          verified_at: string | null
          website: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "partner_performance"
            referencedColumns: ["organisation_id"]
          },
          {
            foreignKeyName: "contacts_relationship_owner_id_fkey"
            columns: ["relationship_owner_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_directory: {
        Row: {
          abn: string | null
          after_hours_fee_cents: number | null
          approved_at: string | null
          approved_by: string | null
          approved_by_name: string | null
          business_hours: string | null
          business_name: string | null
          callout_fee_cents: number | null
          categories: string[] | null
          created_at: string | null
          document_count: number | null
          email: string | null
          emergency_available: boolean | null
          hourly_rate_cents: number | null
          id: string | null
          insurance_days_remaining: number | null
          insurance_details: string | null
          insurance_expires_on: string | null
          insurance_state: string | null
          insurance_verified_at: string | null
          internal_notes: string | null
          invoice_terms: string | null
          last_contacted_at: string | null
          last_job_date: string | null
          licence_days_remaining: number | null
          licence_details: string | null
          licence_expires_on: string | null
          licence_state: string | null
          licence_verified_at: string | null
          minimum_charge_cents: number | null
          needs_verification: boolean | null
          open_task_count: number | null
          phone: string | null
          primary_contact_name: string | null
          rated_review_count: number | null
          rating: number | null
          rating_communication: number | null
          rating_invoice_accuracy: number | null
          rating_response_time: number | null
          rating_threshold: number | null
          rating_work_quality: number | null
          relationship_owner_id: string | null
          relationship_owner_name: string | null
          review_count: number | null
          service_region_keys: string[] | null
          service_regions: string[] | null
          service_suburb_keys: string[] | null
          service_suburbs: string[] | null
          source: string | null
          status: Database["hq"]["Enums"]["contractor_status"] | null
          status_reason: string | null
          trade_labels: string[] | null
          updated_at: string | null
          verified_at: string | null
          vetting_done_count: number | null
          website: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contractors_relationship_owner_id_fkey"
            columns: ["relationship_owner_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_expiry_watch: {
        Row: {
          business_name: string | null
          contractor_id: string | null
          contractor_status: Database["hq"]["Enums"]["contractor_status"] | null
          days_remaining: number | null
          document_id: string | null
          document_type:
            | Database["hq"]["Enums"]["contractor_document_type"]
            | null
          expires_on: string | null
          file_name: string | null
          item_key: string | null
          kind: string | null
          relationship_owner_id: string | null
          relationship_owner_name: string | null
          state: string | null
          verified: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "contractors_relationship_owner_id_fkey"
            columns: ["relationship_owner_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_timeline: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          business_name: string | null
          contractor_id: string | null
          detail: string | null
          document_type:
            | Database["hq"]["Enums"]["contractor_document_type"]
            | null
          entity_id: string | null
          event_key: string | null
          from_status: Database["hq"]["Enums"]["contractor_status"] | null
          interaction_type: Database["hq"]["Enums"]["interaction_type"] | null
          kind: string | null
          occurred_at: string | null
          step: Database["hq"]["Enums"]["vetting_step"] | null
          step_status: Database["hq"]["Enums"]["vetting_step_status"] | null
          summary: string | null
          to_status: Database["hq"]["Enums"]["contractor_status"] | null
        }
        Relationships: []
      }
      decision_overview: {
        Row: {
          category: Database["hq"]["Enums"]["decision_category"] | null
          created_at: string | null
          created_by: string | null
          decision_date: string | null
          decision_maker_id: string | null
          decision_maker_name: string | null
          deleted_at: string | null
          description: string | null
          id: string | null
          linked_task_count: number | null
          open_linked_task_count: number | null
          rationale: string | null
          ref: string | null
          ref_number: number | null
          reversed_note: string | null
          status: Database["hq"]["Enums"]["decision_status"] | null
          superseded_by_id: string | null
          superseded_by_ref: string | null
          superseded_by_title: string | null
          title: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "decisions_decision_maker_id_fkey"
            columns: ["decision_maker_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_superseded_by_id_fkey"
            columns: ["superseded_by_id"]
            isOneToOne: false
            referencedRelation: "decision_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_superseded_by_id_fkey"
            columns: ["superseded_by_id"]
            isOneToOne: false
            referencedRelation: "decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      enquiry_overview: {
        Row: {
          auto_reply_at: string | null
          auto_reply_interaction_id: string | null
          auto_reply_reason: string | null
          auto_reply_status:
            | Database["hq"]["Enums"]["enquiry_auto_reply_status"]
            | null
          contact_id: string | null
          contact_kind: Database["hq"]["Enums"]["contact_kind"] | null
          contact_name: string | null
          created_contact: boolean | null
          created_lead: boolean | null
          details: Json | null
          email: string | null
          handled_at: string | null
          handled_by: string | null
          handled_by_name: string | null
          id: string | null
          interaction_id: string | null
          kind: Database["hq"]["Enums"]["enquiry_kind"] | null
          lead_live: boolean | null
          lead_ref: string | null
          lead_stage: Database["hq"]["Enums"]["opportunity_stage"] | null
          message: string | null
          name: string | null
          opportunity_id: string | null
          owner_id: string | null
          owner_name: string | null
          phone: string | null
          received_at: string | null
          ref: string | null
          ref_number: number | null
          source_page: string | null
          spam_marked_at: string | null
          spam_marked_by: string | null
          status: Database["hq"]["Enums"]["enquiry_status"] | null
          status_note: string | null
          suburb: string | null
          task_id: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enquiries_auto_reply_interaction_id_fkey"
            columns: ["auto_reply_interaction_id"]
            isOneToOne: false
            referencedRelation: "interactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["primary_contact_id"]
          },
          {
            foreignKeyName: "enquiries_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "overdue_followups"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "enquiries_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_interaction_id_fkey"
            columns: ["interaction_id"]
            isOneToOne: false
            referencedRelation: "interactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "overdue_opportunities"
            referencedColumns: ["opportunity_id"]
          },
          {
            foreignKeyName: "enquiries_spam_marked_by_fkey"
            columns: ["spam_marked_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "open_meeting_actions"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "enquiries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_assigned_to_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_overview: {
        Row: {
          approved_at: string | null
          approved_by_name: string | null
          approved_version: number | null
          body: string | null
          category: Database["hq"]["Enums"]["knowledge_category"] | null
          created_at: string | null
          created_by: string | null
          current_version: number | null
          deleted_at: string | null
          has_pending_draft: boolean | null
          id: string | null
          is_template: boolean | null
          owner_id: string | null
          owner_name: string | null
          reading_is_draft: boolean | null
          reading_version: number | null
          ref: string | null
          ref_number: number | null
          review_due: string | null
          review_overdue: boolean | null
          review_state: string | null
          status: Database["hq"]["Enums"]["knowledge_status"] | null
          status_label: string | null
          summary: string | null
          title: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_documents_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_overview: {
        Row: {
          action_count: number | null
          attendee_count: number | null
          attendee_names: string | null
          confidential: boolean | null
          created_at: string | null
          created_by: string | null
          created_by_name: string | null
          created_via: string | null
          decisions_text: string | null
          deleted_at: string | null
          done_action_count: number | null
          duration_minutes: number | null
          held_at: string | null
          id: string | null
          linked_names: string | null
          location: string | null
          meeting_type: Database["hq"]["Enums"]["meeting_type"] | null
          minutes: string | null
          open_action_count: number | null
          ref: string | null
          ref_number: number | null
          staff_attendee_ids: string[] | null
          summary: string | null
          title: string | null
          updated_at: string | null
          version: number | null
        }
        Relationships: []
      }
      open_meeting_actions: {
        Row: {
          assigned_to: string | null
          assignee_name: string | null
          created_at: string | null
          due_date: string | null
          meeting_confidential: boolean | null
          meeting_held_at: string | null
          meeting_id: string | null
          meeting_ref: string | null
          meeting_title: string | null
          priority: Database["hq"]["Enums"]["task_priority"] | null
          status: Database["hq"]["Enums"]["task_status"] | null
          task_id: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_overview: {
        Row: {
          assigned_to: string | null
          assigned_to_name: string | null
          created_at: string | null
          created_by: string | null
          credited_ref_label: string | null
          credited_referral_id: string | null
          days_in_stage: number | null
          display_number: number | null
          estimated_annual_value_cents: number | null
          expected_close_date: string | null
          id: string | null
          is_open: boolean | null
          last_activity_at: string | null
          lost_reason: string | null
          lost_reason_code: Database["hq"]["Enums"]["lost_reason"] | null
          management_reference: string | null
          needs_attention: boolean | null
          next_action: string | null
          next_action_due: string | null
          next_action_overdue: boolean | null
          notes: string | null
          other_claims: number | null
          owner_contact_id: string | null
          owner_contact_name: string | null
          partner_contact_id: string | null
          partner_contact_name: string | null
          partner_organisation_id: string | null
          partner_organisation_name: string | null
          property_address: string | null
          property_suburb: string | null
          prospect_email: string | null
          prospect_name: string | null
          prospect_phone: string | null
          ref: string | null
          signed_at: string | null
          source: Database["hq"]["Enums"]["lead_source"] | null
          stage: Database["hq"]["Enums"]["opportunity_stage"] | null
          stage_changed_at: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_contact_id_fkey"
            columns: ["owner_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_contact_id_fkey"
            columns: ["owner_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_contact_id_fkey"
            columns: ["owner_contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["primary_contact_id"]
          },
          {
            foreignKeyName: "opportunities_owner_contact_id_fkey"
            columns: ["owner_contact_id"]
            isOneToOne: false
            referencedRelation: "overdue_followups"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "referrals_referring_contact_id_fkey"
            columns: ["partner_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referring_contact_id_fkey"
            columns: ["partner_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referring_contact_id_fkey"
            columns: ["partner_contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["primary_contact_id"]
          },
          {
            foreignKeyName: "referrals_referring_contact_id_fkey"
            columns: ["partner_contact_id"]
            isOneToOne: false
            referencedRelation: "overdue_followups"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "referrals_referring_organisation_id_fkey"
            columns: ["partner_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referring_organisation_id_fkey"
            columns: ["partner_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referring_organisation_id_fkey"
            columns: ["partner_organisation_id"]
            isOneToOne: false
            referencedRelation: "partner_performance"
            referencedColumns: ["organisation_id"]
          },
        ]
      }
      organisation_directory: {
        Row: {
          categories: Database["hq"]["Enums"]["partner_category"][] | null
          contact_count: number | null
          created_at: string | null
          email: string | null
          id: string | null
          last_contact_at: string | null
          location: string | null
          name: string | null
          needs_verification: boolean | null
          next_follow_up_date: string | null
          notes: string | null
          phone: string | null
          primary_contact_id: string | null
          primary_contact_name: string | null
          relationship_owner_id: string | null
          relationship_owner_name: string | null
          service_region: string | null
          source: string | null
          updated_at: string | null
          verified_at: string | null
          website: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organisations_relationship_owner_id_fkey"
            columns: ["relationship_owner_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      overdue_followups: {
        Row: {
          contact_id: string | null
          days_overdue: number | null
          full_name: string | null
          last_contact_at: string | null
          next_follow_up_date: string | null
          organisation_id: string | null
          organisation_name: string | null
          priority: Database["hq"]["Enums"]["priority_level"] | null
          relationship_owner_id: string | null
          relationship_owner_name: string | null
          relationship_status:
            | Database["hq"]["Enums"]["relationship_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "partner_performance"
            referencedColumns: ["organisation_id"]
          },
          {
            foreignKeyName: "contacts_relationship_owner_id_fkey"
            columns: ["relationship_owner_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      overdue_opportunities: {
        Row: {
          assigned_to: string | null
          assigned_to_name: string | null
          days_overdue: number | null
          display_number: number | null
          last_activity_at: string | null
          missing_next_action: boolean | null
          missing_owner: boolean | null
          next_action: string | null
          next_action_due: string | null
          opportunity_id: string | null
          overdue: boolean | null
          owner_inactive: boolean | null
          property_suburb: string | null
          prospect_name: string | null
          reason: string | null
          ref: string | null
          source: Database["hq"]["Enums"]["lead_source"] | null
          stage: Database["hq"]["Enums"]["opportunity_stage"] | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_performance: {
        Row: {
          categories: Database["hq"]["Enums"]["partner_category"][] | null
          conversion: number | null
          estimated_value_signed_cents: number | null
          organisation_id: string | null
          organisation_name: string | null
          qualified: number | null
          received: number | null
          reciprocal: boolean | null
          sent: number | null
          signed: number | null
        }
        Relationships: []
      }
      portfolio_overview: {
        Row: {
          agreement_signed_on: string | null
          ailo_reference: string | null
          ailo_status: Database["hq"]["Enums"]["ailo_status"] | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          ended_on: string | null
          fee_basis: Database["hq"]["Enums"]["fee_basis"] | null
          fee_notes: string | null
          fee_percent: number | null
          handover_done: number | null
          handover_open_steps: string[] | null
          handover_total: number | null
          id: string | null
          managed_from: string | null
          manual_origin_note: string | null
          notes: string | null
          opportunity_id: string | null
          opportunity_number: number | null
          opportunity_prospect_name: string | null
          opportunity_signed_at: string | null
          owner_contact_id: string | null
          owner_display_name: string | null
          owner_email: string | null
          owner_name: string | null
          owner_phone: string | null
          property_address: string | null
          ref: string | null
          ref_number: number | null
          service_type: Database["hq"]["Enums"]["service_type"] | null
          status: Database["hq"]["Enums"]["managed_status"] | null
          suburb: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "managed_properties_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: true
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_properties_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: true
            referencedRelation: "opportunity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_properties_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: true
            referencedRelation: "overdue_opportunities"
            referencedColumns: ["opportunity_id"]
          },
          {
            foreignKeyName: "managed_properties_owner_contact_id_fkey"
            columns: ["owner_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_properties_owner_contact_id_fkey"
            columns: ["owner_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_properties_owner_contact_id_fkey"
            columns: ["owner_contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["primary_contact_id"]
          },
          {
            foreignKeyName: "managed_properties_owner_contact_id_fkey"
            columns: ["owner_contact_id"]
            isOneToOne: false
            referencedRelation: "overdue_followups"
            referencedColumns: ["contact_id"]
          },
        ]
      }
      project_overview: {
        Row: {
          blocked_count: number | null
          cancelled_count: number | null
          completed_at: string | null
          completed_count: number | null
          created_at: string | null
          created_by: string | null
          days_to_target: number | null
          deleted_at: string | null
          description: string | null
          health: string | null
          health_reasons: string[] | null
          id: string | null
          in_progress_count: number | null
          max_overdue_days: number | null
          milestone_count: number | null
          milestones_done: number | null
          name: string | null
          next_milestone_due: string | null
          next_milestone_id: string | null
          next_milestone_name: string | null
          notes: string | null
          open_count: number | null
          overdue_count: number | null
          overdue_milestone_count: number | null
          owner_id: string | null
          owner_name: string | null
          priority: Database["hq"]["Enums"]["task_priority"] | null
          progress_done: number | null
          progress_pct: number | null
          progress_total: number | null
          ref: string | null
          ref_number: number | null
          start_date: string | null
          status: Database["hq"]["Enums"]["project_status"] | null
          target_date: string | null
          task_count: number | null
          to_do_count: number | null
          updated_at: string | null
          version: number | null
          waiting_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_timeline: {
        Row: {
          assigned_to: string | null
          assignee_name: string | null
          depends_on: string[] | null
          end_date: string | null
          is_blocked: boolean | null
          is_done: boolean | null
          is_overdue: boolean | null
          item_id: string | null
          kind: string | null
          milestone_id: string | null
          milestone_name: string | null
          parent_task_id: string | null
          project_id: string | null
          sort_order: number | null
          start_date: string | null
          status: string | null
          title: string | null
        }
        Relationships: []
      }
      referral_overview: {
        Row: {
          assigned_to: string | null
          assigned_to_name: string | null
          created_at: string | null
          direction: Database["hq"]["Enums"]["referral_direction"] | null
          estimated_annual_value_cents: number | null
          id: string | null
          is_attributed: boolean | null
          notes: string | null
          opportunity_assigned_to: string | null
          opportunity_id: string | null
          opportunity_number: number | null
          partner_contact_id: string | null
          partner_contact_name: string | null
          partner_organisation_id: string | null
          partner_organisation_name: string | null
          property_address: string | null
          property_suburb: string | null
          prospect_email: string | null
          prospect_name: string | null
          prospect_phone: string | null
          receiving_contact_id: string | null
          receiving_organisation_id: string | null
          ref_label: string | null
          ref_number: number | null
          referral_date: string | null
          referring_contact_id: string | null
          referring_organisation_id: string | null
          sent_outcome: Database["hq"]["Enums"]["sent_referral_outcome"] | null
          signed_at: string | null
          stage: Database["hq"]["Enums"]["opportunity_stage"] | null
          stage_changed_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_assigned_to_fkey"
            columns: ["opportunity_assigned_to"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "overdue_opportunities"
            referencedColumns: ["opportunity_id"]
          },
          {
            foreignKeyName: "referrals_receiving_contact_id_fkey"
            columns: ["receiving_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_receiving_contact_id_fkey"
            columns: ["receiving_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_receiving_contact_id_fkey"
            columns: ["receiving_contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["primary_contact_id"]
          },
          {
            foreignKeyName: "referrals_receiving_contact_id_fkey"
            columns: ["receiving_contact_id"]
            isOneToOne: false
            referencedRelation: "overdue_followups"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "referrals_receiving_organisation_id_fkey"
            columns: ["receiving_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_receiving_organisation_id_fkey"
            columns: ["receiving_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_receiving_organisation_id_fkey"
            columns: ["receiving_organisation_id"]
            isOneToOne: false
            referencedRelation: "partner_performance"
            referencedColumns: ["organisation_id"]
          },
          {
            foreignKeyName: "referrals_referring_contact_id_fkey"
            columns: ["referring_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referring_contact_id_fkey"
            columns: ["referring_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referring_contact_id_fkey"
            columns: ["referring_contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["primary_contact_id"]
          },
          {
            foreignKeyName: "referrals_referring_contact_id_fkey"
            columns: ["referring_contact_id"]
            isOneToOne: false
            referencedRelation: "overdue_followups"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "referrals_referring_organisation_id_fkey"
            columns: ["referring_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referring_organisation_id_fkey"
            columns: ["referring_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referring_organisation_id_fkey"
            columns: ["referring_organisation_id"]
            isOneToOne: false
            referencedRelation: "partner_performance"
            referencedColumns: ["organisation_id"]
          },
        ]
      }
      referral_partner_overview: {
        Row: {
          categories: Database["hq"]["Enums"]["partner_category"][] | null
          contact_count: number | null
          contact_id: string | null
          conversion: number | null
          days_since_contact: number | null
          estimated_value_signed_cents: number | null
          follow_up_overdue: boolean | null
          id: string | null
          last_contacted_at: string | null
          last_referral_date: string | null
          managements_signed: number | null
          name: string | null
          needs_verification: boolean | null
          next_follow_up_date: string | null
          organisation_id: string | null
          partner_kind: string | null
          primary_contact_email: string | null
          primary_contact_id: string | null
          primary_contact_name: string | null
          primary_contact_phone: string | null
          reciprocal: boolean | null
          referrals_qualified: number | null
          referrals_received: number | null
          referrals_sent: number | null
          relationship_owner_id: string | null
          relationship_owner_name: string | null
          relationship_status:
            | Database["hq"]["Enums"]["relationship_status"]
            | null
        }
        Relationships: []
      }
      task_overview: {
        Row: {
          assigned_to: string | null
          assignee_name: string | null
          blocked_reason: string | null
          blocking_count: number | null
          checklist_done: number | null
          checklist_total: number | null
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          created_by: string | null
          created_by_name: string | null
          deleted_at: string | null
          dependency_count: number | null
          description: string | null
          due_date: string | null
          id: string | null
          is_blocked: boolean | null
          is_overdue: boolean | null
          milestone_due_date: string | null
          milestone_id: string | null
          milestone_name: string | null
          open_dependency_count: number | null
          open_subtask_count: number | null
          overdue_days: number | null
          parent_task_id: string | null
          parent_title: string | null
          priority: Database["hq"]["Enums"]["task_priority"] | null
          project_id: string | null
          project_name: string | null
          project_priority: Database["hq"]["Enums"]["task_priority"] | null
          project_ref: string | null
          project_status: Database["hq"]["Enums"]["project_status"] | null
          related_contact_id: string | null
          related_contractor_id: string | null
          related_opportunity_id: string | null
          related_organisation_id: string | null
          related_referral_id: string | null
          sort_order: number | null
          source: string | null
          status: Database["hq"]["Enums"]["task_status"] | null
          subtask_count: number | null
          title: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "project_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "project_overview"
            referencedColumns: ["next_milestone_id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "open_meeting_actions"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_contact_id_fkey"
            columns: ["related_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_contact_id_fkey"
            columns: ["related_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_contact_id_fkey"
            columns: ["related_contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["primary_contact_id"]
          },
          {
            foreignKeyName: "tasks_related_contact_id_fkey"
            columns: ["related_contact_id"]
            isOneToOne: false
            referencedRelation: "overdue_followups"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "tasks_related_contractor_id_fkey"
            columns: ["related_contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_contractor_id_fkey"
            columns: ["related_contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "overdue_opportunities"
            referencedColumns: ["opportunity_id"]
          },
          {
            foreignKeyName: "tasks_related_organisation_id_fkey"
            columns: ["related_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisation_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_organisation_id_fkey"
            columns: ["related_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_organisation_id_fkey"
            columns: ["related_organisation_id"]
            isOneToOne: false
            referencedRelation: "partner_performance"
            referencedColumns: ["organisation_id"]
          },
          {
            foreignKeyName: "tasks_related_referral_id_fkey"
            columns: ["related_referral_id"]
            isOneToOne: false
            referencedRelation: "opportunity_overview"
            referencedColumns: ["credited_referral_id"]
          },
          {
            foreignKeyName: "tasks_related_referral_id_fkey"
            columns: ["related_referral_id"]
            isOneToOne: false
            referencedRelation: "referral_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_referral_id_fkey"
            columns: ["related_referral_id"]
            isOneToOne: false
            referencedRelation: "referrals"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      add_contractor_document: {
        Args: {
          p_contractor: string
          p_document_type: Database["hq"]["Enums"]["contractor_document_type"]
          p_expires_on?: string
          p_file_name: string
          p_mime_type: string
          p_notes?: string
          p_size_bytes: number
          p_storage_path: string
        }
        Returns: Json
      }
      add_existing_managed_property: {
        Args: {
          p_agreement_signed_on?: string
          p_ailo_reference?: string
          p_ailo_status?: Database["hq"]["Enums"]["ailo_status"]
          p_fee_basis?: Database["hq"]["Enums"]["fee_basis"]
          p_fee_notes?: string
          p_fee_percent?: number
          p_managed_from?: string
          p_manual_origin_note: string
          p_notes?: string
          p_owner_contact_id?: string
          p_owner_name?: string
          p_property_address: string
          p_service_type: Database["hq"]["Enums"]["service_type"]
          p_status?: Database["hq"]["Enums"]["managed_status"]
          p_suburb?: string
        }
        Returns: Json
      }
      add_meeting_action: {
        Args: {
          p_assignee?: string
          p_description?: string
          p_due_date?: string
          p_meeting: string
          p_priority?: Database["hq"]["Enums"]["task_priority"]
          p_title: string
        }
        Returns: Json
      }
      add_meeting_attendee: {
        Args: {
          p_contact?: string
          p_meeting: string
          p_name?: string
          p_staff?: string
        }
        Returns: Json
      }
      add_project_document: {
        Args: { p_project: string; p_title: string; p_url: string }
        Returns: Json
      }
      add_project_link: {
        Args: { p_id: string; p_kind: string; p_project: string }
        Returns: Json
      }
      add_staff: {
        Args: {
          p_email: string
          p_first_name?: string
          p_full_name: string
          p_pod?: string
          p_responsibilities?: string
          p_role: Database["hq"]["Enums"]["staff_role"]
          p_start_date?: string
          p_timezone?: string
          p_user_id: string
        }
        Returns: Json
      }
      add_task_comment: {
        Args: { p_body: string; p_task: string }
        Returns: Json
      }
      add_task_dependency: {
        Args: { p_depends_on: string; p_task: string }
        Returns: Json
      }
      ai_begin_request: { Args: { p_question: string }; Returns: string }
      ai_finish_request: {
        Args: {
          p_id: string
          p_input_tokens: number
          p_output_tokens: number
          p_status: string
          p_tools: string[]
        }
        Returns: undefined
      }
      ai_status: { Args: never; Returns: Json }
      apply_contractor_import: {
        Args: { p_file_name?: string; p_rows: Json; p_source: string }
        Returns: Json
      }
      apply_partner_import: {
        Args: { p_file_name?: string; p_rows: Json; p_source: string }
        Returns: Json
      }
      approve_contractor: {
        Args: {
          p_contractor: string
          p_make_preferred?: boolean
          p_note?: string
        }
        Returns: Json
      }
      approve_email_draft: { Args: { p_id: string }; Returns: Json }
      approve_knowledge_version: {
        Args: { p_document: string; p_version: number }
        Returns: Json
      }
      archive_brand_resource: {
        Args: { p_id: string; p_reason?: string }
        Returns: Json
      }
      archive_record: {
        Args: { p_entity: string; p_id: string; p_reason?: string }
        Returns: Json
      }
      begin_email_send: { Args: { p_id: string; p_via: string }; Returns: Json }
      begin_enquiry_auto_reply: {
        Args: { p_enquiry_id: string }
        Returns: Json
      }
      bootstrap_first_director: {
        Args: {
          p_email: string
          p_first_name: string
          p_full_name: string
          p_user_id: string
        }
        Returns: Json
      }
      bulk_budget: { Args: never; Returns: Json }
      bulk_create_tasks: {
        Args: {
          p_atomic?: boolean
          p_idempotency_key: string
          p_project?: string
          p_tasks: Json
        }
        Returns: Json
      }
      bulk_update_tasks: {
        Args: { p_atomic?: boolean; p_idempotency_key: string; p_updates: Json }
        Returns: Json
      }
      business_summary: { Args: never; Returns: Json }
      can: { Args: { p_capability: string }; Returns: boolean }
      complete_milestone: {
        Args: { p_force?: boolean; p_id: string; p_note?: string }
        Returns: Json
      }
      complete_task: { Args: { p_id: string; p_note?: string }; Returns: Json }
      consume_bulk_budget: {
        Args: { p_calls: number; p_items: number }
        Returns: Json
      }
      contractor_summary: { Args: never; Returns: Json }
      convert_to_managed_property: {
        Args: {
          p_agreement_signed_on?: string
          p_ailo_reference?: string
          p_fee_basis?: Database["hq"]["Enums"]["fee_basis"]
          p_fee_notes?: string
          p_fee_percent?: number
          p_managed_from?: string
          p_notes?: string
          p_opportunity_id: string
          p_owner_contact_id?: string
          p_owner_name?: string
          p_property_address?: string
          p_service_type: Database["hq"]["Enums"]["service_type"]
          p_status?: Database["hq"]["Enums"]["managed_status"]
          p_suburb?: string
        }
        Returns: Json
      }
      create_decision: {
        Args: {
          p_category: Database["hq"]["Enums"]["decision_category"]
          p_decision_date?: string
          p_decision_maker?: string
          p_description?: string
          p_note?: string
          p_rationale?: string
          p_status?: Database["hq"]["Enums"]["decision_status"]
          p_title: string
        }
        Returns: Json
      }
      create_email_draft: {
        Args: {
          p_body: string
          p_contact?: string
          p_opportunity?: string
          p_staff?: string
          p_subject: string
          p_template: Database["hq"]["Enums"]["email_template"]
          p_to_email?: string
          p_to_name?: string
        }
        Returns: Json
      }
      create_expiry_tasks: { Args: never; Returns: Json }
      create_knowledge_document: {
        Args: {
          p_body: string
          p_category: Database["hq"]["Enums"]["knowledge_category"]
          p_change_note?: string
          p_owner?: string
          p_review_due?: string
          p_summary?: string
          p_title: string
        }
        Returns: Json
      }
      create_meeting: {
        Args: {
          p_actions?: Json
          p_attendees?: Json
          p_change_note?: string
          p_confidential?: boolean
          p_decisions_text?: string
          p_duration_minutes?: number
          p_held_at: string
          p_links?: Json
          p_location?: string
          p_minutes?: string
          p_summary?: string
          p_title: string
          p_type: Database["hq"]["Enums"]["meeting_type"]
        }
        Returns: Json
      }
      create_milestone: {
        Args: {
          p_description?: string
          p_due?: string
          p_name: string
          p_project: string
          p_sort_order?: number
        }
        Returns: Json
      }
      create_opportunity: {
        Args: {
          p_assigned_to?: string
          p_confirm_distinct?: boolean
          p_create_contact?: boolean
          p_estimated_annual_value_cents?: number
          p_expected_close_date?: string
          p_next_action?: string
          p_next_action_due?: string
          p_notes?: string
          p_property_address?: string
          p_property_suburb?: string
          p_prospect_email?: string
          p_prospect_name: string
          p_prospect_phone?: string
          p_source?: Database["hq"]["Enums"]["lead_source"]
        }
        Returns: Json
      }
      create_project: {
        Args: {
          p_description?: string
          p_name: string
          p_notes?: string
          p_owner?: string
          p_priority?: Database["hq"]["Enums"]["task_priority"]
          p_start?: string
          p_status?: Database["hq"]["Enums"]["project_status"]
          p_target?: string
        }
        Returns: Json
      }
      create_project_task: {
        Args: {
          p_assignee?: string
          p_blocked_reason?: string
          p_checklist?: string[]
          p_depends_on?: string[]
          p_description?: string
          p_due_date?: string
          p_milestone?: string
          p_parent?: string
          p_priority?: Database["hq"]["Enums"]["task_priority"]
          p_project?: string
          p_sort_order?: number
          p_status?: Database["hq"]["Enums"]["task_status"]
          p_title: string
        }
        Returns: Json
      }
      create_trade: {
        Args: { p_description?: string; p_label: string }
        Returns: Json
      }
      deactivate_staff: {
        Args: { p_reason?: string; p_staff_id: string }
        Returns: Json
      }
      discard_email_draft: {
        Args: { p_id: string; p_reason?: string }
        Returns: Json
      }
      discard_knowledge_draft: {
        Args: { p_document: string; p_reason?: string; p_version: number }
        Returns: Json
      }
      edit_knowledge_document: {
        Args: {
          p_base_version: number
          p_body?: string
          p_change_note: string
          p_document: string
          p_summary?: string
          p_title?: string
        }
        Returns: Json
      }
      edit_task_comment: {
        Args: { p_body: string; p_comment: number }
        Returns: Json
      }
      finish_email_send: {
        Args: {
          p_error?: string
          p_id: string
          p_message_id?: string
          p_ok: boolean
        }
        Returns: Json
      }
      finish_enquiry_auto_reply: {
        Args: {
          p_enquiry_id: string
          p_error?: string
          p_message_id?: string
          p_ok: boolean
        }
        Returns: Json
      }
      global_search: {
        Args: { p_limit?: number; p_query: string }
        Returns: Json
      }
      growth_summary: { Args: { p_since?: string }; Returns: Json }
      import_brand_resource: {
        Args: {
          p_actor: string
          p_category: Database["hq"]["Enums"]["brand_resource_category"]
          p_change_note?: string
          p_content_sha256: string
          p_description: string
          p_file_name: string
          p_mime_type: string
          p_note?: string
          p_resource: string
          p_size_bytes: number
          p_sort_order?: number
          p_storage_path: string
          p_tags?: string[]
          p_title: string
        }
        Returns: Json
      }
      link_decision_task: {
        Args: { p_decision: string; p_task: string }
        Returns: Json
      }
      link_meeting: {
        Args: { p_id: string; p_kind: string; p_meeting: string }
        Returns: Json
      }
      log_opportunity_activity: {
        Args: {
          p_create_task?: boolean
          p_next_action?: string
          p_next_action_due?: string
          p_occurred_at?: string
          p_opportunity: string
          p_summary?: string
          p_task_assignee?: string
          p_type?: Database["hq"]["Enums"]["interaction_type"]
        }
        Returns: Json
      }
      mark_contractor_used: {
        Args: {
          p_allow_earlier?: boolean
          p_contractor: string
          p_job_date?: string
        }
        Returns: Json
      }
      mark_enquiry_spam: {
        Args: { p_id: string; p_note?: string }
        Returns: Json
      }
      move_opportunity: {
        Args: {
          p_lost_reason?: string
          p_lost_reason_code?: Database["hq"]["Enums"]["lost_reason"]
          p_management_reference?: string
          p_note?: string
          p_opportunity: string
          p_signed_at?: string
          p_stage: Database["hq"]["Enums"]["opportunity_stage"]
        }
        Returns: Json
      }
      move_trade: {
        Args: { p_direction: string; p_trade: string }
        Returns: Json
      }
      my_access: { Args: never; Returns: Json }
      my_focus: {
        Args: { p_limit?: number }
        Returns: {
          due_date: string
          milestone_name: string
          overdue_days: number
          priority: Database["hq"]["Enums"]["task_priority"]
          project_id: string
          project_name: string
          project_ref: string
          rank: number
          status: Database["hq"]["Enums"]["task_status"]
          task_id: string
          title: string
          unblocks: number
          why: string
        }[]
      }
      overdue_tasks: {
        Args: { p_project?: string; p_scope?: string }
        Returns: {
          assigned_to: string
          assignee_name: string
          due_date: string
          is_blocked: boolean
          overdue_days: number
          priority: Database["hq"]["Enums"]["task_priority"]
          project_id: string
          project_name: string
          project_ref: string
          status: Database["hq"]["Enums"]["task_status"]
          task_id: string
          title: string
        }[]
      }
      preview_contractor_approval: {
        Args: { p_contractor: string }
        Returns: Json
      }
      preview_contractor_import: { Args: { p_rows: Json }; Returns: Json }
      preview_partner_import: { Args: { p_rows: Json }; Returns: Json }
      promote_decision_to_register: {
        Args: {
          p_category: Database["hq"]["Enums"]["decision_category"]
          p_decision_date?: string
          p_description?: string
          p_meeting: string
          p_rationale?: string
          p_status?: Database["hq"]["Enums"]["decision_status"]
          p_title: string
        }
        Returns: Json
      }
      record_contractor_contact: {
        Args: {
          p_contractor: string
          p_create_task?: boolean
          p_follow_up_date?: string
          p_new_status?: Database["hq"]["Enums"]["contractor_status"]
          p_next_action?: string
          p_occurred_at?: string
          p_summary?: string
          p_task_assignee?: string
          p_type?: Database["hq"]["Enums"]["interaction_type"]
        }
        Returns: Json
      }
      record_contractor_review: {
        Args: {
          p_communication?: number
          p_contractor: string
          p_invoice_accuracy?: number
          p_job_date?: string
          p_job_reference?: string
          p_notes?: string
          p_response_time?: number
          p_rework_required?: boolean
          p_tenant_feedback?: Database["hq"]["Enums"]["tenant_feedback"]
          p_work_quality?: number
        }
        Returns: Json
      }
      record_interaction: {
        Args: {
          p_contact?: string
          p_create_task?: boolean
          p_follow_up_date?: string
          p_new_status?: Database["hq"]["Enums"]["relationship_status"]
          p_next_action?: string
          p_occurred_at?: string
          p_organisation?: string
          p_summary?: string
          p_task_assignee?: string
          p_type?: Database["hq"]["Enums"]["interaction_type"]
        }
        Returns: Json
      }
      record_referral: {
        Args: {
          p_assigned_to?: string
          p_direction: Database["hq"]["Enums"]["referral_direction"]
          p_estimated_value_cents?: number
          p_existing_opportunity?: string
          p_notes?: string
          p_property_address?: string
          p_property_suburb?: string
          p_prospect_email?: string
          p_prospect_name?: string
          p_prospect_phone?: string
          p_receiving_contact?: string
          p_receiving_organisation?: string
          p_referral_date?: string
          p_referring_contact?: string
          p_referring_organisation?: string
        }
        Returns: Json
      }
      register_brand_resource: {
        Args: {
          p_category: Database["hq"]["Enums"]["brand_resource_category"]
          p_content_sha256: string
          p_description: string
          p_file_name: string
          p_mime_type: string
          p_note?: string
          p_size_bytes: number
          p_sort_order?: number
          p_storage_path: string
          p_tags?: string[]
          p_title: string
        }
        Returns: Json
      }
      reinstate_contractor: {
        Args: { p_contractor: string; p_note?: string }
        Returns: Json
      }
      remove_meeting_attendee: {
        Args: { p_attendee: number; p_meeting: string }
        Returns: Json
      }
      remove_project_document: {
        Args: { p_document: number; p_project: string }
        Returns: Json
      }
      remove_project_link: {
        Args: { p_id: string; p_kind: string; p_project: string }
        Returns: Json
      }
      remove_task_dependency: {
        Args: { p_depends_on: string; p_task: string }
        Returns: Json
      }
      reopen_milestone: { Args: { p_id: string }; Returns: Json }
      reorder_milestones: {
        Args: { p_ids: string[]; p_project: string }
        Returns: Json
      }
      replace_brand_resource_file: {
        Args: {
          p_change_note?: string
          p_content_sha256: string
          p_file_name: string
          p_id: string
          p_mime_type: string
          p_size_bytes: number
          p_storage_path: string
          p_version_label?: string
        }
        Returns: Json
      }
      restore_brand_resource: { Args: { p_id: string }; Returns: Json }
      restore_knowledge_version: {
        Args: {
          p_base_version: number
          p_change_note?: string
          p_document: string
          p_version: number
        }
        Returns: Json
      }
      restore_record: {
        Args: { p_entity: string; p_id: string }
        Returns: Json
      }
      set_attributed_referral: {
        Args: { p_opportunity: string; p_referral: string }
        Returns: Json
      }
      set_business_goal: {
        Args: { p_date?: string; p_target: number }
        Returns: Json
      }
      set_contractor_status: {
        Args: {
          p_contractor: string
          p_note?: string
          p_status: Database["hq"]["Enums"]["contractor_status"]
        }
        Returns: Json
      }
      set_enquiry_owner: { Args: { p_staff?: string }; Returns: Json }
      set_enquiry_status: {
        Args: {
          p_id: string
          p_note?: string
          p_status: Database["hq"]["Enums"]["enquiry_status"]
        }
        Returns: Json
      }
      set_handover_step: {
        Args: {
          p_note?: string
          p_property_id: string
          p_status: Database["hq"]["Enums"]["handover_step_status"]
          p_step: Database["hq"]["Enums"]["handover_step"]
        }
        Returns: Json
      }
      set_knowledge_review: {
        Args: {
          p_category?: Database["hq"]["Enums"]["knowledge_category"]
          p_change_note?: string
          p_clear_review?: boolean
          p_document: string
          p_owner?: string
          p_review_due?: string
        }
        Returns: Json
      }
      set_project_status: {
        Args: {
          p_id: string
          p_note?: string
          p_status: Database["hq"]["Enums"]["project_status"]
        }
        Returns: Json
      }
      set_task_checklist: {
        Args: { p_items: Json; p_task: string }
        Returns: Json
      }
      set_trade_active: {
        Args: { p_active: boolean; p_reason?: string; p_trade: string }
        Returns: Json
      }
      set_vetting_step: {
        Args: {
          p_contractor: string
          p_note?: string
          p_status: Database["hq"]["Enums"]["vetting_step_status"]
          p_step: Database["hq"]["Enums"]["vetting_step"]
        }
        Returns: Json
      }
      submit_enquiry: {
        Args: {
          p_details?: Json
          p_email: string
          p_ip_hash?: string
          p_kind: Database["hq"]["Enums"]["enquiry_kind"]
          p_message?: string
          p_name: string
          p_phone?: string
          p_source_page?: string
          p_suburb?: string
        }
        Returns: Json
      }
      supersede_decision: {
        Args: { p_decision: string; p_note: string; p_superseded_by: string }
        Returns: Json
      }
      today: { Args: never; Returns: string }
      unlink_decision_task: {
        Args: { p_decision: string; p_task: string }
        Returns: Json
      }
      unlink_meeting: {
        Args: { p_id: string; p_kind: string; p_meeting: string }
        Returns: Json
      }
      update_brand_resource: {
        Args: {
          p_category: Database["hq"]["Enums"]["brand_resource_category"]
          p_description: string
          p_id: string
          p_note: string
          p_sort_order: number
          p_tags: string[]
          p_title: string
        }
        Returns: Json
      }
      update_decision: {
        Args: {
          p_category?: Database["hq"]["Enums"]["decision_category"]
          p_decision: string
          p_decision_date?: string
          p_decision_maker?: string
          p_description?: string
          p_expected_updated_at?: string
          p_note?: string
          p_rationale?: string
          p_status?: Database["hq"]["Enums"]["decision_status"]
          p_superseded_by?: string
          p_title?: string
        }
        Returns: Json
      }
      update_email_draft: {
        Args: {
          p_body?: string
          p_id: string
          p_subject?: string
          p_template?: Database["hq"]["Enums"]["email_template"]
        }
        Returns: Json
      }
      update_managed_property: {
        Args: {
          p_agreement_signed_on?: string
          p_ailo_reference?: string
          p_ailo_status?: Database["hq"]["Enums"]["ailo_status"]
          p_clear?: string[]
          p_ended_on?: string
          p_expected_updated_at?: string
          p_fee_basis?: Database["hq"]["Enums"]["fee_basis"]
          p_fee_notes?: string
          p_fee_percent?: number
          p_id: string
          p_managed_from?: string
          p_note?: string
          p_notes?: string
          p_owner_contact_id?: string
          p_owner_name?: string
          p_property_address?: string
          p_service_type?: Database["hq"]["Enums"]["service_type"]
          p_status?: Database["hq"]["Enums"]["managed_status"]
          p_suburb?: string
        }
        Returns: Json
      }
      update_meeting: {
        Args: {
          p_change_note?: string
          p_clear?: string[]
          p_confidential?: boolean
          p_decisions_text?: string
          p_duration_minutes?: number
          p_expected_version: number
          p_held_at?: string
          p_location?: string
          p_meeting: string
          p_minutes?: string
          p_summary?: string
          p_title?: string
          p_type?: Database["hq"]["Enums"]["meeting_type"]
        }
        Returns: Json
      }
      update_milestone: {
        Args: {
          p_clear?: string[]
          p_description?: string
          p_due?: string
          p_id: string
          p_name?: string
        }
        Returns: Json
      }
      update_opportunity: {
        Args: {
          p_assigned_to?: string
          p_clear?: string[]
          p_estimated_annual_value_cents?: number
          p_expected_close_date?: string
          p_expected_updated_at?: string
          p_next_action?: string
          p_next_action_due?: string
          p_notes?: string
          p_opportunity: string
          p_owner_contact?: string
          p_property_address?: string
          p_property_suburb?: string
          p_prospect_email?: string
          p_prospect_name?: string
          p_prospect_phone?: string
          p_source?: Database["hq"]["Enums"]["lead_source"]
        }
        Returns: Json
      }
      update_project: {
        Args: {
          p_clear?: string[]
          p_description?: string
          p_expected_version?: number
          p_id: string
          p_name?: string
          p_note?: string
          p_notes?: string
          p_owner?: string
          p_priority?: Database["hq"]["Enums"]["task_priority"]
          p_start?: string
          p_status?: Database["hq"]["Enums"]["project_status"]
          p_target?: string
        }
        Returns: Json
      }
      update_project_task: {
        Args: { p_id: string; p_patch: Json }
        Returns: Json
      }
      update_staff: {
        Args: {
          p_clear_pod?: boolean
          p_dashboard_widgets?: string[]
          p_employment_status?: Database["hq"]["Enums"]["employment_status"]
          p_first_name?: string
          p_full_name?: string
          p_is_active?: boolean
          p_pod?: string
          p_reset_widgets?: boolean
          p_responsibilities?: string
          p_role?: Database["hq"]["Enums"]["staff_role"]
          p_staff_id: string
          p_start_date?: string
          p_timezone?: string
        }
        Returns: Json
      }
      update_trade: {
        Args: {
          p_description?: string
          p_label?: string
          p_sort_order?: number
          p_trade: string
        }
        Returns: Json
      }
      verify_contractor_document: {
        Args: {
          p_apply_to_contractor?: boolean
          p_document: string
          p_expires_on?: string
          p_note?: string
          p_verification: Database["hq"]["Enums"]["document_verification"]
        }
        Returns: Json
      }
    }
    Enums: {
      ailo_status: "not_started" | "set_up" | "live"
      brand_resource_category:
        | "guidelines"
        | "logos"
        | "photos"
        | "colours_type"
        | "tokens"
        | "ui_kit"
        | "other"
      contact_kind: "partner" | "landlord" | "other"
      contractor_document_type:
        | "licence"
        | "public_liability_insurance"
        | "workers_compensation"
        | "professional_indemnity"
        | "abn_confirmation"
        | "price_list"
        | "agreement"
        | "other"
      contractor_status:
        | "prospect"
        | "contacted"
        | "vetting"
        | "approved"
        | "preferred"
        | "suspended"
        | "inactive"
      decision_category:
        | "strategy"
        | "finance"
        | "people"
        | "operations"
        | "partners"
        | "marketing"
        | "technology"
        | "legal_compliance"
        | "service_offering"
        | "other"
      decision_status:
        | "proposed"
        | "decided"
        | "in_effect"
        | "superseded"
        | "reversed"
      document_verification: "pending" | "verified" | "rejected"
      email_status:
        | "draft"
        | "approved"
        | "sending"
        | "sent"
        | "failed"
        | "discarded"
      email_template: "thank_you" | "follow_up" | "introduction" | "general"
      employment_status: "active" | "on_leave" | "ended"
      enquiry_auto_reply_status:
        | "none"
        | "sending"
        | "sent"
        | "failed"
        | "skipped"
      enquiry_kind: "appraisal" | "contact"
      enquiry_status: "new" | "in_progress" | "spam" | "archived"
      fee_basis: "percent_of_rent" | "flat_fee" | "other"
      handover_step:
        | "owner_onboarded"
        | "management_agreement_signed"
        | "owner_id_verified"
        | "bank_and_payment_details_in_ailo"
        | "property_created_in_ailo"
        | "owner_invited_to_ailo"
        | "condition_report_or_inspection_scheduled"
        | "keys_and_access_arranged"
        | "welcome_pack_sent"
      handover_step_status:
        | "not_started"
        | "in_progress"
        | "done"
        | "not_applicable"
      interaction_type:
        | "phone_call"
        | "coffee_meeting"
        | "office_meeting"
        | "email"
        | "message"
        | "note"
      knowledge_category:
        | "company_procedure"
        | "contractor_vetting"
        | "referral_partner"
        | "landlord_onboarding"
        | "staff_policy"
        | "operational_checklist"
        | "brand_voice"
        | "general"
      knowledge_status: "draft" | "approved" | "archived"
      knowledge_version_status:
        | "draft"
        | "approved"
        | "superseded"
        | "discarded"
      lead_source:
        | "website_enquiry"
        | "referral_partner"
        | "own_marketing"
        | "direct_approach"
        | "other"
      lost_reason:
        | "price"
        | "chose_another_manager"
        | "self_managing"
        | "not_ready"
        | "unresponsive"
        | "out_of_area"
        | "other"
      managed_status: "onboarding" | "active" | "offboarding" | "ended"
      meeting_type:
        | "partner_referral"
        | "internal_team"
        | "contractor"
        | "landlord_owner"
        | "supplier_other"
        | "planning_strategy"
        | "other"
      milestone_status: "open" | "done"
      opportunity_stage:
        | "introduction_received"
        | "contacted"
        | "qualified"
        | "appraisal_requested"
        | "appraisal_completed"
        | "proposal_sent"
        | "management_signed"
        | "lost"
      org_contact_role: "primary" | "secondary" | "other"
      partner_category:
        | "real_estate_sales"
        | "mortgage_broker"
        | "conveyancer"
        | "lawyer"
        | "accountant"
        | "bank_lending"
        | "buyers_agent"
        | "property_developer"
        | "builder"
        | "financial_adviser"
        | "other"
      priority_level: "high" | "medium" | "low"
      project_status:
        | "planning"
        | "active"
        | "on_hold"
        | "completed"
        | "cancelled"
      referral_direction: "received" | "sent"
      relationship_status:
        | "identified"
        | "contacted"
        | "meeting_booked"
        | "met"
        | "active_relationship"
        | "referring_partner"
        | "inactive"
      sent_referral_outcome:
        | "sent"
        | "acknowledged"
        | "converted"
        | "no_outcome"
      service_type: "long_term_residential" | "short_term_accommodation"
      staff_role:
        | "director"
        | "administrator"
        | "senior_property_manager"
        | "property_manager"
        | "junior_property_manager"
        | "business_development_manager"
        | "virtual_assistant"
        | "read_only"
      task_priority: "low" | "normal" | "high" | "urgent"
      task_status:
        | "to_do"
        | "in_progress"
        | "waiting"
        | "completed"
        | "cancelled"
      tenant_feedback: "positive" | "neutral" | "negative" | "none_received"
      vetting_step:
        | "identity"
        | "abn"
        | "licence"
        | "insurance"
        | "service_areas"
        | "pricing"
        | "emergency_availability"
        | "communication"
        | "review_and_approve"
      vetting_step_status:
        | "not_started"
        | "in_progress"
        | "done"
        | "not_applicable"
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
  hq: {
    Enums: {
      ailo_status: ["not_started", "set_up", "live"],
      brand_resource_category: [
        "guidelines",
        "logos",
        "photos",
        "colours_type",
        "tokens",
        "ui_kit",
        "other",
      ],
      contact_kind: ["partner", "landlord", "other"],
      contractor_document_type: [
        "licence",
        "public_liability_insurance",
        "workers_compensation",
        "professional_indemnity",
        "abn_confirmation",
        "price_list",
        "agreement",
        "other",
      ],
      contractor_status: [
        "prospect",
        "contacted",
        "vetting",
        "approved",
        "preferred",
        "suspended",
        "inactive",
      ],
      decision_category: [
        "strategy",
        "finance",
        "people",
        "operations",
        "partners",
        "marketing",
        "technology",
        "legal_compliance",
        "service_offering",
        "other",
      ],
      decision_status: [
        "proposed",
        "decided",
        "in_effect",
        "superseded",
        "reversed",
      ],
      document_verification: ["pending", "verified", "rejected"],
      email_status: [
        "draft",
        "approved",
        "sending",
        "sent",
        "failed",
        "discarded",
      ],
      email_template: ["thank_you", "follow_up", "introduction", "general"],
      employment_status: ["active", "on_leave", "ended"],
      enquiry_auto_reply_status: [
        "none",
        "sending",
        "sent",
        "failed",
        "skipped",
      ],
      enquiry_kind: ["appraisal", "contact"],
      enquiry_status: ["new", "in_progress", "spam", "archived"],
      fee_basis: ["percent_of_rent", "flat_fee", "other"],
      handover_step: [
        "owner_onboarded",
        "management_agreement_signed",
        "owner_id_verified",
        "bank_and_payment_details_in_ailo",
        "property_created_in_ailo",
        "owner_invited_to_ailo",
        "condition_report_or_inspection_scheduled",
        "keys_and_access_arranged",
        "welcome_pack_sent",
      ],
      handover_step_status: [
        "not_started",
        "in_progress",
        "done",
        "not_applicable",
      ],
      interaction_type: [
        "phone_call",
        "coffee_meeting",
        "office_meeting",
        "email",
        "message",
        "note",
      ],
      knowledge_category: [
        "company_procedure",
        "contractor_vetting",
        "referral_partner",
        "landlord_onboarding",
        "staff_policy",
        "operational_checklist",
        "brand_voice",
        "general",
      ],
      knowledge_status: ["draft", "approved", "archived"],
      knowledge_version_status: [
        "draft",
        "approved",
        "superseded",
        "discarded",
      ],
      lead_source: [
        "website_enquiry",
        "referral_partner",
        "own_marketing",
        "direct_approach",
        "other",
      ],
      lost_reason: [
        "price",
        "chose_another_manager",
        "self_managing",
        "not_ready",
        "unresponsive",
        "out_of_area",
        "other",
      ],
      managed_status: ["onboarding", "active", "offboarding", "ended"],
      meeting_type: [
        "partner_referral",
        "internal_team",
        "contractor",
        "landlord_owner",
        "supplier_other",
        "planning_strategy",
        "other",
      ],
      milestone_status: ["open", "done"],
      opportunity_stage: [
        "introduction_received",
        "contacted",
        "qualified",
        "appraisal_requested",
        "appraisal_completed",
        "proposal_sent",
        "management_signed",
        "lost",
      ],
      org_contact_role: ["primary", "secondary", "other"],
      partner_category: [
        "real_estate_sales",
        "mortgage_broker",
        "conveyancer",
        "lawyer",
        "accountant",
        "bank_lending",
        "buyers_agent",
        "property_developer",
        "builder",
        "financial_adviser",
        "other",
      ],
      priority_level: ["high", "medium", "low"],
      project_status: [
        "planning",
        "active",
        "on_hold",
        "completed",
        "cancelled",
      ],
      referral_direction: ["received", "sent"],
      relationship_status: [
        "identified",
        "contacted",
        "meeting_booked",
        "met",
        "active_relationship",
        "referring_partner",
        "inactive",
      ],
      sent_referral_outcome: [
        "sent",
        "acknowledged",
        "converted",
        "no_outcome",
      ],
      service_type: ["long_term_residential", "short_term_accommodation"],
      staff_role: [
        "director",
        "administrator",
        "senior_property_manager",
        "property_manager",
        "junior_property_manager",
        "business_development_manager",
        "virtual_assistant",
        "read_only",
      ],
      task_priority: ["low", "normal", "high", "urgent"],
      task_status: [
        "to_do",
        "in_progress",
        "waiting",
        "completed",
        "cancelled",
      ],
      tenant_feedback: ["positive", "neutral", "negative", "none_received"],
      vetting_step: [
        "identity",
        "abn",
        "licence",
        "insurance",
        "service_areas",
        "pricing",
        "emergency_availability",
        "communication",
        "review_and_approve",
      ],
      vetting_step_status: [
        "not_started",
        "in_progress",
        "done",
        "not_applicable",
      ],
    },
  },
} as const

