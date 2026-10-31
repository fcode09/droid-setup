export type Language = 'en' | 'es';
export type DeviceState = 'device' | 'unauthorized' | 'offline' | 'no-permissions' | 'unsupported';
export interface Device {
  serial: string;
  state: DeviceState;
  usb: boolean;
  model: string | null;
  manufacturer: string | null;
  androidVersion: string | null;
  imei: string | null;
}
export interface ScanResult {
  devices: Device[];
  inspectedSerial: string | null;
  adbVersion: string;
}
export type ConnectionState =
  | 'checking'
  | 'waiting'
  | 'choose'
  | 'connected'
  | 'unauthorized'
  | 'offline'
  | 'no-permissions'
  | 'unverified'
  | 'unsupported'
  | 'missing-tools'
  | 'timeout'
  | 'error'
  | 'preview';

export interface IdentifierResult {
  imei: string | null;
  phoneNumber: string | null;
  cleanupPending: boolean;
}

export type ResetEvidence = 'none-reported' | 'detected' | 'unknown';
export interface ResetAccountGroup {
  userId: number;
  provider: 'google' | 'samsung' | 'xiaomi' | 'other';
  accountType: string;
  count: number;
}
export interface ResetInspection {
  serial: string;
  manufacturer: string | null;
  model: string | null;
  currentUser: number | null;
  users: { id: number; managed: boolean }[] | null;
  userUnlocked: boolean | null;
  accounts: { state: ResetEvidence; complete: boolean; groups: ResetAccountGroup[] };
  management: ResetEvidence;
  restriction: ResetEvidence;
  blockers: string[];
  incompleteChecks: string[];
}
export interface ResetReview {
  id: string;
  inspection: ResetInspection;
}
export interface ResetAcknowledgments {
  serialConfirmation: string;
  authorized: boolean;
  backupReviewed: boolean;
  accountsCheckedOnPhone: boolean;
  cloudSignOutChecked: boolean;
  dataLossUnderstood: boolean;
  manualReviewAccepted: boolean;
}
export type ResetSettingsPage = 'accounts' | 'reset' | 'general';
