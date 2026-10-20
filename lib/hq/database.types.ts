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
      contacts: {
        Row: {
          categories: Database["hq"]["Enums"]["partner_category"][]
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
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
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
          id: string
          lost_reason: string | null
          management_reference: string | null
          notes: string | null
          property_address: string | null
          property_suburb: string | null
          prospect_email: string | null
          prospect_name: string
          prospect_phone: string | null
          signed_at: string | null
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
          id?: string
          lost_reason?: string | null
          management_reference?: string | null
          notes?: string | null
          property_address?: string | null
          property_suburb?: string | null
          prospect_email?: string | null
          prospect_name: string
          prospect_phone?: string | null
          signed_at?: string | null
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
          id?: string
          lost_reason?: string | null
          management_reference?: string | null
          notes?: string | null
          property_address?: string | null
          property_suburb?: string | null
          prospect_email?: string | null
          prospect_name?: string
          prospect_phone?: string | null
          signed_at?: string | null
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
      tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          due_date: string | null
          id: string
          priority: Database["hq"]["Enums"]["task_priority"]
          related_contact_id: string | null
          related_contractor_id: string | null
          related_opportunity_id: string | null
          related_organisation_id: string | null
          related_referral_id: string | null
          reminder_key: string | null
          source: string
          status: Database["hq"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["hq"]["Enums"]["task_priority"]
          related_contact_id?: string | null
          related_contractor_id?: string | null
          related_opportunity_id?: string | null
          related_organisation_id?: string | null
          related_referral_id?: string | null
          reminder_key?: string | null
          source?: string
          status?: Database["hq"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["hq"]["Enums"]["task_priority"]
          related_contact_id?: string | null
          related_contractor_id?: string | null
          related_opportunity_id?: string | null
          related_organisation_id?: string | null
          related_referral_id?: string | null
          reminder_key?: string | null
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
      contact_directory: {
        Row: {
          categories: Database["hq"]["Enums"]["partner_category"][] | null
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
      archive_record: {
        Args: { p_entity: string; p_id: string; p_reason?: string }
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
      can: { Args: { p_capability: string }; Returns: boolean }
      contractor_summary: { Args: never; Returns: Json }
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
      create_expiry_tasks: { Args: never; Returns: Json }
      create_trade: {
        Args: { p_description?: string; p_label: string }
        Returns: Json
      }
      deactivate_staff: {
        Args: { p_reason?: string; p_staff_id: string }
        Returns: Json
      }
      global_search: {
        Args: { p_limit?: number; p_query: string }
        Returns: Json
      }
      growth_summary: { Args: { p_since?: string }; Returns: Json }
      link_decision_task: {
        Args: { p_decision: string; p_task: string }
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
      move_opportunity: {
        Args: {
          p_lost_reason?: string
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
      preview_contractor_approval: {
        Args: { p_contractor: string }
        Returns: Json
      }
      preview_contractor_import: { Args: { p_rows: Json }; Returns: Json }
      preview_partner_import: { Args: { p_rows: Json }; Returns: Json }
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
      reinstate_contractor: {
        Args: { p_contractor: string; p_note?: string }
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
      set_contractor_status: {
        Args: {
          p_contractor: string
          p_note?: string
          p_status: Database["hq"]["Enums"]["contractor_status"]
        }
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
      supersede_decision: {
        Args: { p_decision: string; p_note: string; p_superseded_by: string }
        Returns: Json
      }
      today: { Args: never; Returns: string }
      unlink_decision_task: {
        Args: { p_decision: string; p_task: string }
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
      employment_status: "active" | "on_leave" | "ended"
      interaction_type:
        | "phone_call"
        | "coffee_meeting"
        | "office_meeting"
        | "email"
        | "message"
        | "note"
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
      employment_status: ["active", "on_leave", "ended"],
      interaction_type: [
        "phone_call",
        "coffee_meeting",
        "office_meeting",
        "email",
        "message",
        "note",
      ],
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

