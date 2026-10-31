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
