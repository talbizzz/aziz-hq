export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_owner: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          actor_id: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          at: string
          created_at: string
          data: Json
          entity_id: string | null
          entity_type: string
          id: number
          kind: string
          run_id: string | null
          task_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_type?: Database["public"]["Enums"]["actor_type"]
          at?: string
          created_at?: string
          data?: Json
          entity_id?: string | null
          entity_type: string
          id?: never
          kind: string
          run_id?: string | null
          task_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_type?: Database["public"]["Enums"]["actor_type"]
          at?: string
          created_at?: string
          data?: Json
          entity_id?: string | null
          entity_type?: string
          id?: never
          kind?: string
          run_id?: string | null
          task_id?: string | null
        }
        Relationships: []
      }
      gates: {
        Row: {
          comment: string | null
          context: Json
          created_at: string
          decided_at: string | null
          decided_via: string | null
          decision: Database["public"]["Enums"]["gate_decision"] | null
          kind: string
          options: Json
          priority: number
          task_id: string
          title: string
        }
        Insert: {
          comment?: string | null
          context?: Json
          created_at?: string
          decided_at?: string | null
          decided_via?: string | null
          decision?: Database["public"]["Enums"]["gate_decision"] | null
          kind: string
          options?: Json
          priority?: number
          task_id: string
          title: string
        }
        Update: {
          comment?: string | null
          context?: Json
          created_at?: string
          decided_at?: string | null
          decided_via?: string | null
          decision?: Database["public"]["Enums"]["gate_decision"] | null
          kind?: string
          options?: Json
          priority?: number
          task_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "gates_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      modules: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id: string
          name: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          attempts: number
          created_at: string
          deliver_after: string
          error: string | null
          gate_task_id: string | null
          id: string
          kind: string
          payload: Json
          priority: number
          run_id: string | null
          sent_at: string | null
          status: string
          telegram_message_id: number | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          deliver_after?: string
          error?: string | null
          gate_task_id?: string | null
          id?: string
          kind: string
          payload?: Json
          priority: number
          run_id?: string | null
          sent_at?: string | null
          status?: string
          telegram_message_id?: number | null
        }
        Update: {
          attempts?: number
          created_at?: string
          deliver_after?: string
          error?: string | null
          gate_task_id?: string | null
          id?: string
          kind?: string
          payload?: Json
          priority?: number
          run_id?: string | null
          sent_at?: string | null
          status?: string
          telegram_message_id?: number | null
        }
        Relationships: []
      }
      overrides: {
        Row: {
          cap_pct: number | null
          cleared_at: string | null
          created_at: string
          created_by: string
          expires_at: string
          id: string
          kind: string
        }
        Insert: {
          cap_pct?: number | null
          cleared_at?: string | null
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          kind: string
        }
        Update: {
          cap_pct?: number | null
          cleared_at?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          kind?: string
        }
        Relationships: []
      }
      runs: {
        Row: {
          config: Json
          created_at: string
          finished_at: string | null
          id: string
          module_id: string
          status: Database["public"]["Enums"]["run_status"]
          title: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          finished_at?: string | null
          id?: string
          module_id: string
          status?: Database["public"]["Enums"]["run_status"]
          title: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          finished_at?: string | null
          id?: string
          module_id?: string
          status?: Database["public"]["Enums"]["run_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "runs_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      tasks: {
        Row: {
          attempts: number
          claimed_by: string | null
          created_at: string
          depends_on: string[]
          id: string
          lane: string | null
          lease_until: string | null
          max_attempts: number
          payload: Json
          priority: number
          result: Json | null
          role: string | null
          run_id: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
          type: Database["public"]["Enums"]["task_type"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          claimed_by?: string | null
          created_at?: string
          depends_on?: string[]
          id?: string
          lane?: string | null
          lease_until?: string | null
          max_attempts?: number
          payload?: Json
          priority?: number
          result?: Json | null
          role?: string | null
          run_id: string
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          type: Database["public"]["Enums"]["task_type"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          claimed_by?: string | null
          created_at?: string
          depends_on?: string[]
          id?: string
          lane?: string | null
          lease_until?: string | null
          max_attempts?: number
          payload?: Json
          priority?: number
          result?: Json | null
          role?: string | null
          run_id?: string
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          type?: Database["public"]["Enums"]["task_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      usage: {
        Row: {
          cache_read_tokens: number
          cache_write_tokens: number
          cost_usd: number
          created_at: string
          id: string
          input_tokens: number
          model: string | null
          output_tokens: number
          role: string | null
          run_id: string | null
          runner: string
          task_id: string | null
        }
        Insert: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number
          model?: string | null
          output_tokens?: number
          role?: string | null
          run_id?: string | null
          runner: string
          task_id?: string | null
        }
        Update: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number
          model?: string | null
          output_tokens?: number
          role?: string | null
          run_id?: string | null
          runner?: string
          task_id?: string | null
        }
        Relationships: []
      }
      usage_snapshots: {
        Row: {
          at: string
          five_hour_pct: number
          five_hour_resets_at: string
          id: string
          run_id: string | null
          seven_day_pct: number
          seven_day_resets_at: string
          source: string
          task_id: string | null
        }
        Insert: {
          at?: string
          five_hour_pct: number
          five_hour_resets_at: string
          id?: string
          run_id?: string | null
          seven_day_pct: number
          seven_day_resets_at: string
          source: string
          task_id?: string | null
        }
        Update: {
          at?: string
          five_hour_pct?: number
          five_hour_resets_at?: string
          id?: string
          run_id?: string | null
          seven_day_pct?: number
          seven_day_resets_at?: string
          source?: string
          task_id?: string | null
        }
        Relationships: []
      }
      worker_heartbeats: {
        Row: {
          created_at: string
          info: Json
          last_seen_at: string
          worker_id: string
        }
        Insert: {
          created_at?: string
          info?: Json
          last_seen_at?: string
          worker_id: string
        }
        Update: {
          created_at?: string
          info?: Json
          last_seen_at?: string
          worker_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      active_overrides: {
        Row: {
          cap_pct: number | null
          created_at: string | null
          created_by: string | null
          expires_at: string | null
          id: string | null
          kind: string | null
        }
        Insert: {
          cap_pct?: number | null
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string | null
          kind?: string | null
        }
        Update: {
          cap_pct?: number | null
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string | null
          kind?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      cancel_blocked_tasks: { Args: never; Returns: number }
      check_worker_offline: { Args: never; Returns: string }
      claim_task: {
        Args: { p_lease_seconds?: number; p_worker_id: string }
        Returns: {
          attempts: number
          claimed_by: string | null
          created_at: string
          depends_on: string[]
          id: string
          lane: string | null
          lease_until: string | null
          max_attempts: number
          payload: Json
          priority: number
          result: Json | null
          role: string | null
          run_id: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
          type: Database["public"]["Enums"]["task_type"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      clear_event_context: { Args: never; Returns: undefined }
      clear_override: { Args: { p_kind: string }; Returns: number }
      complete_task: {
        Args: { p_result?: Json; p_task_id: string; p_worker_id: string }
        Returns: boolean
      }
      create_run: {
        Args: {
          p_config?: Json
          p_module_id: string
          p_tasks?: Json
          p_title: string
        }
        Returns: Json
      }
      create_task_graph: {
        Args: { p_run_id: string; p_tasks: Json }
        Returns: Json
      }
      current_actor_id: { Args: never; Returns: string }
      current_actor_type: {
        Args: never
        Returns: Database["public"]["Enums"]["actor_type"]
      }
      decide_gate: {
        Args: {
          p_comment?: string
          p_decision: Database["public"]["Enums"]["gate_decision"]
          p_task_id: string
          p_via?: string
        }
        Returns: Json
      }
      due_notifications: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          created_at: string
          deliver_after: string
          error: string | null
          gate_task_id: string | null
          id: string
          kind: string
          payload: Json
          priority: number
          run_id: string | null
          sent_at: string | null
          status: string
          telegram_message_id: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "notifications"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      fail_task: {
        Args: {
          p_error?: Json
          p_retryable?: boolean
          p_task_id: string
          p_worker_id: string
        }
        Returns: string
      }
      flush_notifications: { Args: never; Returns: undefined }
      health: { Args: never; Returns: string }
      heartbeat_task: {
        Args: {
          p_lease_seconds?: number
          p_task_id: string
          p_worker_id: string
        }
        Returns: boolean
      }
      http_post_json: {
        Args: { p_body: Json; p_headers: Json; p_url: string }
        Returns: number
      }
      is_owner: { Args: never; Returns: boolean }
      mark_notification: {
        Args: {
          p_defer_until?: string
          p_error?: string
          p_id: string
          p_message_id?: number
          p_status: string
        }
        Returns: undefined
      }
      next_local_midnight: {
        Args: { p_now: string; p_tz: string }
        Returns: string
      }
      promote_ready_gates: { Args: never; Returns: number }
      reap_expired_leases: { Args: never; Returns: number }
      record_usage_snapshot: {
        Args: {
          p_five_pct: number
          p_five_resets: string
          p_run_id?: string
          p_seven_pct: number
          p_seven_resets: string
          p_source: string
          p_task_id?: string
        }
        Returns: string
      }
      release_for_limit: {
        Args: { p_resets_at: string; p_task_id: string; p_worker_id: string }
        Returns: boolean
      }
      resolve_gate: {
        Args: {
          p_comment?: string
          p_decision: Database["public"]["Enums"]["gate_decision"]
          p_task_id: string
        }
        Returns: Json
      }
      scheduler_tick: { Args: never; Returns: Json }
      send_telegram_direct: { Args: { p_text: string }; Returns: number }
      set_event_context: {
        Args: { p_actor_id: string; p_actor_type: string; p_data?: Json }
        Returns: undefined
      }
      set_mode_override: {
        Args: {
          p_cap_pct?: number
          p_kind: string
          p_minutes?: number
          p_via?: string
        }
        Returns: string
      }
      set_override: {
        Args: { p_kind: string; p_minutes?: number; p_via?: string }
        Returns: string
      }
      settle_runs: { Args: never; Returns: number }
      telegram_config: { Args: never; Returns: Json }
      vault_secret: { Args: { p_name: string }; Returns: string }
      watchdog_tick: { Args: never; Returns: string }
      worker_heartbeat: {
        Args: { p_info?: Json; p_worker_id: string }
        Returns: undefined
      }
    }
    Enums: {
      actor_type: "system" | "worker" | "agent" | "human"
      gate_decision: "approve" | "modify" | "dismiss" | "answer"
      run_status:
        | "pending"
        | "running"
        | "paused"
        | "done"
        | "failed"
        | "cancelled"
      task_status:
        | "pending"
        | "running"
        | "waiting_human"
        | "done"
        | "failed"
        | "cancelled"
      task_type: "agent" | "gate" | "system"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      actor_type: ["system", "worker", "agent", "human"],
      gate_decision: ["approve", "modify", "dismiss", "answer"],
      run_status: [
        "pending",
        "running",
        "paused",
        "done",
        "failed",
        "cancelled",
      ],
      task_status: [
        "pending",
        "running",
        "waiting_human",
        "done",
        "failed",
        "cancelled",
      ],
      task_type: ["agent", "gate", "system"],
    },
  },
} as const

