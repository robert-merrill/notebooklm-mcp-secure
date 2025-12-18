/**
 * Data Classification System
 *
 * Tags all data by sensitivity level for appropriate handling.
 * Supports GDPR, SOC2, and CSSF compliance requirements.
 *
 * Added by Pantheon Security for enterprise compliance support.
 */

import {
  DataClassification,
  DataCategory,
  ClassifiedData,
  LegalBasis,
  DataInventoryEntry,
} from "./types.js";

// ============================================
// DATA TYPE REGISTRY
// ============================================

/**
 * Pre-defined data classifications for known data types
 */
const DATA_CLASSIFICATIONS: Record<string, ClassifiedData> = {
  // Authentication & Credentials
  "auth_token": {
    classification: DataClassification.RESTRICTED,
    data_categories: ["credentials"],
    retention_policy: "session",
    encryption_required: true,
    audit_required: true,
    exportable: false,
    erasable: true,
  },
  "mcp_auth_token": {
    classification: DataClassification.RESTRICTED,
    data_categories: ["credentials"],
    retention_policy: "indefinite",
    encryption_required: true,
    audit_required: true,
    exportable: false,
    erasable: true,
  },
  "encryption_keys": {
    classification: DataClassification.RESTRICTED,
    data_categories: ["credentials"],
    retention_policy: "indefinite",
    encryption_required: true,
    audit_required: true,
    exportable: false,
    erasable: true,
  },

  // Browser & Session Data
  "browser_cookies": {
    classification: DataClassification.RESTRICTED,
    data_categories: ["session_data", "personal_data"],
    retention_policy: "24_hours",
    encryption_required: true,
    audit_required: true,
    exportable: true,
    erasable: true,
  },
  "browser_local_storage": {
    classification: DataClassification.CONFIDENTIAL,
    data_categories: ["session_data"],
    retention_policy: "24_hours",
    encryption_required: true,
    audit_required: false,
    exportable: true,
    erasable: true,
  },
  "session_state": {
    classification: DataClassification.CONFIDENTIAL,
    data_categories: ["session_data"],
    retention_policy: "8_hours",
    encryption_required: true,
    audit_required: true,
    exportable: true,
    erasable: true,
  },

  // User Data
  "notebook_library": {
    classification: DataClassification.CONFIDENTIAL,
    data_categories: ["notebook_metadata"],
    retention_policy: "indefinite",
    encryption_required: true,
    audit_required: true,
    exportable: true,
    erasable: true,
  },
  "user_settings": {
    classification: DataClassification.INTERNAL,
    data_categories: ["configuration"],
    retention_policy: "indefinite",
    encryption_required: false,
    audit_required: false,
    exportable: true,
    erasable: true,
  },
  "consent_records": {
    classification: DataClassification.REGULATED,
    data_categories: ["personal_data"],
    retention_policy: "7_years",
    encryption_required: true,
    audit_required: true,
    exportable: true,
    erasable: false, // Must retain for compliance
  },

  // Audit & Compliance Logs
  "audit_logs": {
    classification: DataClassification.REGULATED,
    data_categories: ["audit_logs"],
    retention_policy: "7_years",
    encryption_required: true,
    audit_required: false, // Don't audit the audit logs
    exportable: true,
    erasable: false, // Required for compliance
  },
  "compliance_events": {
    classification: DataClassification.REGULATED,
    data_categories: ["audit_logs"],
    retention_policy: "7_years",
    encryption_required: true,
    audit_required: false,
    exportable: true,
    erasable: false, // Required for compliance
  },
  "security_logs": {
    classification: DataClassification.REGULATED,
    data_categories: ["audit_logs"],
    retention_policy: "7_years",
    encryption_required: true,
    audit_required: false,
    exportable: true,
    erasable: false,
  },

  // Cache & Temporary Data
  "browser_cache": {
    classification: DataClassification.INTERNAL,
    data_categories: ["session_data"],
    retention_policy: "7_days",
    encryption_required: false,
    audit_required: false,
    exportable: false,
    erasable: true,
  },
  "error_logs": {
    classification: DataClassification.INTERNAL,
    data_categories: ["usage_data"],
    retention_policy: "30_days",
    encryption_required: false,
    audit_required: false,
    exportable: true,
    erasable: true,
  },
};

/**
 * Legal basis for each data type
 */
const DATA_LEGAL_BASES: Record<string, LegalBasis> = {
  "auth_token": "contract",
  "mcp_auth_token": "contract",
  "encryption_keys": "legal_obligation",
  "browser_cookies": "contract",
  "browser_local_storage": "contract",
  "session_state": "contract",
  "notebook_library": "contract",
  "user_settings": "contract",
  "consent_records": "legal_obligation",
  "audit_logs": "legal_obligation",
  "compliance_events": "legal_obligation",
  "security_logs": "legal_obligation",
  "browser_cache": "legitimate_interest",
  "error_logs": "legitimate_interest",
};

