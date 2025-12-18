# Enterprise Compliance Specification

**Version**: 1.0.0
**Date**: 2025-12-16
**Standards**: GDPR, SOC2 Type II, CSSF (Luxembourg)
**Status**: Draft

---

## Table of Contents

1. [Overview](#overview)
2. [Phase 1: Core Compliance Infrastructure](#phase-1-core-compliance-infrastructure)
3. [Phase 2: Data Subject Rights](#phase-2-data-subject-rights-gdpr)
4. [Phase 3: Security Monitoring & Incident Response](#phase-3-security-monitoring--incident-response)
5. [Phase 4: Compliance Reporting & Documentation](#phase-4-compliance-reporting--documentation)
6. [Configuration Reference](#configuration-reference)
7. [File Structure](#file-structure)

---

## Overview

### Current State

The NotebookLM MCP Server already implements strong security foundations:

| Existing Feature | Implementation |
|-----------------|----------------|
| Audit Logging | Hash-chained JSONL with tamper detection |
| Encryption at Rest | ML-KEM-768 + ChaCha20-Poly1305 (post-quantum) |
| Encryption in Transit | TLS with certificate pinning |
| PII Protection | Auto-sanitization in all logs |
| Access Control | Token-based auth with rate limiting |
| Session Security | Hard timeout (8h) + inactivity (30m) |
| Secrets Detection | 50+ patterns, auto-redaction |
| Memory Security | Secure wiping, auto-expiry credentials |
| Data Retention | 30-day audit log rotation |

### Compliance Gaps

| Gap | GDPR | SOC2 | CSSF | Priority |
|-----|------|------|------|----------|
| Consent Management | Required | - | Required | P1 |
| Data Subject Rights (DSAR) | Required | - | Required | P1 |
| Data Export/Portability | Required | - | Required | P1 |
| Right to Erasure | Required | - | Required | P1 |
| Data Classification | - | Required | Required | P1 |
| SIEM Integration | - | Required | Required | P2 |
| Breach Detection | Required | Required | Required | P2 |
| Incident Response | - | Required | Required | P2 |
| Compliance Reporting | - | Required | Required | P3 |
| Change Management | - | Required | Required | P3 |

---

## Phase 1: Core Compliance Infrastructure

### 1.1 Compliance Logger

**File**: `src/utils/compliance-logger.ts`

**Purpose**: Structured logging specifically for compliance events, separate from operational audit logs.

**Event Categories**:

```typescript
type ComplianceEventCategory =
  | "consent"           // Consent granted/revoked
  | "data_access"       // Data access requests
  | "data_export"       // Data portability requests
  | "data_deletion"     // Erasure requests
  | "data_processing"   // Processing activities
  | "security_incident" // Security events
  | "policy_change"     // Configuration changes
  | "access_control"    // Auth events
  | "retention"         // Data retention events
  | "breach";           // Breach notifications
```

**Event Structure**:

```typescript
interface ComplianceEvent {
  // Required fields
  id: string;                    // UUID v4
  timestamp: string;             // ISO 8601
  category: ComplianceEventCategory;
  event_type: string;            // Specific event (e.g., "consent_granted")

  // Actor information
  actor: {
    type: "user" | "system" | "admin";
    id?: string;                 // User/session ID if applicable
    ip?: string;                 // Masked IP (last octet zeroed)
  };

  // Event details
  resource?: {
    type: string;                // e.g., "notebook", "session", "audit_log"
    id?: string;
  };

  // Compliance metadata
  legal_basis?: string;          // GDPR legal basis
  data_categories?: string[];    // Types of data involved
  retention_days?: number;       // How long to retain this event

  // Outcome
  outcome: "success" | "failure" | "pending";
  failure_reason?: string;

  // Integrity
  hash: string;
  previous_hash: string;
}
```

**Storage**:
- Location: `<data_dir>/compliance/events-YYYY-MM.jsonl`
- Retention: Configurable, default 7 years (CSSF requirement)
- Format: JSONL with hash chain
- Encryption: Post-quantum encrypted

**Configuration**:

```bash
NLMCP_COMPLIANCE_ENABLED=true
NLMCP_COMPLIANCE_DIR=/path/to/compliance
NLMCP_COMPLIANCE_RETENTION_YEARS=7
NLMCP_COMPLIANCE_ENCRYPTION=true
```

---

### 1.2 Data Classification System

**File**: `src/utils/data-classification.ts`

**Purpose**: Tag all data by sensitivity level for appropriate handling.

**Classification Levels**:

```typescript
enum DataClassification {
  PUBLIC = "public",           // No restrictions
  INTERNAL = "internal",       // Internal use only
  CONFIDENTIAL = "confidential", // Restricted access
  RESTRICTED = "restricted",   // Highly sensitive (PII, credentials)
  REGULATED = "regulated"      // Subject to regulatory requirements
}

interface ClassifiedData {
  classification: DataClassification;
  data_categories: DataCategory[];
  retention_policy: string;
  encryption_required: boolean;
  audit_required: boolean;
  exportable: boolean;
  erasable: boolean;
}

type DataCategory =
  | "personal_data"      // GDPR personal data
  | "sensitive_data"     // GDPR special categories
  | "credentials"        // Auth tokens, passwords
  | "session_data"       // Browser session state
  | "usage_data"         // Analytics, telemetry
  | "configuration"      // Settings, preferences
  | "audit_logs"         // Compliance logs
  | "notebook_metadata"; // Notebook URLs, descriptions
```

**Data Inventory**:

| Data Type | Classification | Categories | Retention | Encrypted |
|-----------|---------------|------------|-----------|-----------|
| Auth tokens | RESTRICTED | credentials | Session | Yes |
| Browser cookies | RESTRICTED | session_data, personal_data | 24h | Yes |
| Notebook library | CONFIDENTIAL | notebook_metadata | Indefinite | Yes |
| Audit logs | REGULATED | audit_logs | 7 years | Yes |
| Compliance events | REGULATED | audit_logs | 7 years | Yes |
| User settings | INTERNAL | configuration | Indefinite | No |
| Session data | CONFIDENTIAL | session_data | 8h max | Yes |
| PQ encryption keys | RESTRICTED | credentials | Indefinite | Yes |

---

### 1.3 Consent Manager

**File**: `src/compliance/consent-manager.ts`

**Purpose**: Track and manage user consent for data processing activities.

**Consent Types**:

```typescript
interface ConsentRecord {
  id: string;                    // UUID
  version: string;               // Consent version (e.g., "1.0.0")
  granted_at: string;            // ISO 8601
  expires_at?: string;           // Optional expiry

  // What was consented to
  purposes: ConsentPurpose[];
  data_categories: DataCategory[];

  // Legal basis (GDPR Article 6)
  legal_basis: LegalBasis;

  // Consent metadata
  method: "explicit" | "implicit" | "contractual";
  evidence?: string;             // How consent was obtained

  // Revocation
  revoked?: boolean;
  revoked_at?: string;
  revocation_reason?: string;
}

type ConsentPurpose =
  | "service_provision"    // Core service functionality
  | "session_management"   // Browser session handling
  | "security_logging"     // Security audit logging
  | "error_diagnostics"    // Error logging for debugging
  | "usage_analytics";     // Optional usage tracking

type LegalBasis =
  | "consent"              // User explicitly consented
  | "contract"             // Necessary for contract performance
  | "legal_obligation"     // Required by law
  | "vital_interests"      // Protect vital interests
  | "public_interest"      // Public interest task
  | "legitimate_interest"; // Legitimate business interest
```

**Default Legal Bases**:

| Processing Activity | Legal Basis | Requires Explicit Consent |
|--------------------|-------------|---------------------------|
| Browser session for NotebookLM access | Contract | No |
| Security audit logging | Legitimate Interest | No |
| Credential encryption | Legal Obligation | No |
| Error logging | Legitimate Interest | No |
| Compliance logging | Legal Obligation | No |

**Storage**:
- Location: `<config_dir>/consent.json.pqenc`
- Encrypted: Yes (post-quantum)
- Backed up: Yes (with compliance events)

**API**:

```typescript
class ConsentManager {
  // Record new consent
  async grantConsent(purposes: ConsentPurpose[], legalBasis: LegalBasis): Promise<ConsentRecord>;

  // Revoke consent
  async revokeConsent(consentId: string, reason?: string): Promise<void>;

  // Check if consent exists for purpose
  hasConsent(purpose: ConsentPurpose): boolean;

  // Get all active consents
  getActiveConsents(): ConsentRecord[];

  // Get consent history (for DSAR)
  getConsentHistory(): ConsentRecord[];

  // Check if first run (needs consent prompt)
  isFirstRun(): boolean;

  // Export consent records (for DSAR)
  exportConsents(): string; // JSON
}
```

---

### 1.4 Privacy Notice Display

**File**: `src/compliance/privacy-notice.ts`

**Purpose**: Display privacy notice on first run and track acceptance.

**Notice Content** (stored in `src/compliance/privacy-notice-text.ts`):

```typescript
interface PrivacyNotice {
  version: string;
  effective_date: string;

  sections: {
    data_controller: string;
    data_collected: string[];
    purposes: string[];
    legal_basis: string[];
    retention: string;
    rights: string[];
    contact: string;
  };

  // Short summary for CLI display
  summary: string;
}
```

**Display Behavior**:

1. **First Run**: Display full privacy notice, require acknowledgment
2. **Notice Updated**: Display changes, require re-acknowledgment
3. **On Demand**: Available via `get_privacy_notice` MCP tool

**CLI Display Example**:

```
╔══════════════════════════════════════════════════════════════════╗
║                     PRIVACY NOTICE v1.0.0                         ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  This tool processes the following data locally on your device:  ║
║                                                                   ║
║  • Browser session data (cookies, local storage)                 ║
║  • NotebookLM URLs and metadata                                  ║
║  • Query history (for session context)                           ║
║  • Security audit logs                                           ║
║                                                                   ║
║  All data is:                                                    ║
║  ✓ Stored locally only (no cloud sync)                          ║
║  ✓ Encrypted with post-quantum cryptography                     ║
║  ✓ Subject to automatic retention policies                      ║
║                                                                   ║
║  Your rights: Access, Export, Erasure, Portability              ║
║                                                                   ║
║  Full policy: https://github.com/Pantheon-Security/...          ║
║                                                                   ║
╠══════════════════════════════════════════════════════════════════╣
║  By continuing, you acknowledge this privacy notice.             ║
║                                                                   ║
║  [Press Enter to continue, or Ctrl+C to exit]                   ║
╚══════════════════════════════════════════════════════════════════╝
```

---

### 1.5 Enhanced Audit Events

**File**: Update `src/utils/audit-logger.ts`

**New Event Types**:

```typescript
// Add to existing AuditEventType
type AuditEventType =
  | "tool"              // Existing
  | "auth"              // Existing
  | "session"           // Existing
  | "security"          // Existing
  | "system"            // Existing
  | "compliance"        // NEW: Compliance events
  | "data_access"       // NEW: Data access events
  | "configuration"     // NEW: Config changes
  | "retention";        // NEW: Data retention events

// New compliance-specific logging methods
interface AuditLogger {
  // Existing methods...

  // NEW: Compliance event logging
  logComplianceEvent(
    event: string,
    category: ComplianceEventCategory,
    details: Record<string, unknown>
  ): Promise<void>;

  // NEW: Data access logging (for DSAR)
  logDataAccess(
    action: "view" | "export" | "delete",
    dataType: string,
    details: Record<string, unknown>
  ): Promise<void>;

  // NEW: Configuration change logging
  logConfigChange(
    setting: string,
    oldValue: unknown,
    newValue: unknown,
    changedBy: string
  ): Promise<void>;

  // NEW: Retention event logging
  logRetentionEvent(
    action: "cleanup" | "archive" | "delete",
    dataType: string,
    count: number,
    details: Record<string, unknown>
  ): Promise<void>;
}
```

---

## Phase 2: Data Subject Rights (GDPR)

### 2.1 Data Export Tool

**File**: `src/compliance/data-export.ts`

**Purpose**: Export all user data in machine-readable format (GDPR Article 20).

**Export Format**:

```typescript
interface DataExport {
  export_metadata: {
    version: string;
    exported_at: string;
    format: "json";
    encryption: "none" | "password";
    checksum: string;
  };

  data: {
    // User identity
    consent_records: ConsentRecord[];

    // Notebooks
    notebook_library: NotebookEntry[];

    // Settings
    user_settings: Settings;

    // Session history (if retained)
    session_history?: SessionSummary[];

    // Audit logs (user's own activity)
    activity_log: AuditEvent[];

    // Compliance events
    compliance_events: ComplianceEvent[];
  };

  data_inventory: {
    category: string;
    count: number;
    date_range: { from: string; to: string };
  }[];
}
```

**Export Options**:

```typescript
interface ExportOptions {
  // What to include
  include_notebooks: boolean;       // Default: true
  include_settings: boolean;        // Default: true
  include_sessions: boolean;        // Default: true
  include_audit_logs: boolean;      // Default: true
  include_compliance_events: boolean; // Default: true

  // Date range
  from_date?: string;
  to_date?: string;

  // Security
  encrypt_export: boolean;          // Default: false
  export_password?: string;

  // Format
  format: "json" | "json_pretty";

  // Delivery
  output_path?: string;             // Default: stdout
}
```

**MCP Tool**:

```typescript
// New MCP tool: export_user_data
{
  name: "export_user_data",
  description: "Export all user data (GDPR Article 20 - Right to Data Portability)",
  inputSchema: {
    type: "object",
    properties: {
      include_audit_logs: { type: "boolean", default: true },
      from_date: { type: "string", format: "date" },
      to_date: { type: "string", format: "date" },
      format: { type: "string", enum: ["json", "json_pretty"], default: "json_pretty" }
    }
  }
}
```

---

### 2.2 Right to Erasure

**File**: `src/compliance/data-erasure.ts`

**Purpose**: Complete deletion of user data (GDPR Article 17).

**Erasure Scope**:

```typescript
interface ErasureRequest {
  request_id: string;
  requested_at: string;

  // What to delete
  scope: ErasureScope;

  // Verification
  confirmed: boolean;
  confirmation_method: "explicit" | "timeout";

  // Execution
  executed_at?: string;
  items_deleted: ErasureResult[];

  // Retention (we must keep the erasure record itself)
  erasure_record_retention_days: number; // Default: 2555 (7 years)
}

interface ErasureScope {
  // Data types to delete
  notebooks: boolean;           // Notebook library
  settings: boolean;            // User settings
  browser_data: boolean;        // Browser profiles, cookies
  audit_logs: boolean;          // User activity logs
  compliance_events: boolean;   // Keep erasure record only
  encryption_keys: boolean;     // PQ keys (careful!)

  // Or delete everything
  complete_erasure: boolean;
}

interface ErasureResult {
  data_type: string;
  path: string;
  items_deleted: number;
  size_bytes: number;
  method: "overwrite" | "delete" | "crypto_shred";
  verified: boolean;
}
```

**Secure Deletion Methods**:

1. **Overwrite**: 3-pass overwrite with random data
2. **Delete**: Standard file deletion
3. **Crypto Shred**: Delete encryption keys (data unrecoverable)

**Retention Exceptions** (data that cannot be deleted):

- Erasure request record itself (legal requirement)
- Security incident logs (if applicable)
- Data required for legal proceedings

**MCP Tool**:

```typescript
// New MCP tool: request_data_erasure
{
  name: "request_data_erasure",
  description: "Request deletion of all user data (GDPR Article 17 - Right to Erasure)",
  inputSchema: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        enum: ["complete", "notebooks", "sessions", "audit_logs"],
        default: "complete"
      },
      confirm: {
        type: "boolean",
        description: "Explicit confirmation required"
      }
    },
    required: ["confirm"]
  }
}
```

---

### 2.3 Data Access Request Handler

**File**: `src/compliance/dsar-handler.ts`

**Purpose**: Handle Data Subject Access Requests (GDPR Article 15).

**DSAR Response**:

```typescript
interface DSARResponse {
  request_id: string;
  submitted_at: string;
  completed_at: string;

  // Identity confirmation
  subject_verified: boolean;

  // Data provided
  personal_data: {
    category: string;
    data: unknown;
    source: string;
    retention_period: string;
  }[];

  // Processing information
  processing_purposes: string[];
  legal_bases: string[];
  data_recipients: string[];  // Empty for local-only

  // Rights information
  available_rights: string[];

  // Metadata
  format: "json";
  encrypted: boolean;
}
```

**MCP Tool**:

```typescript
// New MCP tool: submit_data_access_request
{
  name: "submit_data_access_request",
  description: "Submit a Data Subject Access Request (GDPR Article 15)",
  inputSchema: {
    type: "object",
    properties: {
      include_processing_info: { type: "boolean", default: true },
      format: { type: "string", enum: ["json", "summary"], default: "summary" }
    }
  }
}
```

---

### 2.4 Data Inventory

**File**: `src/compliance/data-inventory.ts`

**Purpose**: Maintain inventory of all personal data stored.

**Inventory Structure**:

```typescript
interface DataInventoryEntry {
  id: string;

  // What
  data_type: string;
  description: string;
  classification: DataClassification;
  data_categories: DataCategory[];

  // Where
  storage_location: string;
  encrypted: boolean;

  // How long
  retention_policy: string;
  retention_days: number | "indefinite";

  // Legal
  legal_basis: LegalBasis;
  processing_purposes: string[];

  // Access
  who_can_access: string[];
  exportable: boolean;
  erasable: boolean;

  // Metadata
  last_updated: string;
}
```

**Auto-Discovery**:
- Scan data directories on startup
- Register new data types automatically
- Track data lifecycle

---

### 2.5 Retention Policy Engine

**File**: `src/compliance/retention-engine.ts`

**Purpose**: Enforce data retention policies automatically.

**Policy Configuration**:

```typescript
interface RetentionPolicy {
  id: string;
  name: string;

  // What it applies to
  data_types: string[];
  classifications?: DataClassification[];

  // How long to keep
  retention_days: number;

  // What to do after expiry
  action: "delete" | "archive" | "anonymize";

  // When to run
  schedule: "daily" | "weekly" | "monthly";

  // Exceptions
  exceptions?: {
    condition: string;
    extended_retention_days: number;
  }[];

  // Compliance
  regulatory_requirement?: string; // e.g., "CSSF Circular 20/750"
}
```

**Default Policies**:

| Data Type | Retention | Action | Regulation |
|-----------|-----------|--------|------------|
| Audit logs | 7 years | Archive | CSSF |
| Compliance events | 7 years | Archive | CSSF |
| Session data | 24 hours | Delete | - |
| Browser cache | 7 days | Delete | - |
| Error logs | 30 days | Delete | - |
| Consent records | 7 years | Archive | GDPR |
| Erasure records | 7 years | Archive | GDPR |

---

## Phase 3: Security Monitoring & Incident Response

### 3.1 SIEM Integration

**File**: `src/compliance/siem-exporter.ts`

**Purpose**: Export logs to external Security Information and Event Management systems.

**Supported Formats**:

```typescript
type SIEMFormat =
  | "json"           // Raw JSON
  | "cef"            // Common Event Format (ArcSight)
  | "leef"           // Log Event Extended Format (IBM QRadar)
  | "syslog"         // RFC 5424 syslog
  | "splunk_hec";    // Splunk HTTP Event Collector

interface SIEMConfig {
  enabled: boolean;
  format: SIEMFormat;

  // Destination
  endpoint?: string;          // For HTTP-based (Splunk HEC)
  syslog_host?: string;       // For syslog
  syslog_port?: number;

  // Authentication
  api_key?: string;

  // Filtering
  min_severity: "info" | "warning" | "error" | "critical";
  event_types: string[];      // Which events to export

  // Batching
  batch_size: number;         // Default: 100
  flush_interval_ms: number;  // Default: 5000

  // Reliability
  retry_attempts: number;     // Default: 3
  queue_max_size: number;     // Default: 10000
}
```

**CEF Format Example**:

```
CEF:0|Pantheon Security|NotebookLM MCP|1.5.1|auth_failed|Authentication Failed|7|src=192.168.1.100 suser=unknown outcome=failure reason=invalid_token
```

**Configuration**:

```bash
NLMCP_SIEM_ENABLED=true
NLMCP_SIEM_FORMAT=cef
NLMCP_SIEM_ENDPOINT=https://siem.example.com/api/events
NLMCP_SIEM_API_KEY=xxx
NLMCP_SIEM_MIN_SEVERITY=warning
```

---

### 3.2 Breach Detection

**File**: `src/compliance/breach-detection.ts`

**Purpose**: Detect potential security breaches and policy violations.

**Detection Rules**:

```typescript
interface BreachRule {
  id: string;
  name: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";

  // Detection
  event_pattern: string;      // Regex or event type
  threshold?: number;         // Count threshold
  window_seconds?: number;    // Time window

  // Response
  actions: BreachAction[];

  // Regulatory
  notification_required: boolean;
  notification_deadline_hours?: number; // e.g., 72 for GDPR
}

type BreachAction =
  | "log"                     // Log to compliance events
  | "alert"                   // Send alert
  | "block"                   // Block further access
  | "notify_admin"            // Email/webhook notification
  | "create_incident";        // Create incident record

```

**Default Rules**:

| Rule | Trigger | Severity | Actions |
|------|---------|----------|---------|
| Brute Force | 10 failed auth in 5 min | High | block, alert, log |
| Secrets Leaked | Secrets detected in output | Critical | alert, log, create_incident |
| Cert Pinning Violation | TLS cert mismatch | Critical | block, alert, log |
| Unusual Access Pattern | Access outside normal hours | Medium | alert, log |
| Mass Data Export | Large export request | Medium | log, notify_admin |
| Encryption Failure | Encryption operation failed | High | alert, log |

---

### 3.3 Incident Response Log

**File**: `src/compliance/incident-manager.ts`

**Purpose**: Track and manage security incidents.

**Incident Structure**:

```typescript
interface SecurityIncident {
  id: string;

  // Classification
  type: IncidentType;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "investigating" | "contained" | "resolved" | "closed";

  // Timeline
  detected_at: string;
  reported_at?: string;
  contained_at?: string;
  resolved_at?: string;
  closed_at?: string;

  // Details
  title: string;
  description: string;
  affected_data: string[];
  affected_systems: string[];

  // Response
  actions_taken: IncidentAction[];
  root_cause?: string;
  remediation?: string;

  // Notification
  notification_required: boolean;
  notification_sent?: boolean;
  notification_deadline?: string;

  // Evidence
  related_events: string[];  // Event IDs from audit log
}

type IncidentType =
  | "unauthorized_access"
  | "data_breach"
  | "malware"
  | "dos_attack"
  | "policy_violation"
  | "data_loss"
  | "configuration_error"
  | "other";

interface IncidentAction {
  timestamp: string;
  action: string;
  performed_by: string;
  notes?: string;
}
```

---

### 3.4 Alert System

**File**: `src/compliance/alert-manager.ts`

**Purpose**: Send alerts for security and compliance events.

**Alert Channels**:

```typescript
interface AlertConfig {
  enabled: boolean;

  channels: {
    // Console (always available)
    console: boolean;

    // File-based alerts
    file?: {
      path: string;
      format: "json" | "text";
    };

    // Webhook (Slack, Teams, etc.)
    webhook?: {
      url: string;
      headers?: Record<string, string>;
      template?: string;
    };

    // Email (via external service)
    email?: {
      smtp_host: string;
      smtp_port: number;
      from: string;
      to: string[];
      use_tls: boolean;
    };
  };

  // Filtering
  min_severity: "info" | "warning" | "error" | "critical";
  event_types?: string[];

  // Rate limiting
  cooldown_seconds: number;  // Don't repeat same alert within
  max_alerts_per_hour: number;
}
```

**Configuration**:

```bash
NLMCP_ALERTS_ENABLED=true
NLMCP_ALERTS_WEBHOOK_URL=https://hooks.slack.com/xxx
NLMCP_ALERTS_MIN_SEVERITY=warning
NLMCP_ALERTS_COOLDOWN=300
```

---

### 3.5 Health Monitoring

**File**: `src/compliance/health-monitor.ts`

**Purpose**: Monitor system health and availability (SOC2 requirement).

**Health Metrics**:

```typescript
interface HealthMetrics {
  timestamp: string;

  // System health
  status: "healthy" | "degraded" | "unhealthy";
  uptime_seconds: number;

  // Component status
  components: {
    name: string;
    status: "up" | "down" | "degraded";
    last_check: string;
    response_time_ms?: number;
    error?: string;
  }[];

  // Resource usage
  resources: {
    memory_used_mb: number;
    memory_limit_mb: number;
    disk_used_mb: number;
    disk_available_mb: number;
  };

  // Security status
  security: {
    encryption_enabled: boolean;
    auth_enabled: boolean;
    cert_pinning_enabled: boolean;
    last_security_scan?: string;
    open_incidents: number;
  };

  // Compliance status
  compliance: {
    consent_valid: boolean;
    retention_policies_active: number;
    pending_erasure_requests: number;
    last_compliance_check: string;
  };
}
```

**MCP Tool Enhancement**:

```typescript
// Enhance existing get_health tool
{
  name: "get_health",
  description: "Get server health including compliance status",
  // Add compliance metrics to response
}
```

---

## Phase 4: Compliance Reporting & Documentation

### 4.1 Compliance Dashboard

**File**: `src/compliance/dashboard.ts`

**Purpose**: Generate compliance status overview.

**Dashboard Output**:

```typescript
interface ComplianceDashboard {
  generated_at: string;

  // Overall status
  overall_status: "compliant" | "non_compliant" | "needs_attention";

  // By regulation
  regulations: {
    name: "GDPR" | "SOC2" | "CSSF";
    status: "compliant" | "non_compliant" | "partial";
    requirements_met: number;
    requirements_total: number;
    issues: ComplianceIssue[];
  }[];

  // Key metrics
  metrics: {
    active_consents: number;
    pending_dsars: number;
    pending_erasures: number;
    open_incidents: number;
    audit_log_integrity: "verified" | "issues_found";
    encryption_status: "enabled" | "disabled" | "partial";
    retention_compliance: number; // Percentage
  };

  // Recent events
  recent_compliance_events: ComplianceEvent[];

  // Upcoming deadlines
  deadlines: {
    type: string;
    deadline: string;
    days_remaining: number;
  }[];
}

interface ComplianceIssue {
  severity: "critical" | "high" | "medium" | "low";
  regulation: string;
  requirement: string;
  description: string;
  remediation: string;
}
```

**MCP Tool**:

```typescript
// New MCP tool: get_compliance_status
{
  name: "get_compliance_status",
  description: "Get compliance dashboard showing status across GDPR, SOC2, CSSF",
  inputSchema: {
    type: "object",
    properties: {
      regulations: {
        type: "array",
        items: { type: "string", enum: ["GDPR", "SOC2", "CSSF"] },
        default: ["GDPR", "SOC2", "CSSF"]
      },
      include_events: { type: "boolean", default: true }
    }
  }
}
```

---

### 4.2 Audit Report Generator

**File**: `src/compliance/report-generator.ts`

**Purpose**: Generate compliance audit reports.

**Report Types**:

```typescript
type ReportType =
  | "compliance_summary"     // High-level compliance status
  | "audit_trail"            // Detailed audit log report
  | "access_report"          // Who accessed what
  | "retention_report"       // Data retention status
  | "incident_report"        // Security incident summary
  | "dsar_report"            // Data subject request summary
  | "consent_report";        // Consent status report

interface ReportConfig {
  type: ReportType;

  // Time range
  from_date: string;
  to_date: string;

  // Format
  format: "json" | "html" | "pdf" | "csv";

  // Filters
  regulations?: string[];
  severity_min?: string;

  // Output
  output_path?: string;
  include_evidence?: boolean;
}
```

---

### 4.3 Policy Documentation

**File**: `src/compliance/policy-docs.ts`

**Purpose**: Machine-readable policy documentation.

**Policies**:

```typescript
interface PolicyDocument {
  id: string;
  type: PolicyType;
  version: string;
  effective_date: string;

  // Content
  title: string;
  description: string;
  full_text: string;

  // Applicability
  regulations: string[];
  data_types: string[];

  // Enforcement
  enforced: boolean;
  enforcement_method: "automatic" | "manual" | "audit";

  // Review
  last_reviewed: string;
  next_review: string;
  approved_by: string;
}

type PolicyType =
  | "privacy_policy"
  | "data_retention"
  | "access_control"
  | "encryption"
  | "incident_response"
  | "acceptable_use";
```

---

### 4.4 Change Log

**File**: `src/compliance/change-log.ts`

**Purpose**: Track all configuration changes (SOC2 requirement).

**Change Record**:

```typescript
interface ChangeRecord {
  id: string;
  timestamp: string;

  // What changed
  component: string;
  setting: string;
  old_value: unknown;
  new_value: unknown;

  // Who/how
  changed_by: "user" | "system" | "admin";
  method: "cli" | "env" | "api" | "config_file";

  // Approval (for sensitive changes)
  requires_approval: boolean;
  approved_by?: string;
  approved_at?: string;

  // Impact
  impact: "low" | "medium" | "high";
  affected_compliance: string[];
}
```

---

### 4.5 Evidence Collection

**File**: `src/compliance/evidence-collector.ts`

**Purpose**: Automated collection of compliance evidence for audits.

**Evidence Types**:

```typescript
interface EvidencePackage {
  id: string;
  generated_at: string;

  // What it's for
  audit_type: "SOC2" | "GDPR" | "CSSF" | "internal";
  period: { from: string; to: string };

  // Contents
  items: EvidenceItem[];

  // Integrity
  checksum: string;
  signed_by?: string;
}

interface EvidenceItem {
  id: string;
  type: EvidenceType;
  description: string;

  // Content
  content: string | object;
  format: "json" | "text" | "screenshot" | "log";

  // Metadata
  collected_at: string;
  source: string;

  // Compliance mapping
  controls: string[];  // e.g., ["SOC2-CC6.1", "GDPR-Art32"]
}

type EvidenceType =
  | "policy_document"
  | "configuration"
  | "audit_log_sample"
  | "access_review"
  | "encryption_status"
  | "retention_proof"
  | "consent_records"
  | "incident_response";
```

---

## Configuration Reference

### All New Environment Variables

```bash
# ============================================
# COMPLIANCE CONFIGURATION
# ============================================

# Core Compliance
NLMCP_COMPLIANCE_ENABLED=true              # Enable compliance features
NLMCP_COMPLIANCE_MODE=full                 # full | minimal | audit_only
NLMCP_COMPLIANCE_REGULATIONS=GDPR,SOC2,CSSF  # Which regulations to enforce

# Compliance Logging
NLMCP_COMPLIANCE_DIR=/path/to/compliance   # Compliance event directory
NLMCP_COMPLIANCE_RETENTION_YEARS=7         # Retention for compliance events
NLMCP_COMPLIANCE_ENCRYPTION=true           # Encrypt compliance logs

# Consent Management
NLMCP_CONSENT_REQUIRED=true                # Require consent on first run
NLMCP_CONSENT_VERSION=1.0.0                # Current consent version
NLMCP_PRIVACY_NOTICE_URL=https://...       # Link to full privacy policy

# Data Subject Rights
NLMCP_DSAR_ENABLED=true                    # Enable DSAR handling
NLMCP_ERASURE_ENABLED=true                 # Enable right to erasure
NLMCP_EXPORT_ENABLED=true                  # Enable data export
NLMCP_EXPORT_ENCRYPT=false                 # Encrypt exports by default

# Retention Policies
NLMCP_RETENTION_AUDIT_DAYS=2555            # 7 years for audit logs
NLMCP_RETENTION_SESSION_HOURS=24           # Session data retention
NLMCP_RETENTION_BROWSER_DAYS=7             # Browser cache retention
NLMCP_RETENTION_CHECK_SCHEDULE=daily       # When to run retention cleanup

# SIEM Integration
NLMCP_SIEM_ENABLED=false                   # Enable SIEM export
NLMCP_SIEM_FORMAT=cef                      # cef | leef | syslog | json | splunk_hec
NLMCP_SIEM_ENDPOINT=https://...            # SIEM endpoint URL
NLMCP_SIEM_API_KEY=xxx                     # SIEM API key
NLMCP_SIEM_BATCH_SIZE=100                  # Events per batch
NLMCP_SIEM_FLUSH_INTERVAL_MS=5000          # Flush interval

# Breach Detection
NLMCP_BREACH_DETECTION=true                # Enable breach detection
NLMCP_BREACH_NOTIFICATION=true             # Auto-notify on breach
NLMCP_BREACH_WEBHOOK=https://...           # Breach notification webhook

# Incident Response
NLMCP_INCIDENT_TRACKING=true               # Enable incident tracking
NLMCP_INCIDENT_AUTO_CREATE=true            # Auto-create incidents on breach

# Alerts
NLMCP_ALERTS_ENABLED=true                  # Enable alerts
NLMCP_ALERTS_WEBHOOK_URL=https://...       # Slack/Teams webhook
NLMCP_ALERTS_EMAIL_TO=security@example.com # Alert email recipients
NLMCP_ALERTS_MIN_SEVERITY=warning          # Minimum alert severity
NLMCP_ALERTS_COOLDOWN=300                  # Seconds between repeated alerts

# Health Monitoring
NLMCP_HEALTH_MONITORING=true               # Enable health monitoring
NLMCP_HEALTH_CHECK_INTERVAL=60             # Seconds between health checks

# Reporting
NLMCP_REPORTS_DIR=/path/to/reports         # Report output directory
NLMCP_REPORTS_AUTO_GENERATE=false          # Auto-generate periodic reports
NLMCP_REPORTS_SCHEDULE=monthly             # Report generation schedule
```

---

## File Structure

```
src/
├── compliance/
│   ├── index.ts                    # Module exports
│   ├── compliance-logger.ts        # Phase 1.1
│   ├── data-classification.ts      # Phase 1.2
│   ├── consent-manager.ts          # Phase 1.3
│   ├── privacy-notice.ts           # Phase 1.4
│   ├── privacy-notice-text.ts      # Privacy notice content
│   ├── data-export.ts              # Phase 2.1
│   ├── data-erasure.ts             # Phase 2.2
│   ├── dsar-handler.ts             # Phase 2.3
│   ├── data-inventory.ts           # Phase 2.4
│   ├── retention-engine.ts         # Phase 2.5
│   ├── siem-exporter.ts            # Phase 3.1
│   ├── breach-detection.ts         # Phase 3.2
│   ├── incident-manager.ts         # Phase 3.3
│   ├── alert-manager.ts            # Phase 3.4
│   ├── health-monitor.ts           # Phase 3.5
│   ├── dashboard.ts                # Phase 4.1
│   ├── report-generator.ts         # Phase 4.2
│   ├── policy-docs.ts              # Phase 4.3
│   ├── change-log.ts               # Phase 4.4
│   ├── evidence-collector.ts       # Phase 4.5
│   └── types.ts                    # Shared types
├── utils/
│   └── audit-logger.ts             # Enhanced (Phase 1.5)
└── tools/
    └── compliance-tools.ts         # New MCP tools
```

---

## Implementation Order

### Phase 1 (Foundation) - Implement First
1. `types.ts` - Shared types
2. `compliance-logger.ts` - Core logging
3. `data-classification.ts` - Classification system
4. `consent-manager.ts` - Consent tracking
5. `privacy-notice.ts` + `privacy-notice-text.ts` - Privacy display
6. Update `audit-logger.ts` - Enhanced events

### Phase 2 (GDPR Rights) - Implement Second
1. `data-inventory.ts` - Data catalog
2. `retention-engine.ts` - Retention enforcement
3. `data-export.ts` - Export functionality
4. `data-erasure.ts` - Erasure functionality
5. `dsar-handler.ts` - DSAR handling

### Phase 3 (Monitoring) - Implement Third
1. `alert-manager.ts` - Alert system
2. `breach-detection.ts` - Breach detection
3. `incident-manager.ts` - Incident tracking
4. `siem-exporter.ts` - SIEM integration
5. `health-monitor.ts` - Health monitoring

### Phase 4 (Reporting) - Implement Last
1. `change-log.ts` - Change tracking
2. `policy-docs.ts` - Policy documentation
3. `dashboard.ts` - Compliance dashboard
4. `report-generator.ts` - Report generation
5. `evidence-collector.ts` - Evidence collection
6. `compliance-tools.ts` - MCP tools

---

## Approval

- [ ] Phase 1 Specification Approved
- [ ] Phase 2 Specification Approved
- [ ] Phase 3 Specification Approved
- [ ] Phase 4 Specification Approved

**Approved By**: ___________________
**Date**: ___________________
