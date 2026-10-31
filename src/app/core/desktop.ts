import { Injectable } from '@angular/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { IdentifierResult, ScanResult } from './models';

@Injectable({ providedIn: 'root' })
export class Desktop {
  readonly available = isTauri();
  scan(selectedSerial: string | null): Promise<ScanResult> {
    return invoke<ScanResult>('scan_devices', { selectedSerial });
  }
  readIdentifiers(serial: string): Promise<IdentifierResult> {
    return invoke<IdentifierResult>('read_identifiers', { serial });
  }
  copy(value: string): Promise<void> {
    if (this.available) return writeText(value);
    return navigator.clipboard.writeText(value);
  }
  notices(): Promise<string> {
    return invoke<string>('read_notices');
  }
}