/**
 * Processing purposes for each data type
 */
const DATA_PURPOSES: Record<string, string[]> = {
  "auth_token": ["service_provision", "session_management"],
  "mcp_auth_token": ["service_provision", "access_control"],
  "encryption_keys": ["data_protection"],
  "browser_cookies": ["service_provision", "session_management"],
  "browser_local_storage": ["service_provision"],
  "session_state": ["session_management"],
  "notebook_library": ["service_provision"],
  "user_settings": ["service_provision", "personalization"],
  "consent_records": ["legal_compliance"],
  "audit_logs": ["security_logging", "legal_compliance"],
  "compliance_events": ["legal_compliance"],
  "security_logs": ["security_logging", "legal_compliance"],
  "browser_cache": ["performance_optimization"],
  "error_logs": ["error_diagnostics", "service_improvement"],
};

// ============================================
// DATA CLASSIFIER
// ============================================

/**
 * Data Classifier class
 */
export class DataClassifier {
  private static instance: DataClassifier;
  private customClassifications: Map<string, ClassifiedData> = new Map();

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): DataClassifier {
    if (!DataClassifier.instance) {
      DataClassifier.instance = new DataClassifier();
    }
    return DataClassifier.instance;
  }

  /**
   * Classify a data type
   */
  public classify(dataType: string): ClassifiedData | null {
    // Check custom classifications first
    if (this.customClassifications.has(dataType)) {
      return this.customClassifications.get(dataType)!;
    }

    // Check built-in classifications
    if (dataType in DATA_CLASSIFICATIONS) {
      return DATA_CLASSIFICATIONS[dataType];
    }

    return null;
  }

  /**
   * Get the classification level for a data type
   */
  public getClassificationLevel(dataType: string): DataClassification {
    const classified = this.classify(dataType);
    return classified?.classification || DataClassification.INTERNAL;
  }

  /**
   * Check if data requires encryption
   */
  public requiresEncryption(dataType: string): boolean {
    const classified = this.classify(dataType);
    return classified?.encryption_required ?? false;
  }

  /**
   * Check if data access requires audit logging
   */
  public requiresAudit(dataType: string): boolean {
    const classified = this.classify(dataType);
    return classified?.audit_required ?? true;
  }

  /**
   * Check if data is exportable (for GDPR data portability)
   */
  public isExportable(dataType: string): boolean {
    const classified = this.classify(dataType);
    return classified?.exportable ?? false;
  }

  /**
   * Check if data is erasable (for GDPR right to erasure)
   */
  public isErasable(dataType: string): boolean {
    const classified = this.classify(dataType);
    return classified?.erasable ?? false;
  }

  /**
   * Get legal basis for processing
   */
  public getLegalBasis(dataType: string): LegalBasis {
    return DATA_LEGAL_BASES[dataType] || "legitimate_interest";
  }

  /**
   * Get processing purposes
   */
  public getProcessingPurposes(dataType: string): string[] {
    return DATA_PURPOSES[dataType] || ["service_provision"];
  }

  /**
   * Get retention policy
   */
  public getRetentionPolicy(dataType: string): string {
    const classified = this.classify(dataType);
    return classified?.retention_policy || "30_days";
  }

  /**
   * Register a custom classification
   */
  public registerClassification(dataType: string, classification: ClassifiedData): void {
    this.customClassifications.set(dataType, classification);
  }

  /**
   * Get all known data types
   */
  public getAllDataTypes(): string[] {
    const builtIn = Object.keys(DATA_CLASSIFICATIONS);
    const custom = Array.from(this.customClassifications.keys());
    return [...new Set([...builtIn, ...custom])];
  }

  /**
   * Get data types by classification level
   */
  public getDataTypesByClassification(level: DataClassification): string[] {
    return this.getAllDataTypes().filter(dt => {
      const classified = this.classify(dt);
      return classified?.classification === level;
    });
  }

  /**
   * Get data types by category
   */
  public getDataTypesByCategory(category: DataCategory): string[] {
    return this.getAllDataTypes().filter(dt => {
      const classified = this.classify(dt);
      return classified?.data_categories.includes(category);
    });
  }

  /**
   * Build a data inventory entry
   */
  public buildInventoryEntry(
    dataType: string,
    storageLocation: string
  ): DataInventoryEntry | null {
    const classified = this.classify(dataType);
    if (!classified) return null;

    const retentionDays = this.parseRetentionDays(classified.retention_policy);

    return {
      id: `inv_${dataType}_${Date.now()}`,
      data_type: dataType,
      description: this.getDataTypeDescription(dataType),
      classification: classified.classification,
      data_categories: classified.data_categories,
      storage_location: storageLocation,
      encrypted: classified.encryption_required,
      retention_policy: classified.retention_policy,
      retention_days: retentionDays,
      legal_basis: this.getLegalBasis(dataType),
      processing_purposes: this.getProcessingPurposes(dataType),
      who_can_access: ["owner"],
      exportable: classified.exportable,
      erasable: classified.erasable,
      last_updated: new Date().toISOString(),
    };
  }

  /**
   * Parse retention policy to days
   */
  private parseRetentionDays(policy: string): number | "indefinite" {
    switch (policy) {
      case "session":
        return 1; // Treat as 1 day max
      case "8_hours":
        return 1;
      case "24_hours":
        return 1;
      case "7_days":
        return 7;
      case "30_days":
        return 30;
      case "7_years":
        return 7 * 365;
      case "indefinite":
        return "indefinite";
      default:
        // Try to parse "X_days" format
        const match = policy.match(/^(\d+)_days$/);
        if (match) {
          return parseInt(match[1], 10);
        }
        return 30; // Default
    }
  }

  /**
   * Get human-readable description for data type
   */
  private getDataTypeDescription(dataType: string): string {
    const descriptions: Record<string, string> = {
      "auth_token": "Session authentication tokens for NotebookLM access",
      "mcp_auth_token": "MCP server authentication token",
      "encryption_keys": "Post-quantum encryption key pairs",
      "browser_cookies": "Browser cookies for NotebookLM session",
      "browser_local_storage": "Browser local storage data",
      "session_state": "Current browser session state",
      "notebook_library": "User's saved notebook collection with URLs and metadata",
      "user_settings": "User preferences and configuration",
      "consent_records": "Record of user consent for data processing",
      "audit_logs": "Security and operational audit trail",
      "compliance_events": "Regulatory compliance event log",
      "security_logs": "Security-specific event log",
      "browser_cache": "Temporary browser cache files",
      "error_logs": "Application error and diagnostic logs",
    };

    return descriptions[dataType] || `Data of type: ${dataType}`;
  }

  /**
   * Validate classification against compliance requirements
   */
  public validateCompliance(
    dataType: string,
    regulations: ("GDPR" | "SOC2" | "CSSF")[]
  ): { valid: boolean; issues: string[] } {
    const classified = this.classify(dataType);
    const issues: string[] = [];

    if (!classified) {
      issues.push(`Unknown data type: ${dataType}`);
      return { valid: false, issues };
    }

    // GDPR requirements
    if (regulations.includes("GDPR")) {
      if (classified.data_categories.includes("personal_data")) {
        if (!classified.encryption_required) {
          issues.push("GDPR: Personal data should be encrypted");
        }
        if (!classified.exportable) {
          issues.push("GDPR: Personal data should be exportable for data portability");
        }
      }
    }

    // SOC2 requirements
    if (regulations.includes("SOC2")) {
      if (
        classified.classification === DataClassification.RESTRICTED ||
        classified.classification === DataClassification.REGULATED
      ) {
        if (!classified.audit_required && !classified.data_categories.includes("audit_logs")) {
          issues.push("SOC2: Sensitive data access should be audited");
        }
      }
    }

    // CSSF requirements (Luxembourg financial regulator)
    if (regulations.includes("CSSF")) {
      if (classified.data_categories.includes("audit_logs")) {
        const retentionDays = this.parseRetentionDays(classified.retention_policy);
        if (retentionDays !== "indefinite" && retentionDays < 7 * 365) {
          issues.push("CSSF: Audit logs must be retained for at least 7 years");
        }
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}

// ============================================
// SINGLETON ACCESS
// ============================================

/**
 * Get the data classifier instance
 */
export function getDataClassifier(): DataClassifier {
  return DataClassifier.getInstance();
}

// ============================================
// CONVENIENCE EXPORTS
// ============================================

/**
 * Check if a data type requires encryption
 */
export function requiresEncryption(dataType: string): boolean {
  return getDataClassifier().requiresEncryption(dataType);
}

/**
 * Check if a data type requires audit logging
 */
export function requiresAudit(dataType: string): boolean {
  return getDataClassifier().requiresAudit(dataType);
}

/**
 * Get the classification level for a data type
 */
export function getClassificationLevel(dataType: string): DataClassification {
  return getDataClassifier().getClassificationLevel(dataType);
}

/**
 * Check if data is exportable for GDPR
 */
export function isExportable(dataType: string): boolean {
  return getDataClassifier().isExportable(dataType);
}

/**
 * Check if data can be erased for GDPR
 */
export function isErasable(dataType: string): boolean {
  return getDataClassifier().isErasable(dataType);
}
