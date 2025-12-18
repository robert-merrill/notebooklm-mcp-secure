/**
 * Compliance Module - Main Exports
 *
 * Enterprise compliance features for GDPR, SOC2, and CSSF.
 *
 * Added by Pantheon Security.
 */

// Types
export * from "./types.js";

// Core Compliance Infrastructure (Phase 1)
export {
  ComplianceLogger,
  getComplianceLogger,
  logComplianceEvent,
} from "./compliance-logger.js";

export {
  DataClassifier,
  getDataClassifier,
  requiresEncryption,
  requiresAudit,
  getClassificationLevel,
  isExportable,
  isErasable,
} from "./data-classification.js";

export {
  ConsentManager,
  getConsentManager,
  isFirstRun,
  hasConsent,
  grantConsent,
  revokeConsent,
} from "./consent-manager.js";

export {
  PrivacyNoticeManager,
  getPrivacyNoticeManager,
  needsPrivacyNotice,
  acknowledgePrivacyNotice,
  getPrivacyNotice,
  getPrivacyNoticeCLIText,
} from "./privacy-notice.js";

export {
  PRIVACY_NOTICE,
  PRIVACY_NOTICE_VERSION,
  getPrivacyNoticeCLI,
  getPrivacyNoticeCompact,
  getPrivacyNoticeStructured,
  getProcessingAgreement,
} from "./privacy-notice-text.js";

// Data Subject Rights (Phase 2)
export {
  DataInventory,
  getDataInventory,
  getAllDataInventory,
  getExportableData,
  getErasableData,
} from "./data-inventory.js";

export {
  RetentionEngine,
  getRetentionEngine,
  runRetentionPolicies,
  getRetentionPolicies,
  getRetentionStatus,
} from "./retention-engine.js";

export {
  DataExporter,
  getDataExporter,
  exportUserData,
  exportUserDataToFile,
  exportUserDataToString,
} from "./data-export.js";

export {
  DataErasureManager,
  getDataErasureManager,
  createErasureRequest,
  executeErasureRequest,
  getPendingErasureRequests,
} from "./data-erasure.js";

export {
  DSARHandler,
  getDSARHandler,
  submitDSAR,
  processDSAR,
  handleDSAR,
  getDSARSummary,
} from "./dsar-handler.js";

// Security Monitoring (Phase 3)
export {
  AlertManager,
  getAlertManager,
  sendAlert,
  alertCritical,
  alertWarning,
} from "./alert-manager.js";

export {
  BreachDetector,
  getBreachDetector,
  checkForBreach,
  isPatternBlocked,
  getBreachRules,
} from "./breach-detection.js";

export {
  IncidentManager,
  getIncidentManager,
  createIncident,
  getOpenIncidents,
  updateIncidentStatus,
  getIncidentStatistics,
} from "./incident-manager.js";

export {
  SIEMExporter,
  getSIEMExporter,
  exportToSIEM,
  flushSIEM,
} from "./siem-exporter.js";

export {
  HealthMonitor,
  getHealthMonitor,
  runHealthCheck,
  getHealthStatus,
  getLastHealthMetrics,
} from "./health-monitor.js";

// Compliance Reporting & Documentation (Phase 4)
export {
  ChangeLog,
  getChangeLog,
  recordConfigChange,
  getRecentChanges,
  getChangeStatistics,
} from "./change-log.js";

export {
  PolicyDocManager,
  getPolicyDocManager,
  getAllPolicies,
  getPolicy,
  getPoliciesByRegulation,
  getPolicySummary,
} from "./policy-docs.js";

export {
  ComplianceDashboard,
  getComplianceDashboard,
  generateDashboard,
  getComplianceScore,
  getDashboardCLI,
} from "./dashboard.js";

export {
  ReportGenerator,
  getReportGenerator,
  generateReport,
  generateAndSaveReport,
  listReports,
} from "./report-generator.js";

export type { ReportType, ReportFormat, GeneratedReport, ReportOptions } from "./report-generator.js";

export {
  EvidenceCollector,
  getEvidenceCollector,
  collectEvidence,
  collectAndSaveEvidence,
  collectRegulationEvidence,
  verifyEvidence,
  listEvidencePackages,
} from "./evidence-collector.js";

export type { EvidenceType, EvidenceItem, EvidencePackage, CollectionOptions } from "./evidence-collector.js";

export {
  getComplianceTools,
  handleComplianceToolCall,
} from "./compliance-tools.js";
